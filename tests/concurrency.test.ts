import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, initialGraph, project, reportFor, validateGraph } from '../server/engine.js';
import { advanceConcurrency, concurrencyReport, createConcurrencyRun, runConcurrencyFixture } from '../server/requests.js';
import { settleConcurrency, startConcurrency, stepConcurrency } from '../server/scenarios.js';
import { advanceGame, authorizeAtomic, command, insertBlock } from './helpers.js';

const context = (backend = initialGraph('backend')) => ({ backend, security: initialGraph('security'), executionVersion: 1 });

test('unsafe interleaving records two stale reads before either write and a real excess commitment', () => {
  const run = runConcurrencyFixture(context());
  assert.deepEqual(run.operations.filter(op => ['read', 'write'].includes(op.type)).map(op => [op.requestId, op.type, op.stock, op.version]), [
    ['fixture-R1', 'read', 1, 0], ['fixture-R2', 'read', 1, 0], ['fixture-R1', 'write', 0, 1], ['fixture-R2', 'write', 0, 2],
  ]);
  assert.deepEqual(run.requests.map(request => request.read), [{ stock: 1, version: 0 }, { stock: 1, version: 0 }]);
  assert.equal(new Set(run.requests.map(request => request.intentId)).size, 2);
  assert.equal(run.inventory.stock, 0); assert.equal(run.inventory.committed, 2); assert.equal(run.inventory.oversold, 1);
  assert.equal(concurrencyReport(run, 0).completed, 2);
});

test('sequential requests read the updated inventory and cannot sell the last unit twice', () => {
  const run = createConcurrencyRun('sequential', context(), 0, [0, 4]);
  for (let tick = 1; tick <= 100; tick++) advanceConcurrency(run, tick / 10);
  const report = concurrencyReport(run, 10);
  assert.equal(report.completed, 1); assert.equal(report.rejected, 1); assert.equal(report.oversold, 0);
  assert.equal(run.requests[1].read?.stock, 0); assert.equal(run.inventory.committed, 1);
});

for (const before of ['read', 'write']) test(`Atomic before ${before} checks and commits current stock in one operation`, () => {
  const run = runConcurrencyFixture(context(insertBlock('atomic', before)));
  assert.equal(concurrencyReport(run, 0).completed, 1); assert.equal(concurrencyReport(run, 0).rejected, 1);
  assert.equal(run.inventory.stock, 0); assert.equal(run.inventory.committed, 1); assert.equal(run.inventory.oversold, 0);
  assert.equal(run.requests[1].result?.reason, 'OUT_OF_STOCK');
});

for (const placement of ['late', 'disconnected']) test(`${placement} Atomic cannot repair a previous unsafe write`, () => {
  let graph = insertBlock('atomic', 'payment');
  if (placement === 'disconnected') {
    graph = initialGraph('backend');
    graph.nodes.push({ id: 'unused', type: 'atomic', position: { x: 0, y: 0 }, data: { label: 'Atomic', value: 1 } });
  }
  const run = runConcurrencyFixture(context(graph));
  assert.equal(run.inventory.oversold, 1); assert.equal(concurrencyReport(run, 0).completed, 2);
});

test('Atomic quantity is executed rather than treated as a protection flag', () => {
  const run = runConcurrencyFixture(context(insertBlock('atomic', 'write', 2)));
  assert.equal(concurrencyReport(run, 0).completed, 0); assert.equal(concurrencyReport(run, 0).rejected, 2);
  assert.equal(run.inventory.stock, 1); assert.equal(run.inventory.version, 0); assert.equal(run.inventory.committed, 0);
  assert.throws(() => validateGraph(insertBlock('atomic', 'write', 1.5), 'backend'), /cantidad entera/);
});

test('an advanced reachable piece rejects explicitly; a disconnected one has no effect', () => {
  const run = runConcurrencyFixture(context(insertBlock('lock', 'read', 1000)));
  assert.ok(run.requests.every(request => request.result?.reason === 'UNSUPPORTED_BLOCK'));
  assert.equal(run.inventory.committed, 0);
});

