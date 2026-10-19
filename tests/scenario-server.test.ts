import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { io, type Socket } from 'socket.io-client';
import type { Command, Identity, Result, Snapshot } from '../shared/types.js';
import { createGame } from '../server/engine.js';
import { advanceConcurrency } from '../server/requests.js';
import { startConcurrency } from '../server/scenarios.js';
import { insertBlock } from './helpers.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function unusedPort() {
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = (listener.address() as {port: number}).port;
  await new Promise<void>(resolve => listener.close(() => resolve())); return port;
}
async function stop(child: ChildProcess | undefined) {
  if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
}

test('real server resumes a saved race, preserves sessions and enforces the complete Atomic deployment pipeline', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flow-war-scenario-server-'));
  const port = await unusedPort(), base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  const sockets: Socket[] = [], latest = new Map<Socket, Snapshot>();
  try {
    const game = createGame(); game.status = 'RUNNING'; game.tick = 361;
    const company = game.companies[0]; company.concurrency.nextAt = 405;
    startConcurrency(company, 360); advanceConcurrency(company.concurrency.run!, 360.5); advanceConcurrency(company.concurrency.run!, 361);
    const initialIds = company.concurrency.run!.requests.map(request => request.id);
    const db = new DatabaseSync(join(directory, 'game.sqlite')); db.exec('CREATE TABLE game (id INTEGER PRIMARY KEY, state TEXT NOT NULL)');
    db.prepare('INSERT INTO game VALUES (1,?)').run(JSON.stringify(game)); db.close();
    async function boot() {
      child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, NODE_ENV: 'production', FLOW_PORT: String(port), FLOW_DATA_DIR: directory }, stdio: 'ignore' });
      for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await delay(50); }
      throw new Error('Server did not become ready');
    }
    async function socketWithCookie(cookie: string) {
      const socket = io(base, { autoConnect: false, forceNew: true, transports: ['websocket'], extraHeaders: { Cookie: cookie } });
      sockets.push(socket); socket.on('snapshot', snapshot => latest.set(socket, snapshot));
      const connected = new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      socket.connect(); await connected; return socket;
    }
    async function connect(role: string, companyId: number | null) {
      const { credentials } = JSON.parse(await readFile(join(directory, 'access.json'), 'utf8')) as { credentials: {code: string; identity: Identity}[] };
      const code = credentials.find(item => item.identity.role === role && item.identity.companyId === companyId)!.code;
      const response = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      assert.equal(response.status, 200); const cookie = response.headers.get('set-cookie')!.split(';')[0];
      return { socket: await socketWithCookie(cookie), cookie };
    }
    async function waitState(socket: Socket, predicate: (snapshot: Snapshot) => boolean) {
      for (let i = 0; i < 160; i++) { const snapshot = latest.get(socket); if (snapshot && predicate(snapshot)) return snapshot; await delay(50); }
      throw new Error('Timed out waiting for scenario state');
    }
    const run = (socket: Socket, command: Omit<Command, 'id'> & {id?: string}) => new Promise<Result>((resolve, reject) => socket.timeout(3000).emit('command', { ...command, id: command.id ?? crypto.randomUUID() }, (error: Error | null, result: Result) => error ? reject(error) : resolve(result)));

    await boot();
    const operator = await connect('operator', null), backend = await connect('backend', 0);
    const paused = await waitState(backend.socket, snapshot => snapshot.status === 'PAUSED');
    assert.deepEqual(paused.privateCompany!.concurrency.run!.requests.map(request => request.read), [{ stock: 1, version: 0 }, { stock: 1, version: 0 }]);
    assert.equal((await run(operator.socket, { type: 'room.start' })).ok, true);
    assert.equal((await run(operator.socket, { type: 'room.speed', payload: { speed: 20 } })).ok, true);
    const settled = await waitState(backend.socket, snapshot => snapshot.companies[0].concurrency.totals.completed === 2);
    const ordinaryId = settled.companies[0].particles.find(particle => particle.requestId && !particle.requestId.startsWith('C0-CC'))!.requestId!;
    assert.equal(settled.companies[0].concurrency.totals.oversold, 1); assert.equal(settled.companies[0].concurrency.totals.revenue, 45);
    assert.equal((await run(operator.socket, { type: 'room.pause' })).ok, true);
    for (const socket of sockets) socket.disconnect();
    await stop(child); await boot();
    const op = await socketWithCookie(operator.cookie), be = await socketWithCookie(backend.cookie);
    const recovered = await waitState(be, snapshot => snapshot.status === 'PAUSED');
    assert.deepEqual(recovered.privateCompany!.concurrency.run!.requests.map(request => request.id), initialIds);
    assert.deepEqual(recovered.companies[0].concurrency.totals, settled.companies[0].concurrency.totals);
    const otherSession = await connect('qa', 1);
    const qa = (await connect('qa', 0)).socket, cto = (await connect('cto', 0)).socket, devops = (await connect('devops', 0)).socket, other = otherSession.socket;
    assert.equal((await run(op, { type: 'room.start' })).ok, true);
    const submit = { id: 'atomic-submission', type: 'change.submit', companyId: 0, payload: { graph: insertBlock('atomic'), revision: 0 } };
    assert.equal((await run(be, submit)).ok, true); assert.equal((await run(be, submit)).ok, true);
    const submitted = await waitState(qa, snapshot => snapshot.changes.length === 1), changeId = submitted.changes[0].id;
    assert.equal((await run(be, { type: 'deploy.start', companyId: 0, changeId })).code, 'FORBIDDEN');
    assert.equal((await run(other, { type: 'qa.approve', companyId: 0, changeId })).code, 'FORBIDDEN');
    assert.equal((await run(cto, { type: 'cto.authorize', companyId: 0, changeId })).ok, false);
    assert.equal((await run(qa, { type: 'qa.approve', companyId: 0, changeId })).ok, false);
    assert.equal((await run(devops, { type: 'deploy.start', companyId: 0, changeId, payload: { strategy: 'rolling' } })).ok, false);
    assert.equal((await run(qa, { type: 'qa.run', companyId: 0, changeId, payload: { suite: 'Concurrencia' } })).ok, true);
    const tested = await waitState(qa, snapshot => snapshot.changes[0].reports.length === 1), report = tested.changes[0].reports[0];
    assert.deepEqual([report.requests, report.completed, report.rejected, report.oversold], [2, 1, 1, 0]);
    assert.equal(tested.companies[0].version, 1);
    assert.equal((await run(qa, { type: 'qa.approve', companyId: 0, changeId })).ok, true);
    assert.equal((await run(cto, { type: 'cto.authorize', companyId: 0, changeId })).ok, true);
    const deploy = { id: 'deploy-once', type: 'deploy.start', companyId: 0, changeId, payload: { strategy: 'rolling' } };
    assert.equal((await run(devops, deploy)).ok, true); assert.equal((await run(devops, deploy)).ok, true);
    const deployed = await waitState(be, snapshot => snapshot.companies[0].version === 2);
    assert.equal(deployed.companies[0].deployments, 1); assert.equal(deployed.privateCompany!.reserved, 0);
    const observed = await waitState(be, snapshot => {
      const run = snapshot.privateCompany!.concurrency.run;
      return !!run && run.requests[0].executionVersion === 2 && run.requests.every(request => !!request.result);
    });
    const production = observed.privateCompany!.concurrency.run!;
    assert.equal(production.backendHash, report.evidence!.backendHash);
    assert.equal(production.inventory.stock, 0); assert.equal(production.inventory.committed, 1); assert.equal(production.inventory.oversold, 0);
    assert.deepEqual(production.requests.map(request => request.status), ['COMPLETED', 'REJECTED']);
    const publicSnapshot = await (await fetch(`${base}/api/snapshot`)).json() as Snapshot;
    assert.equal(publicSnapshot.changes.length, 0); assert.equal('run' in publicSnapshot.companies[0].concurrency, false);
    assert.ok(publicSnapshot.events.some(event => event.category === 'CONCURRENCIA'));
    const receiptResponse = await fetch(`${base}/api/requests/${ordinaryId}`, {headers:{Cookie:backend.cookie}});
    assert.equal(receiptResponse.status,200);const receipt=await receiptResponse.json();assert.equal(receipt.id,ordinaryId);assert.equal(receipt.companyId,0);assert.equal(receipt.accounted,true);
    assert.equal((await fetch(`${base}/api/requests/${ordinaryId}`)).status,403);
    assert.equal((await fetch(`${base}/api/requests/${ordinaryId}`,{headers:{Cookie:otherSession.cookie}})).status,404);
  } finally { for (const socket of sockets) socket.disconnect(); await stop(child); await rm(directory, { recursive: true, force: true }); }
});

