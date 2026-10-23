import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { io } from '../shared/live-client.js';
import { LOBBY_ICONS } from '../shared/lobby.js';
import type { Snapshot } from '../shared/types.js';
import { finishTutorial } from './tutorial-helpers.js';

test('real room: the draw, tutorials that hold EMPEZAR JUEGO, a restart, and a calm start with no bursts before minute 15', { timeout: 240000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-tutorial-')), listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = (listener.address() as { port: number }).port; await new Promise<void>(r => listener.close(() => r())); const base = `http://127.0.0.1:${port}`;
  await writeFile(join(dir, 'access.json'), JSON.stringify({ credentials: [{ code: 'operator-test', identity: { id: 'operator', role: 'operator', companyId: null }, label: 'Docente' }] }));
  // The default schedule on purpose: FLOW_CALM_START is not inherited from another test file.
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', FLOW_DATA_DIR: dir, FLOW_PORT: String(port), ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: '' }; delete env.FLOW_CALM_START;
  let child: ReturnType<typeof spawn>, phones: ReturnType<typeof io>[] = [];
  const launch = async () => { child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env, stdio: 'ignore' }); for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); } throw new Error('server did not start'); };
  const stop = async () => { for (const s of phones) s.disconnect(); phones = []; if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } };
  const post = (path: string, body: unknown, cookie = '') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const get = async (path: string, cookie = '') => (await fetch(base + path, { headers: { Cookie: cookie } })).json();
  const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];
  const connect = async (cookie: string, view: string) => { const s = io(base, { forceNew: true, transports: ['websocket'], extraHeaders: { Cookie: cookie }, auth: { view } }); phones.push(s); await new Promise<void>((res, rej) => { s.once('connect', () => res()); s.once('connect_error', rej); }); return s; };
  const send = (socket: ReturnType<typeof io>, type: string, payload: Record<string, unknown> = {}, companyId?: number) => new Promise<{ ok: boolean; code?: string; error?: string }>((res, rej) => socket.timeout(4000).emit('command', { id: `${type}-${Math.random()}`, type, companyId, payload }, (e: Error | null, r: { ok: boolean }) => e ? rej(e) : res(r)));
  const until = async (check: () => Promise<boolean>, ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 200)); } throw new Error('timeout'); };
  try {
    await launch();
    const operator = cookieOf(await post('/api/login', { code: 'operator-test' })), pin = (await get('/api/snapshot', operator)).lobby.pin as string;
    const players: { cookie: string }[] = [];
    for (let i = 1; i <= 26; i++) { const r = await post('/api/lobby/join', { pin, name: `Jugador ${i}`, icon: LOBBY_ICONS[i % LOBBY_ICONS.length] }); assert.equal(r.status, 200); players.push({ cookie: cookieOf(r) }); }
    assert.equal((await get('/api/tutorial', players[0].cookie)).pending, false, 'antes del sorteo nadie debe tutorial');
    assert.equal((await post('/api/lobby/form', {}, operator)).status, 200);
    const seats = await Promise.all(players.map(async p => (await get('/api/snapshot', p.cookie)).identity as { id: string; role: string; companyId: number | null }));
    assert.equal(seats.filter(s => s.role === 'auditor').length, 1);
    for (const p of players) assert.equal((await get('/api/tutorial', p.cookie)).pending, true);

    // Every phone is connected: the room waits for 26 tutorials, and the projector says who is missing.
    const control = await connect(operator, '/control');
    const sockets = await Promise.all(players.map(p => connect(p.cookie, '/unirse')));
    const start = await send(control, 'room.start');
    assert.equal(start.ok, false); assert.equal(start.code, 'TUTORIALS_PENDING'); assert.match(start.error!, /Faltan 26 jugadores/);
    let board = (await new Promise<Snapshot>(r => control.once('snapshot', r))).tutorials!;
    assert.equal(board.rows.length, 26); assert.equal(board.pending, 26);
    // A player still in its tutorial reaches nothing real, from any page.
    const cto = seats.findIndex(s => s.role === 'cto');
    assert.equal((await send(sockets[cto], 'cto.infra_authorize', { amount: 0, durationSeconds: 60, maxServers: 2, operations: ['scale'] }, seats[cto].companyId!)).code, 'TUTORIAL_PENDING');

    // Each player finishes its tutorial the way a browser does: real actions on its own practice copy.
    const played = await Promise.all(players.map(p => finishTutorial(base, p.cookie, 120000)));
    played.forEach((run, i) => assert(run.steps.length >= 4, `${seats[i].role}: ${run.steps.join(' → ')}`));
    for (const p of players) { const own = await get('/api/tutorial', p.cookie); assert.equal(own.pending, false); assert.equal(own.finished, true); }
    // The practice never touched the real companies.
    const room = await get('/api/snapshot', operator);
    for (const c of room.companies) { assert.equal(c.capital, 10000); assert.equal(c.version, 1); assert.equal(c.plan.nodes.length, 2); }
    assert.equal(room.changes.length, 0);

    // Progress is stored with the room: after a restart the reconnected room can start.
    await stop(); await launch();
    const again = await connect(operator, '/control');
    await Promise.all(players.map(p => connect(p.cookie, '/unirse')));
    assert.equal((await send(again, 'room.assembled', { enabled: true })).ok, true);
    assert.equal((await send(again, 'room.start')).ok, true);
    assert.equal((await send(again, 'room.speed', { speed: 20 })).ok, true);
    const auditor = await connect(players[seats.findIndex(s => s.role === 'auditor')].cookie, '/workspace');
    assert.equal((await send(auditor, 'audit.probe', { companyId: 1, nodeId: 'backend-write', check: 'waf' })).code, 'CALM_PHASE');

    // Calm phase: light traffic only, no LAST-UNIT bursts and no anomalous traffic until minute 15.
    let snapshot: Snapshot = await get('/api/snapshot', operator);
    await until(async () => { snapshot = await get('/api/snapshot', operator); return snapshot.tick >= 880; }, 120000);
    assert.equal(snapshot.phase?.phase, 'calm');
    for (const c of snapshot.companies) {
      assert.equal(c.concurrency.totals.generated, 0, `${c.name}: sin ráfagas antes del minuto 15`);
      assert.equal(c.traffic.malicious!.generated, 0, `${c.name}: sin tráfico anómalo antes del minuto 15`);
      assert(c.traffic.legitimate!.generated > 0, `${c.name}: atiende clientes`);
    }
    assert(!snapshot.events.some(e => /Ráfagas|anómalo detectado/.test(e.text)));
    await until(async () => { snapshot = await get('/api/snapshot', operator); return snapshot.tick >= 905; }, 30000);
    assert.equal(snapshot.phase?.phase, 'ramp');
    assert(snapshot.companies.some(c => c.concurrency.totals.generated > 0), 'la presión empieza en el minuto 15');
    assert(snapshot.events.some(e => e.text.startsWith('Termina la fase tranquila')));
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});
