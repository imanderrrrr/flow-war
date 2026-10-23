import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGraph, inventoryBatch, validateGraph } from '../server/engine.js';
import { route } from '../server/graphs.js';
import { LOGIC_BLOCKS, hasBlock, insertBlock, logicPath, removeBlock, sameLogic, submissionCost } from '../src/logicBlocks.js';

const types = (graph: ReturnType<typeof initialGraph>) => route(graph).map(n => n.type);

test('Atomic Update cae entre Read Stock y Write Stock, y la ruta sigue completa', () => {
  const graph = insertBlock(initialGraph('backend'), 'atomic');
  assert.deepEqual(types(graph), ['entry', 'read', 'atomic', 'write', 'payment', 'exit']);
  assert.doesNotThrow(() => validateGraph(graph, 'backend'), 'el servidor acepta el grafo para enviarlo a Seguridad');
  assert.equal(inventoryBatch(graph, 2, 1).oversold, 0, 'el motor lo lee como protección del stock');
});

test('cada bloque cae justo antes de la operación sobre la que actúa', () => {
  const expected: Record<string, string[]> = {
    lock: ['entry', 'lock', 'read', 'write', 'payment', 'exit'],
    queue: ['entry', 'queue', 'read', 'write', 'payment', 'exit'],
    cache: ['entry', 'cache', 'read', 'write', 'payment', 'exit'],
    validation: ['entry', 'read', 'validation', 'write', 'payment', 'exit'],
    idempotency: ['entry', 'read', 'write', 'idempotency', 'payment', 'exit'],
    retry: ['entry', 'read', 'write', 'retry', 'payment', 'exit'],
  };
  for (const [type, path] of Object.entries(expected)) {
    const graph = insertBlock(initialGraph('backend'), type);
    assert.deepEqual(types(graph), path, type);
    assert.doesNotThrow(() => validateGraph(graph, 'backend'), type);
  }
});

test('el catálogo ofrece los siete bloques de Backend, repartidos entre Inventario y Pagos', () => {
  const offered = [...LOGIC_BLOCKS.inventory, ...LOGIC_BLOCKS.payment].map(b => b.type).sort();
  assert.deepEqual(offered, ['atomic', 'cache', 'idempotency', 'lock', 'queue', 'retry', 'validation']);
  for (const block of [...LOGIC_BLOCKS.inventory, ...LOGIC_BLOCKS.payment]) assert.ok(block.text.length > 10, `${block.type} explica qué hace`);
});

test('poner varios bloques los encadena sin perder ninguno', () => {
  const graph = insertBlock(insertBlock(insertBlock(initialGraph('backend'), 'atomic'), 'lock'), 'idempotency');
  assert.deepEqual(types(graph), ['entry', 'lock', 'read', 'atomic', 'write', 'idempotency', 'payment', 'exit']);
  assert.equal(new Set(graph.edges.map(e => e.id)).size, graph.edges.length, 'cada camino con su identificador');
  assert.doesNotThrow(() => validateGraph(graph, 'backend'));
});

test('un bloque ya puesto no se duplica', () => {
  const once = insertBlock(initialGraph('backend'), 'atomic');
  assert.equal(insertBlock(once, 'atomic'), once);
  assert.equal(hasBlock(once, 'atomic'), true);
  assert.equal(hasBlock(once, 'lock'), false);
});

test('quitar un bloque vuelve a unir lo que tenía antes y después', () => {
  const base = initialGraph('backend'), graph = insertBlock(insertBlock(base, 'atomic'), 'lock');
  const without = removeBlock(graph, 'atomic');
  assert.deepEqual(types(without), ['entry', 'lock', 'read', 'write', 'payment', 'exit']);
  assert.equal(hasBlock(without, 'atomic'), false);
  assert.doesNotThrow(() => validateGraph(without, 'backend'));
  assert.deepEqual(types(removeBlock(without, 'lock')), types(base));
});

test('poner y quitar no mutan el grafo que reciben', () => {
  const base = initialGraph('backend'), copy = structuredClone(base);
  removeBlock(insertBlock(base, 'retry'), 'retry');
  assert.deepEqual(base, copy);
});

test('la lógica se lee como un recorrido de etiquetas', () => {
  assert.deepEqual(logicPath(insertBlock(initialGraph('backend'), 'atomic')), ['Request IN', 'Read Stock', 'Atomic Update', 'Write Stock', 'Payment', 'Response OUT']);
});

test('el costo de envío es el que cobra el servidor: Q100 más los bloques', () => {
  assert.equal(submissionCost(initialGraph('backend').nodes), 100);
  assert.equal(submissionCost(insertBlock(insertBlock(initialGraph('backend'), 'atomic'), 'idempotency').nodes), 100 + 180 + 150);
});

test('la misma lógica se reconoce aunque cambien ids y posiciones, y un parámetro distinto la distingue', () => {
  const base = initialGraph('backend'), withAtomic = insertBlock(base, 'atomic');
  assert.equal(sameLogic(base, structuredClone(base)), true);
  assert.equal(sameLogic(removeBlock(withAtomic, 'atomic'), base), true, 'poner y quitar vuelve a producción');
  assert.equal(sameLogic(withAtomic, base), false);
  const tuned = structuredClone(withAtomic); tuned.nodes.find(n => n.type === 'atomic')!.data.value = 2;
  assert.equal(sameLogic(tuned, withAtomic), false, 'cambiar solo la cantidad también es un cambio');
});

test('los bloques de un toque no quedan uno encima del otro en el lienzo interno', () => {
  const graph = insertBlock(insertBlock(insertBlock(initialGraph('backend'), 'lock'), 'queue'), 'cache');
  const spots = graph.nodes.filter(n => n.id.startsWith('logic-')).map(n => `${n.position.x},${n.position.y}`);
  assert.equal(new Set(spots).size, 3);
});
