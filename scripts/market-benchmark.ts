import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { step, project } from '../server/engine.js';
import { assertMarket } from '../server/market.js';
import { serializeGame, recoverGame } from '../server/persistence.js';
import { createGameWriter } from '../server/storage.js';
import { MARKET_STRATEGIES, marketSample, marketScenario, type MarketStrategy } from './market-scenarios.js';

const percentile = (samples: number[], fraction: number) => { const sorted = [...samples].sort((a, b) => a - b); return Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0) * 1000) / 1000; };
function run(duration: number, strategy: MarketStrategy, migrations = true) {
  const directory = mkdtempSync(join(tmpdir(), 'flow-war-market-bench-')), db = new DatabaseSync(join(directory, 'audit.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE commands (identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');
  const writer = createGameWriter(db), { game, decide } = marketScenario(duration, strategy, 7357, migrations);
  const resources: { tick: number; heapMB: number; retainedRequests: number; historyEntries: number }[] = [];
  const ticks: number[] = [], saves: number[] = [], samples = [marketSample(game)], started = performance.now();
  const peak = { heapMB: 0, retainedRequests: 0, outbox: 0, snapshotKB: 0, serializedKB: 0 };
  const deadlines = [0, 0, 0, 0, 0], administrativeAbandons = [0, 0, 0, 0, 0];
  let populationChecks = 0, requestChecks = 0, receipts = 0;
  const save = () => {
    for (const company of game.companies) for (const receipt of company.traffic.outbox) {
      receipts++;
      if (receipt.trafficClass !== 'legitimate') continue;
      if (receipt.result?.reason === 'DEADLINE') deadlines[company.id]++;
      if (receipt.result?.reason === 'ROOM_FINISHED' || receipt.result?.reason === 'COMPANY_ELIMINATED') administrativeAbandons[company.id]++;
    }
    const before = performance.now(); writer(game); saves.push(performance.now() - before);
  };
  try {
    while (game.status === 'RUNNING') {
      decide(); const before = performance.now(); step(game); ticks.push(performance.now() - before);
      for (const company of game.companies) {
        const traffic = company.traffic, totals = traffic.totals, pending = Object.values(traffic.requests).filter(request => !request.result).length;
        assert.equal(totals.generated, pending + totals.completed + totals.rejected + totals.abandoned + totals.failed);
        assert.equal(company.requests, totals.generated + company.concurrency.totals.generated);
        assert.equal(company.revenue, totals.revenue + company.concurrency.totals.revenue);
        assert.equal(company.lostRevenue, totals.lostRevenue + company.concurrency.totals.lostRevenue); requestChecks++;
        peak.retainedRequests = Math.max(peak.retainedRequests, Object.keys(traffic.requests).length); peak.outbox = Math.max(peak.outbox, traffic.outbox.length);
      }
      if (Number.isInteger(game.tick)) { assertMarket(game); populationChecks++; }
      if (Math.round(game.tick * 10) % 100 === 0) save();
      if (Math.round(game.tick * 10) % 300 === 0) {
        resources.push({ tick: game.tick, heapMB: process.memoryUsage().heapUsed / 1024 ** 2, retainedRequests: game.companies.reduce((sum, c) => sum + Object.keys(c.traffic.requests).length, 0), historyEntries: Object.values(game.market.customers).reduce((sum, c) => sum + c.history.length, 0) });
        samples.push(marketSample(game)); peak.heapMB = Math.max(peak.heapMB, process.memoryUsage().heapUsed / 1024 ** 2);
        peak.snapshotKB = Math.max(peak.snapshotKB, Buffer.byteLength(JSON.stringify(project(game, { id: 'bench', role: 'qa', companyId: 0 }))) / 1024);
        peak.serializedKB = Math.max(peak.serializedKB, Buffer.byteLength(serializeGame(game)) / 1024);
      }
    }
    save(); assertMarket(game);
    if (samples.at(-1)?.tick !== game.tick) samples.push(marketSample(game));
    assert.equal((db.prepare('SELECT count(*) AS n FROM request_receipts').get() as { n: number }).n, receipts);
    const serialized = serializeGame(game), restored = recoverGame(serialized); assert.deepEqual(restored.market, game.market);
    const hops = Object.values(game.market.customers).filter(customer => {
      const first = customer.history.findIndex(item => item.from === 0 && item.to === 1);
      return first >= 0 && customer.history.slice(first + 1).some(item => item.from === 1);
    }).length;
    const result = { duration, strategy, migrations, config: game.market.config, seed: game.seed, finalTick: game.tick, status: game.status,
      wallSeconds: Math.round((performance.now() - started) * 1000) / 1e6, tickP95ms: percentile(ticks, .95), tickMaxMs: percentile(ticks, 1), saveP95ms: percentile(saves, .95), saveCadenceSeconds: 10,
      peak, populationChecks, requestChecks, archivedReceipts: receipts, population: 5000, unserved: game.unserved, totals: game.market.totals, novaVertexThenOut: hops, deadlines, administrativeAbandons,
      digest: createHash('sha256').update(serialized).digest('hex'), companies: marketSample(game).companies, samples, resources };
    console.log(JSON.stringify({ duration, strategy, migrations, finalTick: game.tick, wallSeconds: result.wallSeconds, transfers: result.totals.migrations, hops, unserved: result.unserved, tickP95ms: result.tickP95ms, saveP95ms: result.saveP95ms }));
    return result;
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
}
const sourceFiles = ['server/market.ts', 'server/engine.ts', 'server/traffic.ts', 'server/scenarios.ts', 'server/requests.ts', 'server/persistence.ts', 'server/load.ts', 'shared/types.ts', 'scripts/market-scenarios.ts'];
const sourceDigest = createHash('sha256').update(sourceFiles.map(path => path + '\n' + readFileSync(path, 'utf8')).join('\n')).digest('hex');
const filter = process.env.FLOW_BENCH_STRATEGY;
const results = [1200, 1500].flatMap(duration => MARKET_STRATEGIES.filter(strategy => !filter || strategy === filter).map(strategy => run(duration, strategy)));
const controls = filter && filter !== 'D-domino' ? [] : [1200, 1500].map(duration => run(duration, 'D-domino', false));
for (const result of results) {
  assert.equal(result.companies.reduce((sum, company) => sum + company.customers, result.unserved), 5000);
  if (result.strategy === 'A-equivalent') assert.equal(new Set(result.companies.map(company => company.customers)).size, 1);
  if (result.strategy === 'D-domino') {
    const control = controls.find(control => control.duration === result.duration)!;
    assert.ok(result.novaVertexThenOut > 0); assert.ok(result.companies[1].migratedOut > 0);
    assert.ok(result.companies[1].arrived > control.companies[1].arrived); assert.ok(result.companies[1].rejected > control.companies[1].rejected);
    assert.ok(result.companies[1].pressure > control.companies[1].pressure);
  }
  if (result.strategy === 'H-empty') { assert.equal(result.unserved, 5000); assert.ok(result.companies.every(company => company.eliminated)); }
}
const output = resolve('artifacts'); mkdirSync(output, { recursive: true });
const baselinePath = '/tmp/flow-war-base-bench.json';
let reproducedBase: unknown; try { reproducedBase = JSON.parse(readFileSync(baselinePath, 'utf8')); } catch { /* Optional local audit evidence, never required for a fresh checkout. */ }
writeFileSync(join(output, 'market-benchmark-market-3.0.json'), JSON.stringify({ version: 'market-3.0', sourceDigest, sourceFiles, hardware: { node: process.version, cpu: cpus()[0]?.model, cores: cpus().length, memoryGB: Math.round(totalmem() / 1024 ** 3) }, results, controls, reproducedBase }, null, 2));
