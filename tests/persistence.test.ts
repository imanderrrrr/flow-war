import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame } from '../server/engine.js';
import { recoverGame } from '../server/persistence.js';
import { startConcurrency } from '../server/scenarios.js';
import { advanceGame, command, insertBlock } from './helpers.js';

for (const boundary of [0, 1, 1.5, 2, 2.5, 4]) test(`SQLite recovery at ${boundary}s preserves pending context, money and exactly-once effects`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'flow-war-persist-'));
  const path = join(directory, 'game.sqlite');
  try {
    const game = createGame(); game.status = 'RUNNING'; startConcurrency(game.companies[0], 0); advanceGame(game, boundary);
    let db = new DatabaseSync(path); db.exec('CREATE TABLE game (state TEXT NOT NULL)');
    db.prepare('INSERT INTO game (state) VALUES (?)').run(JSON.stringify(game)); db.close();
    db = new DatabaseSync(path);
    const recovered = recoverGame((db.prepare('SELECT state FROM game').get() as {state: string}).state); db.close();
    assert.equal(recovered.status, 'PAUSED');
    const paused = structuredClone(recovered); advanceGame(recovered, 2); assert.deepEqual(recovered, paused);
    command(recovered, 'operator', 'room.start'); advanceGame(recovered, 4); advanceGame(game, 4);
    assert.deepEqual(recovered.companies[0], game.companies[0]);
    assert.equal(recovered.companies[0].concurrency.totals.generated, 2);
    assert.equal(recovered.companies[0].concurrency.totals.oversold, 1);
    assert.equal(recovered.companies[0].concurrency.totals.revenue, 45);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a QA scenario resumes after a restart without contaminating production or repeating its report', () => {
  const game = createGame(); game.status = 'RUNNING';
  command(game, 'backend', 'change.submit', { graph: insertBlock('atomic'), revision: 0 });
  const change = game.changes[0]; command(game, 'qa', 'qa.run', { suite: 'Concurrencia' }, change.id); advanceGame(game, 1);
  assert.equal(change.qaScenario?.requests[0].read?.stock, 1);
  const recovered = recoverGame(JSON.stringify(game)); command(recovered, 'operator', 'room.start'); advanceGame(recovered, 4);
  const restored = recovered.changes[0];
  assert.equal(restored.status, 'QA_PENDING'); assert.equal(restored.reports.length, 1); assert.equal(restored.reports[0].completed, 1);
  assert.equal(restored.reports[0].oversold, 0); assert.equal(recovered.companies[0].concurrency.totals.generated, 0);
  advanceGame(recovered, 4); assert.equal(restored.reports.length, 1);
});

test('v1 migration preserves the old market, economy and stock, and never invents historical individual requests', () => {
  const game = createGame(); game.status = 'RUNNING'; game.tick = 500;
  game.companies[0].requests = 145; game.companies[0].errors = 12; game.companies[0].successes = 93;
  game.companies[0].capital = 8754; game.companies[0].stock = 6;
  const legacy = JSON.parse(JSON.stringify(game)); legacy.schema = 1;
  for (const company of legacy.companies) delete company.concurrency;
  const serialized = JSON.stringify(legacy), recovered = recoverGame(serialized);
  assert.equal(JSON.stringify(legacy), serialized); assert.equal(recovered.schema, 6); assert.equal(recovered.status, 'PAUSED');
  for (const company of recovered.companies) {
    const { concurrency, active, queue, latency, utilization, ...existing } = company;
    const { active: oldActive, queue: oldQueue, latency: oldLatency, utilization: oldUtilization, ...historical } = legacy.companies[company.id];
    // Aggregate QoS remains historical; it must not fabricate new queued requests.
    assert.deepEqual(existing, { ...historical, traffic: company.traffic });
    assert.deepEqual(company.traffic.legacyMetrics, {active:oldActive,queue:oldQueue,latency:oldLatency,utilization:oldUtilization});
    assert.equal(queue,0);assert.equal(latency,0);
    assert.equal(concurrency.totals.generated, 0); assert.equal(concurrency.run, undefined); assert.equal(concurrency.nextAt, 540);
  }
  command(recovered, 'operator', 'room.start'); advanceGame(recovered, 1);
  assert.equal(recovered.companies[0].concurrency.totals.generated, 0);
});

test('v1 QA evidence remains historical and cannot authorize the upgraded simulation', () => {
  const game = createGame(); game.status = 'RUNNING';
  command(game, 'backend', 'change.submit', { graph: insertBlock('atomic'), revision: 0 });
  const change = game.changes[0]; command(game, 'qa', 'qa.run', { suite: 'Concurrencia' }, change.id); advanceGame(game, 3.5);
  command(game, 'qa', 'qa.approve', {}, change.id); command(game, 'cto', 'cto.authorize', {}, change.id);
  const legacy = JSON.parse(JSON.stringify(game)); legacy.schema = 1;
  for (const company of legacy.companies) delete company.concurrency;
  for (const item of legacy.changes) { delete item.context; delete item.qaScenario; }
  const recovered = recoverGame(JSON.stringify(legacy)); command(recovered, 'operator', 'room.start');
  const restored = recovered.changes[0];
  assert.equal(restored.status, 'QA_PENDING'); assert.equal(restored.reserved, 0); assert.equal(recovered.companies[0].reserved, 0);
  assert.equal(restored.reports.length, 1); assert.equal(restored.reports[0].obsolete, true);
  assert.equal(command(recovered, 'qa', 'qa.approve', {}, restored.id).ok, false);
  assert.equal(command(recovered, 'devops', 'deploy.start', { strategy: 'rolling' }, restored.id).ok, false);
  command(recovered, 'qa', 'qa.run', { suite: 'Concurrencia' }, restored.id); advanceGame(recovered, 3.5);
  assert.equal(restored.reports.length, 2); assert.equal(command(recovered, 'qa', 'qa.approve', {}, restored.id).ok, true);
});

test('future schema versions fail closed instead of silently losing pending requests', () => {
  const serialized = JSON.stringify({ ...createGame(), schema: 999 });
  assert.throws(() => recoverGame(serialized), /Versión de partida/);
});
