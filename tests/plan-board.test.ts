import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGraph } from '../server/engine.js';
import { PLAN_SLOTS } from '../shared/plan.js';
import { addPiece, boardSlots, connect } from '../src/planBoard.js';

test('el tablero marca mis piezas según mi rol', () => {
  const slots = boardSlots(initialGraph('plan'), 'devops');
  assert.equal(slots.find(s => s.piece === 'server')!.mine, true);
  assert.equal(slots.find(s => s.piece === 'checkout')!.mine, false);
  const backend = boardSlots(initialGraph('plan'), 'backend');
  assert.equal(backend.find(s => s.piece === 'checkout')!.mine, true);
  assert.equal(backend.find(s => s.piece === 'security')!.mine, false);
  assert.equal(backend.find(s => s.piece === 'entry')!.mine, false, 'la entrada no es de nadie');
});

test('el tablero tiene un elemento por solar, y la tienda ya viene puesta', () => {
  const slots = boardSlots(initialGraph('plan'), 'backend');
  assert.equal(slots.length, 8);
  assert.deepEqual(slots.filter(s => s.placed).map(s => s.piece), ['entry', 'web']);
});

test('el solar vacío explica qué falta, en español', () => {
  const slot = boardSlots(initialGraph('plan'), 'backend').find(s => s.piece === 'exit')!;
  assert.equal(slot.placed, false);
  assert.match(slot.reason!, /respuesta/i);
  const placed = boardSlots(initialGraph('plan'), 'backend').find(s => s.piece === 'web')!;
  assert.equal(placed.reason, undefined, 'un solar ocupado no tiene motivo de ausencia');
  assert.match(placed.text, /vidriera/i, 'pero sí explica para qué sirve');
});

test('agregar una pieza no muta el plano original', () => {
  const plan = initialGraph('plan');
  const next = addPiece(plan, 'exit');
  assert.equal(plan.nodes.length, 2);
  assert.equal(next.nodes.length, 3);
});

test('cada pieza cae en su solar', () => {
  assert.deepEqual(addPiece(initialGraph('plan'), 'payment').nodes.at(-1)!.position, PLAN_SLOTS.payment);
});

test('conectar reemplaza la salida anterior de esa pieza', () => {
  const plan = addPiece(addPiece(initialGraph('plan'), 'exit'), 'checkout');
  const web = plan.nodes.find(n => n.type === 'web')!, checkout = plan.nodes.find(n => n.type === 'checkout')!, exit = plan.nodes.find(n => n.type === 'exit')!;
  const first = connect(plan, web.id, exit.id);
  assert.equal(first.edges.find(e => e.source === web.id)!.target, exit.id);
  const next = connect(first, web.id, checkout.id);
  assert.equal(next.edges.filter(e => e.source === web.id).length, 1);
  assert.equal(next.edges.find(e => e.source === web.id)!.target, checkout.id);
  assert.equal(first.edges.filter(e => e.source === web.id).length, 1, 'conectar no muta el plano anterior');
});

test('la bahía de servidores admite varias piezas apiladas', () => {
  const plan = addPiece(addPiece(initialGraph('plan'), 'server'), 'server');
  assert.equal(plan.nodes.filter(n => n.type === 'server').length, 2);
  assert.equal(new Set(plan.nodes.map(n => n.id)).size, plan.nodes.length, 'cada pieza con su identificador');
});

test('un solar ya ocupado no acepta una segunda pieza', () => {
  const plan = addPiece(initialGraph('plan'), 'exit');
  assert.deepEqual(addPiece(plan, 'exit'), plan);
});
