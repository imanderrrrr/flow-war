import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGraph, validateGraph } from '../server/engine.js';
import { advanceConcurrency, createConcurrencyRun } from '../server/requests.js';
import { insertBlock } from './helpers.js';
import type { Graph } from '../shared/types.js';

function fixture(graph: Graph, offsets: [number,number] = [0,0], stock = 1) {
  const run = createConcurrencyRun('blocks', { backend: graph, security: initialGraph('security'), executionVersion: 1 }, 0, offsets);
  run.inventory.stock = run.inventory.initialStock = stock; return run;
}
function complete(run: ReturnType<typeof fixture>) { for (let i = 1; i <= 300; i++) advanceConcurrency(run, i / 10); return run; }
test('4A T30/T31 Lock serializes the protected stock section with real contention and releases on termination', () => {
  const run = complete(fixture(insertBlock('lock','read',5000)));
  assert.equal(run.inventory.oversold, 0); assert.equal(run.inventory.committed, 1); assert.ok(run.operationsState!.counters.lockWaits > 0); assert.deepEqual(run.operationsState!.locks, {});
  const late = complete(fixture(insertBlock('lock','write',5000))); assert.equal(late.inventory.oversold, 1);
});
test('4A Lock TTL expiration can expose a stale read and acquisition consumes time', () => {
  const graph = insertBlock('retry','write',1,insertBlock('lock','read',100));
  graph.nodes.find(n => n.type === 'lock')!.data.config = { kind: 'lock', resource: 'stock', ttlMs: 100, acquisitionMs: 0 };
  const run = complete(fixture(graph)); assert.equal(run.inventory.oversold, 1); const slow = insertBlock('lock','read',5000); slow.nodes.find(n => n.type === 'lock')!.data.config = { kind: 'lock', resource: 'stock', ttlMs: 5000, acquisitionMs: 500 };
  const delayed = complete(fixture(slow)); assert.ok(delayed.operations.filter(o => o.type === 'lock').length > 2);
});
test('4A T32 Queue is bounded, FIFO and does not create capacity or duplicate requests', () => {
  const run = complete(fixture(insertBlock('queue','read',2))); assert.equal(run.inventory.oversold, 0); assert.equal(run.requests.length, 2);
  const order = run.operations.filter(o => o.type === 'write').map(o => o.requestId); assert.equal(order[0], run.requests[0].id);
  const full = complete(fixture(insertBlock('queue','read',1))); assert.equal(full.requests[1].result?.reason, 'QUEUE_FULL');
});
test('4A T33/T34/T35 Retry obeys attempts/deadline and Idempotency prevents repeated payment effects in its TTL', () => {
  for (const protectedPayment of [false,true]) {
    let graph = insertBlock('retry','payment',2); if (protectedPayment) graph = insertBlock('idempotency','payment',60,graph);
    const run = fixture(graph, [0,4], 10); run.requests.forEach(r => r.transportFailures = 1); complete(run);
    assert.equal(run.operationsState!.counters.retries, 2); assert.equal(run.requests.reduce((s,r) => s + (r.duplicates ?? 0), 0), protectedPayment ? 0 : 2);
    assert.ok(run.requests.every(r => r.retryCount === 1));
  }
  const limited = fixture(insertBlock('retry','payment',2), [0,0], 10); limited.requests.forEach(r => r.transportFailures = 5); complete(limited);
  assert.ok(limited.requests.every(r => r.retryCount === 1 && r.status === 'FAILED'));
  const deadline = fixture(insertBlock('retry','payment',6), [0,0], 10); deadline.requests.forEach(r => { r.transportFailures = 5; r.deadline = 3; }); complete(deadline);
  assert.ok(deadline.requests.every(r => (r.retryCount ?? 0) <= 1));
});
test('4A Idempotency protects only the connected tail and deduplicates business intents rather than all requests', () => {
  const run = fixture(insertBlock('idempotency','write',60), [0,4], 10); run.requests.forEach(r => r.intentId = 'shared'); complete(run);
  assert.equal(run.inventory.committed, 1); assert.equal(run.operationsState!.counters.duplicates, 0);
  const disconnected = insertBlock('idempotency','write',60); disconnected.edges = initialGraph('backend').edges;
  const unprotected = fixture(disconnected, [0,4], 10); unprotected.requests.forEach(r => r.intentId = 'shared'); complete(unprotected); assert.equal(unprotected.inventory.committed, 2);
});
test('4A T36 Cache records hits/misses/expiration and stale stock does not become atomic', () => {
  const graph = insertBlock('cache','read',10);
  const run = complete(fixture(graph, [0,4], 1)); assert.equal(run.operationsState!.counters.cacheHits, 1); assert.equal(run.operationsState!.counters.cacheMisses, 1); assert.equal(run.inventory.oversold, 1);
  const expired = complete(fixture(insertBlock('cache','read',1), [0,4], 1)); assert.equal(expired.operationsState!.counters.cacheMisses, 2); assert.equal(expired.inventory.oversold, 0);
});
test('4A T37 Validation checks the requested condition without granting atomicity', () => {
  const run = complete(fixture(insertBlock('validation','write',1))); assert.equal(run.inventory.oversold, 1); // Both validations execute before either write.
  const prior = complete(fixture(insertBlock('validation','read',1))); assert.equal(prior.inventory.oversold, 1);
  const invalid = insertBlock('lock','read',5000); invalid.nodes.find(n => n.type === 'lock')!.data.config = { kind: 'lock', resource: 'stock', ttlMs: -1, acquisitionMs: 0 }; assert.throws(() => validateGraph(invalid,'backend'));
});
