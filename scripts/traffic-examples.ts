import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { applyCommand, assembleGame, createGame, step } from '../server/engine.js';
import { admitTraffic, advanceTraffic } from '../server/traffic.js';
import { recoverGame } from '../server/persistence.js';
import { createGameWriter } from '../server/storage.js';

// fifo-eight-1: an intentionally slow Web service, configured before admission.
const game = createGame(1500, 7357); assembleGame(game);
const company = game.companies[0];
company.traffic.config.rates.web = 1;
company.traffic.config.patience.browse = 30;
const requests = Array.from({ length: 8 }, () => admitTraffic(company, 0));
const run = (target: typeof company, until: number) => {
  for (let tick = Math.round(target.traffic.lastTick * 10) + 1; tick <= until * 10; tick++) advanceTraffic(target, tick / 10);
};
run(company, 2);
const snapshot = { at: 2, webStarted: company.traffic.services.web.started, webWaiting: company.traffic.services.web.waiting.length, completed: company.traffic.totals.completed };
const scaled = structuredClone(company), unchanged = structuredClone(company);
scaled.servers = 4; scaled.balancer = true;
assert.equal(scaled.queue, company.queue);
run(scaled, 4); run(unchanged, 4);
assert.ok(scaled.queue < unchanged.queue);

// Save the exact FIFO at second 2, recover paused, and compare continued work.
game.tick = 2; game.status = 'RUNNING';
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE commands (identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');
const write = createGameWriter(db); write(game);
const restored = recoverGame((db.prepare('SELECT state FROM game').get() as { state: string }).state);
assert.equal(restored.status, 'PAUSED');
const beforePause = JSON.stringify(restored);
step(restored, 10); assert.equal(JSON.stringify(restored), beforePause);
assert.deepEqual(restored.companies[0].traffic.services.web.waiting, company.traffic.services.web.waiting);
applyCommand(restored, { id: 'example-docente', role: 'operator', companyId: null }, { id: 'resume', type: 'room.start' });
run(restored.companies[0], 4); write(restored);
assert.deepEqual(restored.companies[0].traffic.totals, unchanged.traffic.totals);
const archived = (db.prepare('SELECT count(*) AS n FROM request_receipts WHERE companyId=0').get() as { n: number }).n;
assert.equal(archived, unchanged.traffic.totals.completed);
db.close();

const unavailableGame = createGame(); assembleGame(unavailableGame);
const unavailable = unavailableGame.companies[0]; unavailable.infraBudget = 0;
const abandoned = admitTraffic(unavailable, 0, 'purchase'); run(unavailable, 11);
assert.equal(abandoned.status, 'ABANDONED');
console.log(JSON.stringify({ fixture: 'fifo-eight-1', seed: 7357, snapshot,
  at4: { oneServer: { waiting: unchanged.queue, completed: unchanged.traffic.totals.completed }, fourServers: { waiting: scaled.queue, completed: scaled.traffic.totals.completed } },
  recovery: { pausedWithoutChanges: true, fifoPreserved: true, totalsEqual: true, archived },
  unavailablePurchase: { requestId: abandoned.id, arrivedAt: abandoned.arrivalAt, deadline: abandoned.deadline, finishedAt: abandoned.finishedAt, reason: abandoned.result?.reason, service: abandoned.result?.service, revenue: unavailable.revenue, lostRevenue: unavailable.lostRevenue, capital: unavailable.capital, committed: abandoned.committed },
  admitted: requests.map(request => request.id),
}, null, 2));