test('unsafe settlement recognizes only the funded sale, charges compensation once and conserves request totals', () => {
  const company = createGame().companies[0];
  assert.equal(startConcurrency(company, 0), true);
  const run = company.concurrency.run!;
  for (let tick = 1; tick <= 40; tick++) {
    advanceConcurrency(run, tick / 10); advanceConcurrency(run, tick / 10);
    settleConcurrency(company); settleConcurrency(company);
    const totals = company.concurrency.totals;
    assert.equal(totals.generated, totals.completed + totals.rejected + totals.abandoned + totals.failed + run.requests.filter(request => !request.result).length);
    assert.equal(run.inventory.stock + run.inventory.committed - run.inventory.oversold, run.inventory.initialStock);
  }
  assert.deepEqual(company.concurrency.totals, { generated: 2, completed: 2, rejected: 0, abandoned: 0, failed: 0, committed: 2, oversold: 1, revenue: 45, lostRevenue: 0, capitalDelta: -5 });
  assert.equal(company.requests, 2); assert.equal(company.successes, 2); assert.equal(company.errors, 0);
  assert.equal(company.capital, 9995); assert.equal(company.stock, 100);
  const before = structuredClone(company);
  for (let tick = 40; tick < 100; tick++) { advanceConcurrency(run, tick / 10); settleConcurrency(company); }
  assert.deepEqual(company, before);
});

test('Atomic rejection records one lost intention and one sale, never both for the same request', () => {
  const company = createGame().companies[0]; company.backend = insertBlock('atomic');
  startConcurrency(company, 0);
  for (let tick = 1; tick <= 40; tick++) { advanceConcurrency(company.concurrency.run!, tick / 10); settleConcurrency(company); }
  assert.equal(company.revenue, 45); assert.equal(company.lostRevenue, 45); assert.equal(company.capital, 10003);
  assert.equal(company.successes, 1); assert.equal(company.errors, 1);
  assert.ok(company.concurrency.run!.requests.every(request => !(request.result!.revenue && request.result!.lostRevenue)));
});

test('no service produces deadlines and no ghost inventory operations', () => {
  const company = createGame().companies[0]; company.concurrency.nextAt = 0;
  for (let tick = 0; tick <= 170; tick++) stepConcurrency(company, tick / 10, false);
  assert.equal(company.concurrency.totals.abandoned, 2); assert.equal(company.concurrency.totals.lostRevenue, 90); assert.equal(company.lostRevenue, 90 + company.traffic.totals.lostRevenue);
  assert.equal(company.revenue, 0); assert.equal(company.concurrency.run!.inventory.committed, 0);
  assert.equal(company.concurrency.run!.operations.length, 0);
});

test('security rejection in the shared executor prevents all inventory effects', () => {
  const cfg = context(); cfg.security = insertBlock('role', 'exit', 1, cfg.security);
  const run = runConcurrencyFixture(cfg);
  assert.ok(run.requests.every(request => request.result?.reason === 'SECURITY_REJECTED'));
  assert.equal(run.inventory.committed, 0); assert.equal(run.inventory.stock, 1);
});

test('admission freezes graph and version against later local edits', () => {
  const cfg = context(); const run = createConcurrencyRun('frozen', cfg, 0);
  cfg.backend.nodes.splice(0); cfg.executionVersion = 2;
  for (let tick = 1; tick <= 40; tick++) advanceConcurrency(run, tick / 10);
  assert.ok(run.requests.every(request => request.executionVersion === 1)); assert.equal(run.inventory.oversold, 1);
});