test('real server backs up a v1 snapshot before upgrading it', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flow-war-upgrade-server-'));
  const port = await unusedPort(); let child: ChildProcess | undefined;
  try {
    const legacy = JSON.parse(JSON.stringify(createGame())); legacy.schema = 1; legacy.status = 'RUNNING'; legacy.tick = 200;
    for (const company of legacy.companies) delete company.concurrency;
    const serialized = JSON.stringify(legacy), path = join(directory, 'game.sqlite');
    let db = new DatabaseSync(path); db.exec('CREATE TABLE game (id INTEGER PRIMARY KEY, state TEXT NOT NULL)'); db.prepare('INSERT INTO game VALUES (1,?)').run(serialized); db.close();
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, NODE_ENV: 'production', FLOW_PORT: String(port), FLOW_DATA_DIR: directory }, stdio: 'ignore' });
    let ready = false;
    for (let i = 0; i < 100; i++) { try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch {} if (ready) break; await delay(50); }
    assert.equal(ready, true); await stop(child);
    db = new DatabaseSync(path);
    assert.equal((db.prepare('SELECT state FROM game_migrations WHERE schema=1').get() as {state:string}).state, serialized);
    const state = JSON.parse((db.prepare('SELECT state FROM game WHERE id=1').get() as {state:string}).state); db.close();
    assert.equal(state.schema, 5); assert.equal(state.status, 'PAUSED'); assert.equal(state.tick, 200);
    assert.equal(state.companies[0].concurrency.totals.generated, 0);
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
});
