import test from 'node:test';
import assert from 'node:assert/strict';
import { completePlan, initialGraph } from '../server/engine.js';
import { missingFor, planServices, sellCapable } from '../server/graphs.js';
import type { Graph } from '../shared/types.js';

/** entrada → …types… → salida, chained in the order given. */
const withPieces = (...types: string[]): Graph => {
  const chain = ['entry', ...types, 'exit'];
  return { nodes: chain.map(type => ({ id: `plan-${type}`, type, position: { x: 0, y: 0 }, data: { label: type } })),
    edges: chain.slice(1).map((type, i) => ({ id: `plan-e${i}`, source: `plan-${chain[i]}`, target: `plan-${type}` })) };
};

test('el plano inicial no atiende nada: falta la salida', () => {
  assert.equal(missingFor(initialGraph('plan'), 'browse'), 'exit');
  assert.equal(sellCapable(initialGraph('plan')), false);
});

test('con la salida puesta ya se navega, pero no se compra ni se consulta', () => {
  const plan = withPieces('web');
  assert.equal(missingFor(plan, 'browse'), null);
  assert.equal(missingFor(plan, 'query'), 'inventory');
  assert.equal(missingFor(plan, 'purchase'), 'checkout');
});

test('cuatro piezas alcanzan para vender', () => {
  const plan = withPieces('web', 'checkout', 'inventory', 'payment');
  assert.equal(missingFor(plan, 'purchase'), null);
  assert.equal(sellCapable(plan), true);
  assert.deepEqual(planServices(plan), ['web', 'checkout', 'inventory', 'payment']);
});

test('una pieza fuera del recorrido no cuenta', () => {
  const plan = withPieces('web', 'checkout', 'inventory', 'payment');
  plan.edges = plan.edges.filter(e => e.target !== plan.nodes.find(n => n.type === 'payment')!.id);
  assert.notEqual(missingFor(plan, 'purchase'), null);
});

test('el orden dibujado se respeta y se informa', () => {
  const plan = withPieces('web', 'checkout', 'payment', 'inventory');
  assert.equal(sellCapable(plan), true);
  assert.deepEqual(planServices(plan), ['web', 'checkout', 'payment', 'inventory']);
});

test('el perímetro de seguridad no hace falta para vender', () => {
  assert.equal(sellCapable(withPieces('web', 'checkout', 'inventory', 'payment')), true);
  assert.deepEqual(planServices(completePlan()), ['security', 'web', 'checkout', 'inventory', 'payment']);
});
