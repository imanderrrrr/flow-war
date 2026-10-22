import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, initialGraph, validateGraph } from '../server/engine.js';
import { PLAN_PIECES, PLAN_REQUIREMENTS, PLAN_SLOTS } from '../shared/plan.js';

test('una empresa nueva arranca con entrada y tienda web, nada más', () => {
  const game = createGame();
  for (const c of game.companies) {
    assert.deepEqual(c.plan.nodes.map(n => n.type).sort(), ['entry', 'web']);
    assert.equal(c.plan.edges.length, 1);
  }
});

test('el plano acepta una pieza por solar y rechaza la repetida', () => {
  const plan = initialGraph('plan');
  plan.nodes.push({ id: 'p-exit', type: 'exit', position: PLAN_SLOTS.exit, data: { label: 'Salida' } });
  assert.ok(validateGraph(plan, 'plan', false));
  plan.nodes.push({ id: 'p-exit-2', type: 'exit', position: PLAN_SLOTS.exit, data: { label: 'Salida' } });
  assert.throws(() => validateGraph(plan, 'plan', false), /solar/i);
});

test('el plano rechaza un ciclo', () => {
  const plan = initialGraph('plan');
  plan.edges.push({ id: 'back', source: 'plan-web', target: 'plan-entry' });
  assert.throws(() => validateGraph(plan, 'plan', false), /Ciclo|Dirección/);
});

test('el plano rechaza una pieza que no está en el catálogo', () => {
  const plan = initialGraph('plan');
  plan.nodes.push({ id: 'p-lock', type: 'lock', position: { x: 0, y: 0 }, data: { label: 'Lock' } });
  assert.throws(() => validateGraph(plan, 'plan', false), /Nodo inválido/);
});

test('el catálogo del plano reparte las piezas entre Backend, Seguridad y DevOps', () => {
  assert.equal(PLAN_PIECES.security.owner, 'security');
  assert.equal(PLAN_PIECES.server.owner, 'devops');
  for (const piece of ['web', 'exit', 'checkout', 'inventory', 'payment'] as const) assert.equal(PLAN_PIECES[piece].owner, 'backend');
  assert.equal(PLAN_PIECES.entry.owner, null);
});

test('cada pieza explica para qué sirve, en español', () => {
  for (const piece of Object.values(PLAN_PIECES)) assert.ok(piece.text.length > 20, piece.label);
});

test('los tipos de solicitud exigen los servicios de la especificación', () => {
  assert.deepEqual(PLAN_REQUIREMENTS.browse, ['web']);
  assert.deepEqual(PLAN_REQUIREMENTS.query, ['web', 'inventory']);
  assert.deepEqual(PLAN_REQUIREMENTS.purchase, ['web', 'checkout', 'inventory', 'payment']);
});
