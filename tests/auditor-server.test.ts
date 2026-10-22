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

test('auditors over HTTP and sockets; Backend drafts a module with Claude; probes survive a restart', { timeout: 90000 }, async () => {
  // Local stand-in for the Messages API (no paid calls): it answers with the tool call a model would make.
  const received: any[] = [];
  const mock = createHttpServer((req, res) => {
    let raw = ''; req.on('data', d => raw += d); req.on('end', () => {
      const body = JSON.parse(raw), order = JSON.parse(body.messages[0].content).instruccion as string; received.push(body);
      const calls = /módulo de inicio de sesión/.test(order)
        ? [{ name: 'backend_disenar_modulo', input: { nombre: 'Inicio de sesión', componentes: ['usuario', 'contraseña', 'token'], descripcion: 'El usuario envía su contraseña y recibe un token para comprar.', citas: ['Necesito un módulo de inicio de sesión'] } }]
        : [{ name: 'rechazar_instruccion', input: { motivo: 'NO_DISPONIBLE' } }];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: `msg_${received.length}`, type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', content: calls.map((c, i) => ({ type: 'tool_use', id: `toolu_${i}`, name: c.name, input: c.input })), usage: { input_tokens: 300, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
    });
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const mockPort = (mock.address() as { port: number }).port, port = await freePort(), base = `http://127.0.0.1:${port}`;
  const dir = await mkdtemp(join(tmpdir(), 'flow-audit-'));
  await writeFile(join(dir, 'access.json'), JSON.stringify({ credentials: [
    { code: 'operator-test', identity: { id: 'operator', role: 'operator', companyId: null }, label: 'Docente' },
    { code: 'backend-test', identity: { id: '0-backend', role: 'backend', companyId: 0 }, label: 'NOVA / backend' },
    { code: 'qa-test', identity: { id: '0-qa', role: 'qa', companyId: 0 }, label: 'NOVA / qa' },
  ] }));
  const env = { ...process.env, NODE_ENV: 'production', FLOW_DATA_DIR: dir, FLOW_PORT: String(port), ANTHROPIC_API_KEY: 'sk-local-test-key', ANTHROPIC_MODEL: 'claude-test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mockPort}`, ANTHROPIC_WORKSPACE_ID: '' };
  let child: ReturnType<typeof spawn>, sockets: ReturnType<typeof io>[] = [];
  const launch = async () => { child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env, stdio: 'ignore' }); for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* starting */ } await new Promise(r => setTimeout(r, 50)); } throw new Error('server not ready'); };
  const stop = async () => { for (const s of sockets) s.disconnect(); sockets = []; if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } };
  const post = (path: string, body: unknown, cookie = '') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const get = async (path: string, cookie = '') => (await fetch(base + path, { headers: { Cookie: cookie } })).json();
  const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];
  const send = async (cookie: string, type: string, payload: Record<string, unknown> = {}, companyId?: number) => {
    const socket = io(base, { forceNew: true, transports: ['websocket'], extraHeaders: { Cookie: cookie } }); sockets.push(socket);
    await new Promise<void>((res, rej) => { socket.once('connect', res); socket.once('connect_error', rej); });
    return new Promise<{ ok: boolean; error?: string; code?: string }>((res, rej) => socket.timeout(3000).emit('command', { id: `${type}-${Math.random()}`, type, companyId, payload }, (e: Error | null, r: { ok: boolean }) => e ? rej(e) : res(r)));
  };
  const until = async (check: () => Promise<boolean>, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('timeout'); };
  try {
    await launch();
    const operator = cookieOf(await post('/api/login', { code: 'operator-test' }));
    const pin = (await get('/api/snapshot', operator)).lobby.pin as string;
    const players: { cookie: string; name: string }[] = [];
    for (let i = 1; i <= 26; i++) { const name = `Jugador ${i}`, r = await post('/api/lobby/join', { pin, name, icon: LOBBY_ICONS[i % LOBBY_ICONS.length] }); assert.equal(r.status, 200); players.push({ cookie: cookieOf(r), name }); }
    assert.equal((await post('/api/lobby/form', {}, operator)).status, 200);
    const identities = await Promise.all(players.map(async p => (await get('/api/snapshot', p.cookie)).identity));
    const auditorIndex = identities.findIndex(i => i.role === 'auditor'), auditor = players[auditorIndex];
    assert.equal(identities.filter(i => i.role === 'auditor').length, 1); assert.match(identities[auditorIndex].id, /^auditor-P\d+$/);
    const member = players[identities.findIndex(i => i.companyId === 1)];

    // The auditor's projection is the module/control view only.
    let view = await get('/api/snapshot', auditor.cookie);
    assert.equal(view.auditor.companies.length, 5); assert.equal(view.privateCompany, undefined); assert.equal(view.operations, undefined); assert.equal(view.slack, undefined); assert.deepEqual(view.changes, []);
    assert((await get('/api/snapshot', member.cookie)).auditor === undefined);
    assert.equal((await send(auditor.cookie, 'audit.probe', { companyId: 1, nodeId: 'backend-write', check: 'waf' })).code, 'ROOM_PAUSED');

    assert.equal((await send(operator, 'room.assembled', { enabled: true })).ok, true);
    assert.equal((await send(operator, 'room.start')).ok, true);
    const backend = cookieOf(await post('/api/login', { code: 'backend-test' })), qa = cookieOf(await post('/api/login', { code: 'qa-test' }));

    // Backend: Claude drafts the module in words; the server leaves controles pendientes and sends it to Seguridad.
    const designed = await (await post('/api/ai/execute', { id: 'design-1', text: 'Necesito un módulo de inicio de sesión' }, backend)).json();
    assert.equal(designed.ok, true, JSON.stringify(designed)); assert.equal(designed.reply.state, 'EXECUTED', designed.reply.message);
    assert.match(designed.reply.message, /Diseño de «Inicio de sesión» · componentes: usuario, contraseña, token\./);
    const own = await get('/api/snapshot', backend);
    assert.deepEqual(own.operations.modules[0].design.components, ['usuario', 'contraseña', 'token']); assert.equal(own.operations.modules[0].defects, undefined);
    assert.equal(own.changes[0].status, 'SECURITY_PENDING');
    assert.match(JSON.stringify(received.at(-1).system), /Excepción solo para Backend/);
    assert(received.at(-1).tools.some((t: { name: string }) => t.name === 'backend_disenar_modulo'));
    await post('/api/ai/execute', { id: 'qa-1', text: 'Ejecutá la suite Seguridad' }, qa);
    assert.doesNotMatch(JSON.stringify(received.at(-1).system), /Excepción solo para Backend/, 'QA keeps the strict executor');
    assert(!received.at(-1).tools.some((t: { name: string }) => t.name === 'backend_disenar_modulo'));

    // A prueba de control through the socket pipeline.
    const launched = await send(auditor.cookie, 'audit.probe', { companyId: 1, nodeId: 'backend-write', check: 'waf' });
    assert.equal(launched.ok, true, launched.error);
    assert.equal((await send(auditor.cookie, 'audit.probe', { companyId: 2, nodeId: 'backend-read', check: 'auth' })).code, 'PROBE_ACTIVE');
    assert.equal((await send(member.cookie, 'audit.probe', { companyId: 1, nodeId: 'backend-read', check: 'auth' })).ok, false, 'company roles cannot probe');
    assert.equal((await send(auditor.cookie, 'cto.infra_authorize', { amount: 0, durationSeconds: 60, maxServers: 2, operations: ['scale'] }, 1)).ok, false);
    const events = (await get('/api/snapshot', member.cookie)).events.filter((e: { text: string }) => e.text.startsWith('Tráfico inusual'));
    assert.equal(events.length, 1); assert(!JSON.stringify(events).includes(auditor.name) && !JSON.stringify(events).includes(identities[auditorIndex].id), 'no auditor name');
    // Endpoints that belong to company employees refuse the auditor.
    assert.equal((await post('/api/ai/execute', { id: 'a-1', text: 'Lanzá una prueba' }, auditor.cookie)).status, 403);
    assert.equal((await post('/api/ai', { id: 'a-2', kind: 'security.compile', text: 'x' }, auditor.cookie)).status, 403);
    assert.equal((await fetch(base + '/api/flowslack', { headers: { Cookie: auditor.cookie } })).status, 403);
    assert.equal((await fetch(base + '/api/dvr/0', { headers: { Cookie: auditor.cookie } })).status, 403);
    assert.deepEqual(await get('/api/ai/status', auditor.cookie), { requests: [] });

    // Restart in the middle of the probe: it resumes where it was once the teacher resumes the game.
    await until(async () => (await get('/api/snapshot', auditor.cookie)).auditor.probes[0].sent >= 2);
    await stop(); await launch();
    view = await get('/api/snapshot', auditor.cookie);
    const paused = view.auditor.probes[0];
    assert.equal(view.status, 'PAUSED'); assert.equal(paused.finished, false); assert(paused.sent >= 2 && paused.sent < 30, String(paused.sent));
    assert.equal((await send(operator, 'room.start')).ok, true); assert.equal((await send(operator, 'room.speed', { speed: 20 })).ok, true);
    await until(async () => (await get('/api/snapshot', auditor.cookie)).auditor.probes[0].finished);
    const done = (await get('/api/snapshot', auditor.cookie)).auditor.probes[0];
    assert.equal(done.sent, 30); assert.equal(done.contained + done.notContained + done.unserved, 30);
    assert.equal((await send(auditor.cookie, 'audit.probe', { companyId: 1, nodeId: 'backend-write', check: 'waf' })).code, 'COOLDOWN');
    assert((await get('/api/snapshot', member.cookie)).events.some((e: { text: string }) => e.text.startsWith('Tráfico inusual finalizado')));
  } finally { await stop(); mock.close(); await rm(dir, { recursive: true, force: true }); }
});