test('QA and production use the same executor with independent inventory and observations', () => {
  const game = createGame(); game.status = 'RUNNING';
  command(game, 'backend', 'change.submit', { graph: insertBlock('atomic'), revision: 0 });
  const change = game.changes[0], before = structuredClone(game);
  const qa = reportFor(game, change, 'Concurrencia');
  assert.deepEqual(game, before);
  const production = createGame().companies[0]; production.backend = structuredClone(change.graph);
  startConcurrency(production, 0);
  for (let tick = 1; tick <= 40; tick++) { advanceConcurrency(production.concurrency.run!, tick / 10); settleConcurrency(production); }
  const observed = concurrencyReport(production.concurrency.run!, 0);
  assert.deepEqual([qa.completed, qa.rejected, qa.oversold, qa.latency], [observed.completed, observed.rejected, observed.oversold, observed.latency]);
  assert.deepEqual(qa.evidence?.outcomes.map(({ requestId, ...rest }) => rest), observed.evidence?.outcomes.map(({ requestId, ...rest }) => rest));
  assert.notEqual(production.concurrency.run!.inventory, change.qaScenario?.inventory);
});

test('QA runs from the submitted context and ignores subsequent production infrastructure changes', () => {
  const game = createGame(); game.status = 'RUNNING';
  command(game, 'backend', 'change.submit', { graph: insertBlock('atomic'), revision: 0 });
  const change = game.changes[0], first = reportFor(game, change, 'Concurrencia');
  game.companies[0].servers = 8; game.companies[0].security = insertBlock('role', 'exit', 1, initialGraph('security'));
  const second = reportFor(game, change, 'Concurrencia');
  assert.deepEqual(second, first);
});

test('scheduled incident admits two new requests, replaces the old burst, and isolates the legacy SKU', () => {
  const game = createGame(); game.status = 'RUNNING'; game.tick = 359.9;
  // No ordinary market traffic, so every commercial counter here belongs to the fixture.
  game.companies[0].customers = 0;
  for (const company of game.companies) company.pressure = 0;
  advanceGame(game, 4);
  const company = game.companies[0];
  assert.equal(company.requests, 2 + company.traffic.totals.generated); assert.equal(company.concurrency.totals.completed, 2); assert.equal(company.concurrency.totals.rejected, 0); assert.equal(company.concurrency.totals.oversold, 1);
  assert.equal(company.concurrency.sequence, 1); assert.equal(company.concurrency.run!.inventory.stock, 0);
  assert.equal(company.concurrency.run!.inventory.committed, 2);
  assert.ok(company.stock > 1);
});

for (const strategy of ['rolling', 'restart']) test(`${strategy}: publication preserves in-flight version; subsequent requests use the new artifact`, () => {
  const game = createGame(); game.status = 'RUNNING';
  const change = authorizeAtomic(game, strategy), company = game.companies[0];
  const due = change.due!;
  advanceGame(game, due - game.tick - 1.2);
  assert.equal(company.version, 1); assert.equal(startConcurrency(company, game.tick), true);
  const previousRun = company.concurrency.run!;
  advanceGame(game, 5);
  assert.equal(change.status, 'DEPLOYED'); assert.equal(company.version, 2);
  assert.ok(previousRun.requests.every(request => request.executionVersion === 1));
  assert.ok(previousRun.requests.every(request => !request.path.some(node => node.type === 'atomic')));
  assert.equal(previousRun.inventory.oversold, 1);
  startConcurrency(company, game.tick); const nextRun = company.concurrency.run!;
  advanceGame(game, 4);
  assert.ok(nextRun.requests.every(request => request.executionVersion === 2)); assert.equal(nextRun.inventory.oversold, 0);
  assert.equal(concurrencyReport(nextRun, game.tick).completed, 1);
  const capital = company.capital;
  assert.equal(command(game, 'devops', 'deploy.start', { strategy }, change.id).ok, false);
  assert.equal(company.capital, capital);
});

