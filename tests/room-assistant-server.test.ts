import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { io } from '../shared/live-client.js';
import { LOBBY_ICONS } from '../shared/lobby.js';

async function freePort() { const l = createServer(); l.listen(0, '127.0.0.1'); await once(l, 'listening'); const port = (l.address() as { port: number }).port; await new Promise<void>(r => l.close(() => r())); return port; }
const NAMES = ['NOVA', 'VERTEX', 'BYTE', 'EMBER', 'ORBIT'];

test('room screen: Claude moves players over HTTP, phones follow, the change survives a restart and stops at EMPEZAR JUEGO', { timeout: 60000 }, async () => {
  // Local stand-in for the Messages API: it reads the teacher order and answers with the tool call a model would make.
  const received: any[] = [];
  const mock = createHttpServer((req, res) => {
    let raw = ''; req.on('data', d => raw += d); req.on('end', () => {
      const body = JSON.parse(raw), order = JSON.parse(body.messages[0].content).orden as string; received.push(body);
      const move = order.match(/^pasá a (.+) a (\w+)$/), swap = order.match(/^intercambiá a (.+) con (.+)$/);
      const calls = move ? [{ name: 'mover_jugador', input: { jugador: move[1], empresa: move[2], citas: [order] } }] : swap ? [{ name: 'intercambiar', input: { jugador_a: swap[1], jugador_b: swap[2], citas: [order] } }] : [{ name: 'rechazar_instruccion', input: { motivo: 'FUERA_DE_FUNCION' } }];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: `msg_${received.length}`, type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', content: calls.map((c, i) => ({ type: 'tool_use', id: `toolu_${i}`, name: c.name, input: c.input })), usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
    });
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const mockPort = (mock.address() as { port: number }).port, port = await freePort(), base = `http://127.0.0.1:${port}`;
  const dir = await mkdtemp(join(tmpdir(), 'flow-room-assistant-'));
  await writeFile(join(dir, 'access.json'), JSON.stringify({ credentials: [{ code: 'operator-test', identity: { id: 'operator', role: 'operator', companyId: null }, label: 'Docente' }] }));
  const env = { ...process.env, NODE_ENV: 'production', FLOW_DATA_DIR: dir, FLOW_PORT: String(port), ANTHROPIC_API_KEY: 'sk-local-test-key', ANTHROPIC_MODEL: 'claude-test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mockPort}`, ANTHROPIC_WORKSPACE_ID: '' };
  let child: ReturnType<typeof spawn>, sockets: ReturnType<typeof io>[] = [];
  const launch = async () => { child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env, stdio: 'ignore' }); for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* starting */ } await new Promise(r => setTimeout(r, 50)); } throw new Error('server not ready'); };
  const stop = async () => { for (const s of sockets) s.disconnect(); sockets = []; if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } };
  const post = (path: string, body: unknown, cookie = '') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const get = async (path: string, cookie = '') => (await fetch(base + path, { headers: { Cookie: cookie } })).json();
  const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];
  const ask = async (cookie: string, text: string) => { const r = await post('/api/lobby/assistant', { id: `room-${Math.random()}`, text }, cookie); return { status: r.status, body: await r.json() }; };
  try {
    await launch();
    const operator = cookieOf(await post('/api/login', { code: 'operator-test' }));
    const pin = (await get('/api/snapshot', operator)).lobby.pin as string;
    const players: { cookie: string; name: string }[] = [];
    for (let i = 1; i <= 26; i++) { const name = `Jugador ${i}`, r = await post('/api/lobby/join', { pin, name, icon: LOBBY_ICONS[i % LOBBY_ICONS.length] }); assert.equal(r.status, 200); players.push({ cookie: cookieOf(r), name }); }
    // Before the draw nothing reaches the provider.
    assert.equal((await ask(operator, 'pasá a Jugador 1 a EMBER')).body.code, 'NO_TEAMS'); assert.equal(received.length, 0);
    assert.equal((await post('/api/lobby/form', {}, operator)).status, 200);
    // Seated players act for a company; whoever is in the reserve is an external auditor (no company).
    const seatOf = async (p: { cookie: string }) => { const identity = (await get('/api/snapshot', p.cookie)).identity as { id: string; role: string; companyId: number | null }; return identity.companyId === null ? null : identity as { id: string; companyId: number }; };
    const seats = await Promise.all(players.map(seatOf));
    const seated = players.find((_, i) => seats[i])!, from = seats[players.indexOf(seated)]!.companyId, target = (from + 1) % 5;

    assert.equal((await ask(players[0].cookie, `pasá a ${seated.name} a ${NAMES[target]}`)).status, 403, 'only the teacher');
    const moved = await ask(operator, `pasá a ${seated.name} a ${NAMES[target]}`);
    assert.equal(moved.status, 200); assert.equal(moved.body.reply.state, 'EXECUTED', moved.body.reply.message);
    assert.match(moved.body.reply.message, new RegExp(`${seated.name} pasó de ${NAMES[from]} a ${NAMES[target]} como`));
    assert.equal((await seatOf(seated))!.companyId, target, 'the phone session resolves its new seat');
    const after = await Promise.all(players.map(seatOf)), ids = after.filter(Boolean).map(s => s!.id);
    assert.equal(ids.length, 25); assert.equal(new Set(ids).size, 25, 'one player per company role');
    assert.equal(after.filter(s => s?.companyId === from).length, after.filter(s => s?.companyId === target).length);

    // The reserve player takes a seat; the displaced member goes to the reserve and loses the seat identity.
    const spare = players[after.findIndex(s => !s)];
    const entered = await ask(operator, `pasá a ${spare.name} a NOVA`);
    assert.equal(entered.body.reply.state, 'EXECUTED'); assert.match(entered.body.reply.message, /entró a NOVA como .* pasó a la reserva\./);
    assert.equal((await seatOf(spare))!.companyId, 0);
    assert.equal((await Promise.all(players.map(seatOf))).filter(s => !s).length, 1);
    assert.equal((await Promise.all(players.map(async p => (await get('/api/snapshot', p.cookie)).identity.role))).filter(r => r === 'auditor').length, 1, 'the displaced member audits');
    assert.match((await ask(operator, 'pasá a Nadie a NOVA')).body.reply.message, /No encuentro a "Nadie" en la sala\. No se movió a nadie\./);
    assert.equal((await ask(operator, 'contame un chiste')).body.reply.state, 'DECLINED');

    // The provider received strict room tools and only the order and company names.
    const last = received.at(-1);
    assert.deepEqual(last.tools.map((t: { name: string }) => t.name), ['mover_jugador', 'intercambiar', 'solicitar_dato', 'rechazar_instruccion']);
    for (const b of received) { assert.deepEqual(Object.keys(JSON.parse(b.messages[0].content)), ['orden', 'empresas']); assert.equal(b.model, 'claude-test'); }
    const status = await get('/api/ai/status', operator);
    assert.equal(status.consumption.room.requests, 4); assert.equal(status.consumption.room.inputTokens, 480);

    // Durable: the move survives a restart.
    await stop(); await launch();
    assert.equal((await seatOf(seated))!.companyId, target); assert.equal((await seatOf(spare))!.companyId, 0);
    const swapped = await ask(operator, `intercambiá a ${seated.name} con ${spare.name}`);
    assert.equal(swapped.body.reply.state, 'EXECUTED'); assert.equal((await seatOf(seated))!.companyId, 0); assert.equal((await seatOf(spare))!.companyId, target);

    // EMPEZAR JUEGO freezes the teams; no more provider calls.
    const socket = io(base, { forceNew: true, transports: ['websocket'], extraHeaders: { Cookie: operator } }); sockets.push(socket);
    await new Promise<void>((res, rej) => { socket.once('connect', res); socket.once('connect_error', rej); });
    const started = await new Promise<{ ok: boolean }>((res, rej) => socket.timeout(3000).emit('command', { id: 'start-1', type: 'room.start' }, (e: Error | null, r: { ok: boolean }) => e ? rej(e) : res(r)));
    assert.equal(started.ok, true);
    const calls = received.length, late = await ask(operator, `pasá a ${seated.name} a ORBIT`);
    assert.equal(late.status, 409); assert.equal(late.body.code, 'GAME_STARTED'); assert.equal(received.length, calls);
    assert(!JSON.stringify(late.body).includes('sk-local-test-key'));
  } finally { await stop(); mock.close(); await rm(dir, { recursive: true, force: true }); }
});
