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

test('room over HTTP: PIN join, teacher-only draw, seated sessions act as their role and survive a restart', { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-lobby-')), listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = (listener.address() as { port: number }).port; await new Promise<void>(r => listener.close(() => r())); const base = `http://127.0.0.1:${port}`;
  await writeFile(join(dir, 'access.json'), JSON.stringify({ credentials: [{ code: 'operator-test', identity: { id: 'operator', role: 'operator', companyId: null }, label: 'Docente' }] }));
  let child: ReturnType<typeof spawn>, sockets: ReturnType<typeof io>[] = [];
  const launch = async () => { child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, NODE_ENV: 'production', FLOW_DATA_DIR: dir, FLOW_PORT: String(port), ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: '' }, stdio: 'ignore' }); for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* starting */ } await new Promise(r => setTimeout(r, 50)); } throw new Error('server not ready'); };
  const stop = async () => { for (const s of sockets) s.disconnect(); sockets = []; if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } };
  const post = (path: string, body: unknown, cookie = '') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const get = async (path: string, cookie = '') => (await fetch(base + path, { headers: { Cookie: cookie } })).json();
  const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];
  const send = async (cookie: string, type: string, payload: Record<string, unknown> = {}, companyId?: number) => {
    const socket = io(base, { forceNew: true, transports: ['websocket'], extraHeaders: { Cookie: cookie } }); sockets.push(socket);
    await new Promise<void>((res, rej) => { socket.once('connect', res); socket.once('connect_error', rej); });
    return new Promise<{ ok: boolean; error?: string }>((res, rej) => socket.timeout(3000).emit('command', { id: `${type}-${Math.random()}`, type, companyId, payload }, (e: Error | null, r: { ok: boolean }) => e ? rej(e) : res(r)));
  };
  try {
    await launch();
    const operator = cookieOf(await post('/api/login', { code: 'operator-test' }, ''));
    const pin = (await get('/api/snapshot', operator)).lobby.pin as string;
    assert.match(pin, /^\d{6}$/); assert.equal((await get('/api/snapshot')).lobby.pin, undefined);
    assert(Array.isArray((await get('/api/lobby/info', operator)).joinUrls)); assert.equal((await fetch(base + '/api/lobby/info')).status, 403);
    assert.equal((await post('/api/lobby/check', { pin: pin === '123456' ? '654321' : '123456' })).status, 401);
    assert.equal((await post('/api/lobby/check', { pin })).status, 200);

    const players: { cookie: string; id: string }[] = [];
    const joinAs = async (name: string, icon = LOBBY_ICONS[players.length % LOBBY_ICONS.length]) => { const r = await post('/api/lobby/join', { pin, name, icon }); assert.equal(r.status, 200, name); const p = { cookie: cookieOf(r), id: (await r.json()).participant.id }; players.push(p); return p; };
    for (let i = 1; i <= 24; i++) await joinAs(`Jugador ${i}`);
    assert.equal((await (await post('/api/lobby/join', { pin, name: 'jugador 3', icon: '🐢' })).json()).code, 'NAME_TAKEN');
    assert.equal((await (await post('/api/lobby/join', { pin, name: 'Otra vez', icon: '🐢' }, players[0].cookie)).json()).participant.id, players[0].id, 'the same browser does not join twice');
    assert.equal((await (await post('/api/lobby/form', {}, operator)).json()).code, 'NOT_ENOUGH');
    assert.equal((await post('/api/lobby/form', {}, players[0].cookie)).status, 403);
    // A player leaves and the teacher removes another; both seats are refilled.
    assert.equal((await post('/api/lobby/leave', {}, players[1].cookie)).status, 200); assert.equal((await get('/api/lobby/me', players[1].cookie)).participant, null);
    assert.equal((await post('/api/lobby/remove', { id: players[2].id }, operator)).status, 200); assert.equal((await get('/api/lobby/me', players[2].cookie)).participant, null);
    assert.equal((await post('/api/lobby/remove', { id: players[3].id }, players[4].cookie)).status, 403);
    for (const name of ['Jugador 25', 'Jugador 26', 'Jugador 27', 'Jugador 28']) await joinAs(name);
    const present = players.filter((_, i) => i !== 1 && i !== 2);
    assert.equal((await get('/api/snapshot')).lobby.participants.length, 26);

    assert.equal((await post('/api/lobby/form', {}, operator)).status, 200);
    assert.equal((await (await post('/api/lobby/join', { pin, name: 'Tarde', icon: '🐢' })).json()).code, 'TEAMS_FORMED');
    const seats = await Promise.all(present.map(async p => (await get('/api/snapshot', p.cookie)).identity));
    const seated = seats.filter(Boolean), ids = new Set(seated.map(s => s.id));
    assert.equal(seated.length, 25); assert.equal(ids.size, 25);
    for (let c = 0; c < 5; c++) for (const role of ['backend', 'security', 'qa', 'cto', 'devops']) assert(ids.has(`${c}-${role}`), `${c}-${role}`);
    const spare = present[seats.findIndex(s => !s)], spareMe = (await get('/api/lobby/me', spare.cookie)).participant;
    assert.equal(spareMe.companyId, undefined);
    assert.equal((await get('/api/snapshot', spare.cookie)).lobby.formation.reserve[0].id, spareMe.id);

    // A seated player sends commands with the identity the draw gave them.
    assert.equal((await send(operator, 'room.start')).ok, true);
    const cto = present[seats.findIndex(s => s?.role === 'cto' && s.companyId === 0)];
    assert.equal((await send(cto.cookie, 'cto.infra_authorize', { amount: 0, durationSeconds: 60, maxServers: 2, operations: ['scale'] }, 0)).ok, true);
    assert.equal((await send(spare.cookie, 'cto.infra_authorize', { amount: 0, durationSeconds: 60, maxServers: 2, operations: ['scale'] }, 0)).ok, false);

    await stop(); await launch();
    assert.equal((await get('/api/snapshot', cto.cookie)).identity.id, '0-cto', 'the seat survives a restart');
    assert.equal((await send(operator, 'room.reset', { duration: 1500 })).ok, true);
    await new Promise(r => setTimeout(r, 200));
    assert.equal((await get('/api/snapshot', cto.cookie)).identity, null, 'a reset returns everyone to the room');
    assert.equal((await get('/api/lobby/me', cto.cookie)).participant.id, present[seats.findIndex(s => s?.role === 'cto' && s.companyId === 0)].id);
    assert.equal((await get('/api/snapshot', operator)).lobby.pin, pin);
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});
