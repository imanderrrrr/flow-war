import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { project, step } from '../server/engine.js';
import { advanceMarket, assertMarket, bindMarket, blendCustomerColor, flushMigrations, migrationProbability, requestMigration, selectCustomer } from '../server/market.js';
import { admitTraffic, advanceTraffic, generateTraffic, settleTraffic, trafficParticles } from '../server/traffic.js';
import { recoverGame, serializeGame } from '../server/persistence.js';
import { createGameWriter } from '../server/storage.js';
import { advanceGame, assembledGame, command, insertBlock, reviewForQa } from './helpers.js';
import type { GameState, MarketCustomer } from '../shared/types.js';
// These tests measure the engine at full pressure; the calm start has its own (tests/pacing.test.ts).
process.env.FLOW_CALM_START = '0';

const customerOf = (game: GameState, companyId = 0) => game.market.customers[game.market.members[companyId][0]];
const transfer = (game: GameState, customer: MarketCustomer, to: number | null) => { if (customer.lastMigrationTick !== undefined) game.tick = Math.max(game.tick, customer.lastMigrationTick + game.market.config.cooldownSeconds); assert.equal(requestMigration(game, customer.id, to, 'TEST'), true); flushMigrations(game); assertMarket(game); };
function visit(game: GameState, customer: MarketCustomer, type: 'browse' | 'purchase' = 'browse') {
  const company = game.companies[customer.currentCompanyId!];
  const start = Math.max(game.tick, company.traffic.lastTick); advanceTraffic(company, start);
  const request = admitTraffic(company, start, type, 'legitimate', undefined, customer);
  for (let index = 0; index < 100 && !request.accounted; index++) advanceTraffic(company, Math.round((company.traffic.lastTick + .1) * 10) / 10);
  assert.equal(request.accounted, true); game.tick = Math.max(game.tick, company.traffic.lastTick); return request;
}

