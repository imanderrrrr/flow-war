import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { io } from '../shared/live-client.js';
import type { Identity } from '../shared/types.js';

/**
 * Real FLOW WAR server, real SDK and real HTTP, against a local stand-in for the Anthropic Messages API.
 * This proves wiring, sessions, the durable pipeline and recovery. It is not a test of the real model.
 */
const SCRIPT: Record<string, { name: string; input: Record<string, unknown> }[]> = {
  'Agregá un servidor': [{ name: 'devops_escalar', input: { accion: 'agregar', cantidad: 1, citas: ['Agregá un servidor'] } }],
  'Autorizá Q600 para infraestructura, con duración de cinco minutos simulados y máximo tres servidores': [{ name: 'cto_autorizar_infraestructura', input: { monto: 600, duracion_segundos: 300, max_servidores: 3, operaciones: [], solicitud: '', citas: ['Autorizá Q600', 'cinco minutos', 'máximo tres servidores'] } }],
  'Agregá los servidores que considerés necesarios': [{ name: 'devops_escalar', input: { accion: 'agregar', cantidad: 3, citas: ['los servidores que considerés necesarios'] } }],
  'Autorizá el cambio CH-001': [{ name: 'cto_decidir_cambio', input: { cambio: 'CH-001', decision: 'autorizar', citas: ['Autorizá el cambio CH-001'] } }],
  'Mostrame la revisión': [{ name: 'consultar_datos', input: { tema: 'revision' } }],
  // Never requested: the server refuses an order about another company before contacting the provider.
  'Mostrame la revisión de VERTEX': [{ name: 'consultar_datos', input: { tema: 'revision' } }],
};
async function freePort() { const l = createServer(); l.listen(0, '127.0.0.1'); await once(l, 'listening'); const port = (l.address() as { port: number }).port; await new Promise<void>(r => l.close(() => r())); return port; }