test('all role and pipeline barriers remain authoritative before publishing', () => {
  const game = createGame(); game.status = 'RUNNING'; const company = game.companies[0];
  command(game, 'backend', 'change.submit', { graph: insertBlock('atomic'), revision: 0 }); const change = game.changes[0];
  for (const role of ['backend', 'security', 'qa', 'cto', 'product'] as const) assert.equal(command(game, role, 'deploy.start', { strategy: 'rolling' }, change.id).code, 'FORBIDDEN');
  assert.equal(command(game, 'cto', 'cto.authorize', {}, change.id).ok, false);
  assert.equal(command(game, 'qa', 'qa.approve', {}, change.id).ok, false);
  assert.equal(command(game, 'devops', 'deploy.start', { strategy: 'rolling' }, change.id).ok, false);
  command(game, 'qa', 'qa.run', { suite: 'Concurrencia' }, change.id); advanceGame(game, 3.5);
  command(game, 'qa', 'qa.approve', {}, change.id);
  assert.equal(command(game, 'devops', 'deploy.start', { strategy: 'rolling' }, change.id).ok, false);
  command(game, 'cto', 'cto.authorize', {}, change.id);
  assert.equal(company.version, 1); assert.equal(company.concurrency.totals.generated, 0);
  const control = createGame(); control.status = 'RUNNING'; advanceGame(control, 3.5);
  assert.deepEqual(company.backend, initialGraph('backend')); assert.equal(company.stock, control.companies[0].stock);
  assert.equal(company.capital, control.companies[0].capital);
});

test('public journeys represent real requests and terminal points without leaking execution paths', () => {
  const game = createGame(); game.status = 'RUNNING'; game.companies[0].backend = insertBlock('atomic');
  startConcurrency(game.companies[0], 0); advanceGame(game, 4);
  const view = project(game, null).companies[0], particles = view.particles.filter(p => p.requestId?.startsWith('C0-CC'));
  assert.equal(particles.length, 2);
  assert.equal(particles.find(p => p.status === 'REJECTED')?.journey?.to, 'inventory');
  assert.equal(particles.find(p => p.status === 'COMPLETED')?.journey?.to, 'exit');
  assert.equal('run' in view.concurrency, false); assert.equal('path' in particles[0], false);
  assert.equal(view.concurrency.inventory?.stock, 0); assert.equal(view.concurrency.inventory?.committed, 1);
  const before = structuredClone(game); project(game, null); project(game, null); assert.deepEqual(game, before);
});

test('finish cancels and settles pending requests exactly once; pause advances nothing', () => {
  const game = createGame(); game.status = 'RUNNING'; startConcurrency(game.companies[0], 0); advanceGame(game, 1);
  command(game, 'operator', 'room.pause'); const paused = structuredClone(game); advanceGame(game, 10); assert.deepEqual(game, paused);
  command(game, 'operator', 'room.finish'); const company = game.companies[0];
  assert.equal(company.concurrency.totals.abandoned, 2); assert.equal(company.concurrency.totals.lostRevenue, 90); assert.equal(company.lostRevenue, 90 + company.traffic.totals.lostRevenue);
  assert.equal(company.concurrency.run!.inventory.committed, 0);
  const before = structuredClone(company); command(game, 'operator', 'room.finish'); assert.deepEqual(company, before);
});

test('finishing after payment preserves the paid sale without recording a second loss or charge', () => {
  const game = createGame(); game.status = 'RUNNING'; startConcurrency(game.companies[0], 0); advanceGame(game, 2);
  const company = game.companies[0];
  assert.ok(company.concurrency.run!.requests.every(request => request.paid && !request.result));
  command(game, 'operator', 'room.finish');
  assert.equal(company.concurrency.totals.abandoned, 2);
  assert.equal(company.concurrency.totals.revenue, 45); assert.equal(company.concurrency.totals.lostRevenue, 0);
  assert.equal(company.concurrency.totals.capitalDelta, -5); assert.equal(company.concurrency.run!.inventory.committed, 2);
  const before = structuredClone(company); settleConcurrency(company); assert.deepEqual(company, before);
});