test('M-T01 initial 5000 unique individuals, exclusive 1000 per owner and equivalent initial state', () => {
  const game = assembledGame(); assertMarket(game);
  assert.equal(Object.keys(game.market.customers).length, 5000); assert.equal(new Set(Object.keys(game.market.customers)).size, 5000);
  for (const company of game.companies) {
    assert.equal(game.market.members[company.id].length, 1000);
    for (const id of game.market.members[company.id]) { const c = game.market.customers[id]; assert.equal(c.currentCompanyId, company.id); assert.equal(c.originCompanyId, company.id); assert.equal(c.visualColor, company.color); }
  }
});
test('M-T02/T03 stable IDs and immutable origin survive visits, transfer and restart', () => {
  const game = assembledGame(), ids = Object.keys(game.market.customers), customer = customerOf(game);
  visit(game, customer); transfer(game, customer, 1); visit(game, customer);
  const restored = recoverGame(serializeGame(game)); assert.deepEqual(Object.keys(restored.market.customers), ids);
  assert.equal(restored.market.customers[customer.id].originCompanyId, 0); assert.equal(restored.market.customers[customer.id].currentCompanyId, 1);
});
test('M-T04/T06 membership and real future demand move atomically; no receiver capacity quota', () => {
  const game = assembledGame(), source = game.companies[0], receiver = game.companies[1];
  receiver.traffic.config.rates.web = .1;
  for (const id of [...game.market.members[0]].slice(0, 500)) transfer(game, game.market.customers[id], 1);
  assert.equal(source.customers, 500); assert.equal(receiver.customers, 1500);
  for (let index = 0; index < 100; index++) { generateTraffic(source, 1000, .1, 1500); generateTraffic(receiver, 1000, .1, 1500); }
  assert.ok(receiver.traffic.legitimate.generated > source.traffic.legitimate.generated * 2.9);
  for (const request of Object.values(receiver.traffic.requests)) if (request.trafficClass === 'legitimate') assert.equal(game.market.customers[request.customerId!].currentCompanyId, 1);
});
test('M-T05 real clients serve ordinary and LAST-UNIT requests; attacks have no customer identity', () => {
  const game = assembledGame(); command(game, 'operator', 'room.start'); game.companies.forEach(c => c.concurrency.nextAt = 0); step(game);
  for (const company of game.companies) {
    for (const request of [...Object.values(company.traffic.requests), ...company.concurrency.run!.requests]) { assert.ok(game.market.customers[request.customerId!]); assert.equal(request.customerSource, 'market'); }
    assert.throws(() => admitTraffic(company, game.tick, 'browse', 'legitimate', undefined, { ...customerOf(game, company.id), id: 'not-in-population' }), /desconocido/);
    const attack = admitTraffic(company, game.tick, 'purchase', 'malicious', 'forged'); assert.equal(attack.customerId, undefined); assert.equal(attack.customerSource, undefined);
  }
});
test('M-T07 deferred departure blocks new work, keeps route/version and commits exactly once', () => {
  const game = assembledGame(), customer = customerOf(game), company = game.companies[0]; company.backend = insertBlock('atomic');
  const request = admitTraffic(company, 0, 'purchase', 'legitimate', undefined, customer), path = structuredClone(request.path);
  assert.equal(requestMigration(game, customer.id, 1, 'DISSATISFACTION'), true); assert.equal(requestMigration(game, customer.id, 2, 'DUPLICATE'), false); flushMigrations(game);
  assert.equal(customer.currentCompanyId, 0); assert.equal(customer.activeRequests, 1);
  assert.throws(() => admitTraffic(company, 0, 'purchase', 'legitimate', undefined, customer), /propietario inválido/);
  for (let tick = 1; tick <= 40; tick++) advanceTraffic(company, tick / 10);
  flushMigrations(game); assert.equal(customer.currentCompanyId, 1); assert.equal(request.companyId, 0); assert.equal(request.executionVersion, 1); assert.deepEqual(request.path, path);
  assert.equal(company.revenue, 45); assert.equal(game.companies[1].revenue, 0); assert.equal(company.traffic.totals.committed, 1);
  settleTraffic(company, 4); flushMigrations(game); assert.equal(company.revenue, 45); assert.equal(customer.history.length, 1);
});
test('M-T07 a confirmed reservation remains in the old ledger after departure and timeout', () => {
  const game = assembledGame(), customer = customerOf(game), company = game.companies[0]; company.traffic.config.delays.payment = 15;
  const request = admitTraffic(company, 0, 'purchase', 'legitimate', undefined, customer); requestMigration(game, customer.id, 1, 'TEST');
  for (let tick = 1; tick <= 110; tick++) advanceTraffic(company, tick / 10); flushMigrations(game);
  assert.equal(request.transaction, 'PENDING_RESOLUTION'); assert.equal(company.traffic.inventory.stock, 99); assert.equal(request.committed, 1);
  assert.equal(customer.currentCompanyId, 1); assert.equal(game.companies[1].traffic.inventory.stock, 100); assert.equal(game.companies[1].revenue, 0);
});
test('M-T08 one abandoned request changes experience without automatically departing', () => {
  const game = assembledGame(), customer = customerOf(game); game.companies[0].infraBudget = 0; const request = visit(game, customer);
  assert.equal(request.status, 'ABANDONED'); assert.equal(customer.abandonedRequests, 1); assert.equal(customer.failedVisits, 1);
  assert.equal(customer.currentCompanyId, 0); assert.equal(customer.pendingMigration, undefined); assert.equal(customer.history.length, 0); assert.ok(customer.loyalty < 1);
});
test('M-T09 140 and 200 percent are pressures with monotonic probabilities bounded by one', () => {
  const customer = customerOf(assembledGame()); const a = migrationProbability(100, customer), b = migrationProbability(140, customer), c = migrationProbability(200, customer);
  assert.ok(a < b && b < c); assert.ok(c > 0 && c < 1); assert.ok(migrationProbability(100000000, customer) <= 1); assert.equal(migrationProbability(0, customer), 0);
  assert.ok(Math.abs(c - -Math.expm1(-.002 * 2 * .35)) < 1e-12);
});
test('M-T10 gradual loyalty uses real legitimate visits; migration preserves the previous color', () => {
  const game = assembledGame(), customer = customerOf(game), color = customer.visualColor; transfer(game, customer, 1);
  assert.equal(customer.loyalty, 0); assert.equal(customer.visualColor, color); const purchase = visit(game, customer, 'purchase'); assert.equal(purchase.result?.status, 'COMPLETED'); assert.equal(customer.loyalty, .12); visit(game, customer);
  assert.equal(customer.loyalty, .20); assert.notEqual(customer.visualColor, color); assert.notEqual(customer.visualColor, game.companies[1].color);
  for (let index = 0; index < 12; index++) visit(game, customer); assert.equal(customer.loyalty, 1); assert.equal(customer.visualColor, game.companies[1].color);
});
test('M-T11/T12 colors persist and no clock/projection/animation advances loyalty', () => {
  const game = assembledGame(), customer = customerOf(game); transfer(game, customer, 1); visit(game, customer);
  const before = structuredClone(customer), restored = recoverGame(serializeGame(game));
  restored.tick = 200; advanceMarket(restored); project(restored, null); trafficParticles(restored.companies[1], 200);
  assert.deepEqual(restored.market.customers[customer.id], before);
});
test('M-T13 multiple migrations retain origin/history and interpolate from the actual intermediate color', () => {
  const game = assembledGame(), customer = customerOf(game); transfer(game, customer, 1); visit(game, customer); const intermediate = customer.visualColor;
  transfer(game, customer, 2); assert.equal(customer.transitionFromColor, intermediate); assert.equal(customer.visualColor, intermediate); assert.equal(customer.originCompanyId, 0);
  visit(game, customer); assert.equal(customer.visualColor, blendCustomerColor(intermediate, game.companies[2].color, .08));
  assert.deepEqual(customer.history.map(item => [item.from, item.to]), [[0, 1], [1, 2]]); assert.equal(customer.previousCompanyId, 1);
});
test('M-T14 cooldown suppresses tick oscillation while elimination bypasses it', () => {
  const game = assembledGame(), customer = customerOf(game); transfer(game, customer, 1); game.companies[1].pressure = 300;
  for (let tick = 1; tick < 90; tick++) { game.tick = tick; advanceMarket(game); }
  assert.equal(customer.history.length, 1); assert.equal(requestMigration(game, customer.id, 2, 'TEST'), false); game.status = 'RUNNING'; game.companies[1].bankruptTicks = 30; game.companies[1].capital = -1; step(game);
  assert.equal(game.companies[1].eliminated, true); assert.notEqual(customer.currentCompanyId, 1); assert.equal(customer.history.at(-1)?.reason, 'ELIMINATION');
});
test('M-T15 receiver has more genuine queue pressure after customer growth, at unchanged cost/capacity', () => {
  const control = assembledGame(), grown = assembledGame();
  for (const game of [control, grown]) { game.tick = 1000; game.status = 'RUNNING'; for (const company of game.companies) { company.traffic.lastTick = 1000; company.concurrency.nextAt = 2000; company.servers = 2; company.balancer = true; company.traffic.config.rates.security = 10000; } }
  for (const id of [...grown.market.members[0]].slice(0, 800)) transfer(grown, grown.market.customers[id], 1);
  advanceGame(control, 20); advanceGame(grown, 20);
  assert.equal(control.companies[1].servers, grown.companies[1].servers); assert.ok(grown.companies[1].traffic.legitimate.generated > control.companies[1].traffic.legitimate.generated);
  assert.ok(grown.companies[1].queue > control.companies[1].queue); assert.ok(grown.companies[1].traffic.legitimate.abandoned + grown.companies[1].traffic.legitimate.rejected > control.companies[1].traffic.legitimate.abandoned + control.companies[1].traffic.legitimate.rejected);
});
test('M-T17 elimination is terminal, operational commands/admissions are blocked and changes invalidated', () => {
  const game = assembledGame(); game.status = 'RUNNING'; command(game, 'backend', 'change.submit', { graph: insertBlock('atomic'), revision: 0 });
  const company = game.companies[0]; company.capital = -1; company.bankruptTicks = 30; step(game);
  assert.equal(company.eliminated, true); assert.equal(company.customers, 0); assert.equal(game.changes[0].status, 'STALE'); assert.equal(command(game, 'devops', 'infra.scale', { delta: 1 }).ok, false);
  assert.throws(() => admitTraffic(company, game.tick), /eliminada/); assert.equal(requestMigration(game, customerOf(game, 1).id, 0, 'TEST'), false);
  advanceGame(game, 10); assert.equal(company.eliminated, true); assert.equal(company.customers, 0); assertMarket(game);
});
test('M-T18/T19 multiple and total elimination conserve all clients including outside the market', () => {
  const game = assembledGame(); game.status = 'RUNNING';
  for (const company of game.companies.slice(0, 3)) { company.capital = -1; company.bankruptTicks = 30; }
  step(game); assertMarket(game); assert.ok(game.companies.slice(0, 3).every(company => company.customers === 0));
  for (const company of game.companies.slice(3)) { company.capital = -1; company.bankruptTicks = 30; }
  step(game); assert.equal(game.status, 'FINISHED'); assert.equal(game.unserved, 5000); assertMarket(game);
  for (const customer of Object.values(game.market.customers)) assert.equal(customer.currentCompanyId, null);
});
test('M-T19 outside clients can return gradually to viable active companies without a sale', () => {
  const game = assembledGame(), customer = customerOf(game); transfer(game, customer, null);
  game.market.config.reentryPerSecond = 100;
  game.tick = 90; advanceMarket(game); assert.notEqual(customer.currentCompanyId, null); assert.equal(customer.history.at(-1)?.reason, 'RETURN'); assert.equal(customer.loyalty, 0);
  assert.ok(game.companies.every(company => company.revenue === 0)); assertMarket(game);
});
test('M-T20 snapshots, sampling, batching and restarts cannot change deterministic market outcomes', () => {
  const a = assembledGame(), b = assembledGame(); a.status = b.status = 'RUNNING'; a.companies[0].pressure = b.companies[0].pressure = 200;
  for (let i = 0; i < 300; i++) { step(a, .2); step(b); project(b, { id: 'q', role: 'qa', companyId: i % 5 }); step(b); }
  assert.deepEqual(a, b); const restored = recoverGame(serializeGame(a)); restored.status = 'RUNNING';
  // serializeGame drains receipts to SQLite separately; compare simulation, not transient transport.
  for (const game of [a, restored]) game.companies.forEach(company => company.traffic.outbox = []);
  advanceGame(a, 20); advanceGame(restored, 20); assert.deepEqual(a.market, restored.market); assert.deepEqual(a.companies, restored.companies);
});
test('M-T21 balanced counter randomness and cyclic preferences give equal initial selection across all IDs', () => {
  const game = assembledGame();
  for (const company of game.companies) { const selected = Array.from({ length: 1000 }, () => selectCustomer(company)!.id); assert.equal(new Set(selected).size, 1000); }
  const a = assembledGame(); for (const company of a.companies) company.pressure = 200;
  for (let tick = 1; tick <= 120; tick++) { a.tick = tick; advanceMarket(a); }
  assert.equal(new Set(a.companies.map(company => company.customers)).size, 1); assert.equal(new Set(a.companies.map(company => company.migratedOut)).size, 1);
  assert.ok(a.companies[0].migratedOut > 0); assertMarket(a);
});
test('M-T22 transfers and noncommercial loyalty never manufacture capital/revenue/sales', () => {
  const game = assembledGame(), customer = customerOf(game); transfer(game, customer, 1); visit(game, customer); visit(game, customer);
  for (const company of game.companies) { assert.equal(company.revenue, 0); assert.equal(company.capital, 10000); assert.equal(company.traffic.inventory.committed, 0); }
});
test('M-T23 SQLite atomically recovers a pending transfer and settled color without duplicates', () => {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE commands (identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');
  try {
    const write = createGameWriter(db), game = assembledGame(), customer = customerOf(game), request = admitTraffic(game.companies[0], 0, 'purchase', 'legitimate', undefined, customer);
    requestMigration(game, customer.id, 1, 'TEST'); write(game);
    const restored = recoverGame((db.prepare('SELECT state FROM game').get() as { state: string }).state); bindMarket(restored);
    for (let tick = 1; tick <= 40; tick++) advanceTraffic(restored.companies[0], tick / 10); flushMigrations(restored); write(restored); write(restored);
    const again = recoverGame((db.prepare('SELECT state FROM game').get() as { state: string }).state);
    assert.equal(again.market.customers[customer.id].history.length, 1); assert.equal(again.market.customers[customer.id].activeRequests, 0); assert.equal(again.companies[0].revenue, 45);
    assert.equal((db.prepare('SELECT count(*) AS n FROM request_receipts WHERE id=?').get(request.id) as { n: number }).n, 1); assert.deepEqual(again.market, restored.market);
  } finally { db.close(); }
});
test('M-T24 legacy schema3 imports unequal quotas and outside pool with explicitly unknown origin and no invented history', () => {
  const legacy = JSON.parse(JSON.stringify(assembledGame())); legacy.schema = 3; delete legacy.market;
  legacy.companies[0].customers = 400; legacy.companies[1].customers = 1400; legacy.unserved = 200; legacy.migrations = [{ id: 'old-aggregate', from: 0, to: 1, count: 60, at: 300, color: '#f5d45c' }]; legacy.status = 'RUNNING'; legacy.tick = 400;
  const game = recoverGame(JSON.stringify(legacy)); assert.equal(game.schema, 7); assert.equal(game.status, 'PAUSED'); assert.equal(game.companies[0].customers, 400); assert.equal(game.companies[1].customers, 1400); assert.equal(game.unserved, 200); assert.deepEqual(game.market.legacyAggregateMigrations, legacy.migrations); assertMarket(game);
  for (const customer of Object.values(game.market.customers)) { assert.equal(customer.originCompanyId, null); assert.equal(customer.imported, true); assert.equal(customer.history.length, 0); assert.equal(customer.successfulVisits, 0); assert.equal(customer.loyalty, 0); }
  assert.deepEqual(game.companies[0].concurrency, legacy.companies[0].concurrency); assert.equal(game.companies[0].capital, legacy.companies[0].capital);
});
test('M-T24 legacy active visitor references retain original context without fabricated experiences', () => {
  const game = assembledGame(); admitTraffic(game.companies[0], 0, 'purchase'); const legacy = JSON.parse(serializeGame(game)); legacy.schema = 3; delete legacy.market;
  const restored = recoverGame(JSON.stringify(legacy)), request = Object.values(restored.companies[0].traffic.requests)[0]; assert.equal(request.customerSource, 'legacy');
  for (let tick = 1; tick <= 40; tick++) advanceTraffic(restored.companies[0], tick / 10);
  assert.equal(restored.companies[0].revenue, 45); assert.equal(restored.market.totals.experiences, 0); assertMarket(restored);
});
test('M-T25 bounded public/private projections contain no customer population/indexes/history', () => {
  const game = assembledGame(); command(game, 'operator', 'room.start');
  for (const identity of [null, { id: 'q', role: 'qa' as const, companyId: 1 }, { id: 'op', role: 'operator' as const, companyId: null }]) {
    const snapshot = project(game, identity), json = JSON.stringify(snapshot);
    for (const forbidden of ['"market":', '"members":', '"experiences":', '"pendingIds":', '"originCompanyId":']) assert.equal(json.includes(forbidden), false);
    assert.ok(snapshot.companies.every(company => company.particles.length <= 50)); assert.ok(json.length < 150000);
    if (identity?.role === 'qa') assert.equal(snapshot.privateCompany?.id, 1);
  }
});
test('M-T28 QA load/concurrency and unauthorized roles cannot mutate production customers', () => {
  const game = assembledGame(); game.status = 'RUNNING'; command(game, 'backend', 'change.submit', { graph: insertBlock('atomic'), revision: 0 }); const before = structuredClone(game.market);
  assert.equal(command(game, 'backend', 'deploy.start').code, 'FORBIDDEN'); assert.equal(command(game, 'devops', 'cto.authorize', {}, game.changes[0].id).code, 'FORBIDDEN');
  reviewForQa(game);command(game, 'qa', 'qa.run', { suite: 'Carga' }, game.changes[0].id);
  const staging = game.changes[0].qaLoad!.company; assert.equal(staging.traffic.scope, 'qa');
  admitTraffic(staging, 0); advanceTraffic(staging, .1); assert.deepEqual(game.market, before);
});
test('M-T29 every recolored projected sprite has an actual client and admission in that company', () => {
  const game = assembledGame(), customer = customerOf(game); transfer(game, customer, 1); const company = game.companies[1];
  const request = admitTraffic(company, 0, 'browse', 'legitimate', undefined, customer), before = structuredClone(game.market);
  const sprite = trafficParticles(company, 0).find(sprite => sprite.requestId === request.id)!;
  assert.equal(sprite.customerId, customer.id); assert.equal(sprite.color, customer.visualColor); assert.equal(sprite.color, game.companies[0].color); assert.equal(sprite.companyId, 1); assert.deepEqual(game.market, before);
});
test('M-T30 finish settles operations and conserves all 5000 identities including pending departures', () => {
  const game = assembledGame(); command(game, 'operator', 'room.start'); const customer = game.market.customers[Object.values(game.companies[0].traffic.requests)[0].customerId!];
  requestMigration(game, customer.id, null, 'TEST'); command(game, 'operator', 'room.finish'); assert.equal(game.status, 'FINISHED'); assert.equal(customer.activeRequests, 0); assert.equal(customer.currentCompanyId, null); assertMarket(game);
});
test('market integrity rejects duplicate/missing owners and impossible old population rather than repair history', () => {
  const game = assembledGame(); game.market.members[1].push(game.market.members[0][0]); assert.throws(() => assertMarket(game), /Propiedad/);
  const legacy = JSON.parse(JSON.stringify(assembledGame())); legacy.schema = 3; delete legacy.market; legacy.companies[0].customers = 999; assert.throws(() => recoverGame(JSON.stringify(legacy)), /5000/);
});

test('M-T16 full 20-minute domino emerges from ownership and capacity; paired control keeps VERTEX healthy', async () => {
  const { marketScenario } = await import('../scripts/market-scenarios.js');
  const outcomes = [];
  for (const migrations of [true, false]) {
    const { game, decide } = marketScenario(1200, 'D-domino', 7357, migrations);
    let vertexDeadlines = 0, vertexQueueRejections = 0, novaDeadlines = 0, firstVertexExit: number | undefined, vertexCustomersBeforeExit = 0;
    while (game.status === 'RUNNING') {
      decide(); step(game);
      if (game.companies[1].migratedOut === 0) vertexCustomersBeforeExit = Math.max(vertexCustomersBeforeExit, game.companies[1].customers);
      else firstVertexExit ??= game.tick;
      for (const company of game.companies) {
        for (const receipt of company.traffic.outbox) {
          if (company.id === 1 && receipt.trafficClass === 'legitimate' && receipt.result?.reason === 'QUEUE_FULL') vertexQueueRejections++;
          if (receipt.trafficClass === 'legitimate' && receipt.result?.reason === 'DEADLINE') {
          if (company.id === 1) vertexDeadlines++;
          if (company.id === 0) novaDeadlines++;
          }
        }
        company.traffic.outbox = [];
      }
    }
    outcomes.push({ game, vertexDeadlines, vertexQueueRejections, novaDeadlines, firstVertexExit, vertexCustomersBeforeExit });
  }
  const [cascade, control] = outcomes;
  assert.ok(cascade.game.companies[0].migratedOut > 0); assert.ok(cascade.vertexCustomersBeforeExit > 1000); assert.ok(cascade.firstVertexExit! > 600);
  assert.ok(cascade.novaDeadlines > 0); assert.ok(cascade.vertexQueueRejections > control.vertexQueueRejections); assert.equal(control.vertexQueueRejections, 0); assert.equal(control.vertexDeadlines, 0);
  assert.ok(cascade.game.companies[1].pressure > control.game.companies[1].pressure); assert.equal(control.game.companies[1].migratedOut, 0);
  assert.ok(Object.values(cascade.game.market.customers).some(customer => {
    const first = customer.history.findIndex(item => item.from === 0 && item.to === 1);
    return first >= 0 && customer.history.slice(first + 1).some(item => item.from === 1);
  }));
  assert.ok(Object.values(cascade.game.market.customers).some(customer => {
    const first = customer.history.findIndex(item => item.from === 0 && item.to === 1);
    return first >= 0 && customer.history.slice(first + 1).some(item => item.from === 1 && item.to !== null && item.to !== 0);
  }), 'The cascade must include an actual subsequent competitor, in addition to any outside exits');
  assert.equal(cascade.game.companies[1].servers, control.game.companies[1].servers); assertMarket(cascade.game); assertMarket(control.game);
});

test('failed command rollback can rebind a cloned state without losing customer accounting', () => {
  const game = assembledGame(); command(game, 'operator', 'room.start');
  const rollback = structuredClone(game); rollback.status = 'RUNNING'; step(rollback); advanceGame(rollback, 5); assertMarket(rollback);
  assert.ok(rollback.market.totals.experiences > 0); assert.equal(game.market.totals.experiences, 0);
});

test('eliminating a pending recipient redirects to the outside pool without resurrecting it', () => {
  const game = assembledGame(), customer = customerOf(game); admitTraffic(game.companies[0], 0, 'purchase', 'legitimate', undefined, customer);
  requestMigration(game, customer.id, 1, 'TEST'); game.status = 'RUNNING'; game.companies[1].capital = -1; game.companies[1].bankruptTicks = 30; step(game);
  advanceGame(game, 5); assert.equal(customer.currentCompanyId, null); assert.equal(customer.history.length, 1); assert.equal(game.companies[1].customers, 0); assertMarket(game);
});

test('M-T21 multiple seeds and every weak-company index preserve rotated competitive outcomes', () => {
  for (const seed of [11, 29, 71, 7357]) {
    let reference: unknown;
    for (let weak = 0; weak < 5; weak++) {
      const game = assembledGame(1500, seed); game.companies[weak].pressure = 200;
      for (let tick = 1; tick <= 100; tick++) { game.tick = tick; advanceMarket(game); }
      const rotated = { unserved: game.unserved, customers: Array.from({ length: 5 }, (_, offset) => game.companies[(weak + offset) % 5].customers), departures: game.companies[weak].migratedOut };
      if (reference) assert.deepEqual(rotated, reference); else reference = rotated;
    }
  }
});

test('M-T21 a full symmetric failing market has identical outcomes even under sustained churn', () => {
  const game = assembledGame(1200); command(game, 'operator', 'room.start');
  while (game.status === 'RUNNING') { step(game); for (const company of game.companies) company.traffic.outbox = []; }
  const signature = (company: GameState['companies'][number]) => ({ customers: company.customers, pressure: company.pressure, reputation: company.reputation, requests: company.requests, revenue: company.revenue, capital: company.capital, migratedIn: company.migratedIn, migratedOut: company.migratedOut, totals: company.traffic.totals });
  for (const company of game.companies) assert.deepEqual(signature(company), signature(game.companies[0]));
  assert.ok(game.market.totals.migrations > 0); assertMarket(game);
});