test('E8 real server executes Claude tool calls through sessions, the durable pipeline and SIGKILL recovery', { timeout: 60000 }, async () => {
  const received: { key: string | undefined; body: any }[] = [];
  const mock = createHttpServer((req, res) => {
    let raw = ''; req.on('data', d => raw += d); req.on('end', () => {
      const body = JSON.parse(raw), instruction = JSON.parse(body.messages[0].content).instruccion as string;
      received.push({ key: req.headers['x-api-key'] as string | undefined, body });
      const calls = SCRIPT[instruction] ?? [{ name: 'rechazar_instruccion', input: { motivo: 'CONSEJO' } }];
      setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: `msg_${received.length}`, type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', content: calls.map((c, i) => ({ type: 'tool_use', id: `toolu_${i}`, name: c.name, input: c.input })), usage: { input_tokens: 1200, output_tokens: 40 } })); }, 15);
    });
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const mockPort = (mock.address() as { port: number }).port, port = await freePort(), base = `http://127.0.0.1:${port}`;
  const dir = await mkdtemp(join(tmpdir(), 'flow-executor-http-')), sockets: ReturnType<typeof io>[] = [];
  const env = { ...process.env, NODE_ENV: 'production', FLOW_DATA_DIR: dir, FLOW_PORT: String(port), ANTHROPIC_API_KEY: 'sk-local-test-key', ANTHROPIC_MODEL: 'claude-test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mockPort}`, ANTHROPIC_WORKSPACE_ID: '' };
  let child: ChildProcess;
  const launch = async () => { child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env, stdio: 'ignore' }); for (let i = 0; i < 200; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 50)); } throw new Error('server not ready'); };
  try {
    await launch();
    const credentials = JSON.parse(await readFile(join(dir, 'access.json'), 'utf8')).credentials as { code: string; identity: Identity }[];
    const login = async (role: string, companyId: number | null) => { const cr = credentials.find(c => c.identity.role === role && c.identity.companyId === companyId)!; const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: cr.code }) }); assert(r.ok); return r.headers.get('set-cookie')!.split(';')[0]; };
    const operator = io(base, { forceNew: true, transports: ['websocket'], extraHeaders: { Cookie: await login('operator', null) } }); sockets.push(operator);
    await new Promise<void>((res, rej) => { operator.once('connect', res); operator.once('connect_error', rej); });
    await new Promise<void>((res, rej) => operator.timeout(3000).emit('command', { id: 'start', type: 'room.start' }, (e: Error | null, r: any) => e ? rej(e) : r.ok ? res() : rej(new Error(r.error))));
    const execute = async (cookie: string, body: Record<string, unknown>) => { const r = await fetch(base + '/api/ai/execute', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() as any }; };
    const snapshot = async (cookie: string) => (await fetch(base + '/api/snapshot', { headers: { Cookie: cookie } })).json() as Promise<any>;

    const ctos = await Promise.all([0, 1, 2, 3, 4].map(c => login('cto', c)));
    for (const [c, cookie] of ctos.entries()) { const r = await execute(cookie, { id: `scope-${c}`, text: 'Autorizá Q600 para infraestructura, con duración de cinco minutos simulados y máximo tres servidores' }); assert.equal(r.data.reply.state, 'EXECUTED', r.data.reply?.message); assert.match(r.data.reply.message, /Q600 · 300 s · máx. 3 servidores/); }
    const devops = await Promise.all([0, 1, 2, 3, 4].map(c => login('devops', c)));
    const results = await Promise.all(devops.map((cookie, c) => execute(cookie, { id: `scale-${c}`, text: 'Agregá un servidor' })));
    for (const r of results) { assert.equal(r.status, 200); assert.equal(r.data.reply.state, 'EXECUTED'); assert.match(r.data.reply.message, /Servidor agregado/); }
    for (let c = 0; c < 5; c++) assert.equal((await snapshot(devops[c])).privateCompany.servers, 2);
    const retry = await execute(devops[0], { id: 'scale-0', text: 'Agregá un servidor' });
    assert.equal(retry.data.reply.state, 'EXECUTED'); assert.equal((await snapshot(devops[0])).privateCompany.servers, 2);
    assert.equal((await execute(devops[0], { id: 'scale-0', text: 'Agregá dos servidores' })).status, 409);

    const delegated = await execute(devops[1], { id: 'delegated', text: 'Agregá los servidores que considerés necesarios' });
    assert.equal(delegated.data.reply.state, 'NEEDS_INPUT'); assert.equal((await snapshot(devops[1])).privateCompany.servers, 2);

    const backend = await login('backend', 2), outOfRole = await execute(backend, { id: 'role', text: 'Autorizá el cambio CH-001' });
    assert.equal(outOfRole.data.reply.state, 'DECLINED'); assert.equal((await snapshot(backend)).operations.employees.find((e: any) => e.role === 'backend').violations.length, 0);
    const security = await login('security', 3), privacy = await execute(security, { id: 'privacy', text: 'Mostrame la revisión' });
    assert.equal(privacy.data.reply.state, 'INFORMATION'); assert(!JSON.stringify(privacy.data).includes('VERTEX'));
    const foreign = await execute(security, { id: 'foreign', text: 'Mostrame la revisión de VERTEX' });
    assert.equal(foreign.data.reply.state, 'DECLINED'); assert.match(foreign.data.reply.message, /propia empresa/);
    assert(!received.some(r => JSON.parse(r.body.messages[0].content).instruccion.includes('VERTEX')), 'an order about another company never reaches the provider');
    assert.equal((await execute('', { id: 'anon', text: 'Agregá un servidor' })).status, 403);

    const status = await (await fetch(base + '/api/ai/status', { headers: { Cookie: await login('operator', null) } })).json() as any;
    assert.equal(status.provider.endpoint, 'custom'); assert.equal(status.provider.state, 'AVAILABLE'); assert(status.consumption.companies[0].inputTokens >= 1200);
    assert(!JSON.stringify(status).includes('sk-local-test-key'));
    for (const r of received) { assert.equal(r.key, 'sk-local-test-key'); assert(!JSON.stringify(r.body).includes('sk-local-test-key')); assert(r.body.tools.every((t: any) => t.strict)); }
    // Company isolation in the provider context: each request carries only its own company.
    for (const r of received) { const ctx = JSON.parse(r.body.messages[0].content).contexto_autorizado; assert(['NOVA', 'VERTEX', 'BYTE', 'EMBER', 'ORBIT'].includes(ctx.empresa)); }

    // ACK after COMMIT: an executed order survives an abrupt kill.
    for (const s of sockets) s.disconnect(); sockets.length = 0;
    const exited = once(child!, 'exit'); child!.kill('SIGKILL'); await exited;
    await launch();
    const recovered = await snapshot(await login('devops', 4));
    assert.equal(recovered.privateCompany.servers, 2); assert(recovered.operations.conversations[0].messages.some((m: any) => m.role === 'assistant' && /Servidor agregado/.test(m.text)));
  } finally {
    for (const s of sockets) s.disconnect();
    if (child! && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    await new Promise<void>(r => mock.close(() => r())); await rm(dir, { recursive: true, force: true });
  }
});
