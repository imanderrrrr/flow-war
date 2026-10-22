import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { Identity, Result } from '../shared/types.js';

/**
 * Classroom load for the Claude executor: real FLOW WAR server, 25 students, teacher, simulation at
 * --speed, and a local stand-in for the Messages API with configurable latency (--model-ms). It measures
 * whether model latency blocks the simulation or the ACK of ordinary commands. It does not measure the
 * real model, its quality or Anthropic capacity.
 */
const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const speed = Number(arg('speed', '20')), modelMs = Number(arg('model-ms', '800')), rounds = Number(arg('rounds', '4')), label = arg('label', 'executor-classroom');
const free = async () => { const l = createServer(); l.listen(0, '127.0.0.1'); await once(l, 'listening'); const p = (l.address() as { port: number }).port; await new Promise<void>(r => l.close(() => r())); return p; };
const SCRIPT: Record<string, { name: string; input: Record<string, unknown> }[]> = {
  'Autorizá Q0 de infraestructura por diez minutos con máximo ocho servidores': [{ name: 'cto_autorizar_infraestructura', input: { monto: 0, duracion_segundos: 600, max_servidores: 8, operaciones: [], solicitud: '', citas: ['Autorizá Q0', 'diez minutos', 'máximo ocho servidores'] } }],
  'Agregá un servidor': [{ name: 'devops_escalar', input: { accion: 'agregar', cantidad: 1, citas: ['Agregá un servidor'] } }],
  'Agregá un bloque Cache': [{ name: 'backend_agregar_bloque', input: { tipo: 'cache', citas: ['Cache'] } }],
  'Mostrame las suites': [{ name: 'consultar_datos', input: { tema: 'suites' } }],
  'Mostrame las finanzas': [{ name: 'consultar_datos', input: { tema: 'finanzas' } }],
};
const latencies: number[] = [], modelCalls: number[] = [];
const mock = createHttpServer((req, res) => {
  let raw = ''; req.on('data', d => raw += d); req.on('end', () => {
    const body = JSON.parse(raw), text = JSON.parse(body.messages[0].content).instruccion as string, at = Date.now();
    const calls = SCRIPT[text] ?? [{ name: 'rechazar_instruccion', input: { motivo: 'CONSEJO' } }];
    setTimeout(() => { modelCalls.push(Date.now() - at); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: randomUUID(), type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', content: calls.map((c, i) => ({ type: 'tool_use', id: `t${i}`, name: c.name, input: c.input })), usage: { input_tokens: 3000, output_tokens: 80 } })); }, modelMs * (0.5 + Math.random()));
  });
});
mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
const port = await free(), base = `http://127.0.0.1:${port}`, dir = mkdtempSync(join(tmpdir(), 'flow-executor-classroom-'));
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, NODE_ENV: 'production', FLOW_DATA_DIR: dir, FLOW_PORT: String(port), ANTHROPIC_API_KEY: 'sk-local-benchmark', ANTHROPIC_MODEL: 'claude-benchmark', ANTHROPIC_BASE_URL: `http://127.0.0.1:${(mock.address() as { port: number }).port}`, FLOW_AI_CONCURRENCY: '5', FLOW_AI_COMPANY_CONCURRENCY: '2' }, stdio: 'ignore' });
const sockets: Socket[] = [];
try {
  for (let i = 0; i < 200; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
  const credentials = (JSON.parse(readFileSync(join(dir, 'access.json'), 'utf8')).credentials as { code: string; identity: Identity }[]).filter(c => c.identity.role !== 'product');
  const sessions = await Promise.all(credentials.map(async cr => { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: cr.code }) }); const cookie = r.headers.get('set-cookie')!.split(';')[0]; const socket = io(base, { forceNew: true, transports: ['websocket'], extraHeaders: { Cookie: cookie } }); sockets.push(socket); await new Promise<void>(res => socket.once('connect', () => res())); return { identity: cr.identity, cookie, socket }; }));
  const send = (s: typeof sessions[number], type: string, payload?: Record<string, unknown>) => { const at = performance.now(); return new Promise<{ result: Result; ms: number }>(res => s.socket.timeout(10000).emit('command', { id: randomUUID(), type, companyId: s.identity.companyId ?? undefined, payload }, (_e: Error | null, r: Result) => res({ result: r, ms: performance.now() - at }))); };
  const teacher = sessions.find(s => s.identity.role === 'operator')!, by = (c: number, role: string) => sessions.find(s => s.identity.companyId === c && s.identity.role === role)!;
  await send(teacher, 'room.speed', { speed }); await send(teacher, 'room.start');
  const tick = async () => (await (await fetch(base + '/api/snapshot')).json() as { tick: number }).tick;
  const execute = async (s: typeof sessions[number], text: string) => { const at = performance.now(); const r = await fetch(base + '/api/ai/execute', { method: 'POST', headers: { Cookie: s.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: randomUUID(), text }) }); const data = await r.json() as { ok: boolean; reply?: { state: string } }; latencies.push(performance.now() - at); return data; };
  for (let c = 0; c < 5; c++) assert.equal((await execute(by(c, 'cto'), 'Autorizá Q0 de infraestructura por diez minutos con máximo ocho servidores')).reply?.state, 'EXECUTED');
  // Control: ordinary commands with no Claude traffic.
  const control: number[] = [], loaded: number[] = [];
  const controlTick = await tick(), controlWall = performance.now();
  for (let i = 0; i < 80; i++) { control.push((await send(by(i % 5, 'qa'), 'chat.send', { channel: 'equipo-interno', text: `control ${i}`, refs: [] })).ms); await new Promise(r => setTimeout(r, 25)); }
  const controlRatio = Math.round(((await tick()) - controlTick) / ((performance.now() - controlWall) / 1000) / speed * 100) / 100;
  const tickStart = await tick(), wallStart = performance.now();
  const orders: Promise<unknown>[] = [], states: string[] = [];
  // Students in parallel; each student sends one order at a time, as the interface allows.
  for (let c = 0; c < 5; c++) for (const [role, text] of [['devops', 'Agregá un servidor'], ['backend', 'Agregá un bloque Cache'], ['qa', 'Mostrame las suites'], ['cto', 'Mostrame las finanzas'], ['security', '¿Qué control conviene?']] as const)
    orders.push((async () => { for (let round = 0; round < rounds; round++) { const d = await execute(by(c, role), text); states.push(d.ok ? d.reply!.state : 'REFUSED'); } })());
  const ordinary = (async () => { for (let i = 0; i < 80; i++) { loaded.push((await send(by(i % 5, 'qa'), 'chat.send', { channel: 'equipo-interno', text: `loaded ${i}`, refs: [] })).ms); await new Promise(r => setTimeout(r, 25)); } })();
  await Promise.all([...orders, ordinary]);
  const wall = (performance.now() - wallStart) / 1000, simulated = (await tick()) - tickStart;
  const pct = (v: number[], q: number) => { const s = v.slice().sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * q) - 1)] * 10) / 10; };
  const snapshot = await (await fetch(base + '/api/snapshot', { headers: { Cookie: by(0, 'devops').cookie } })).json() as { privateCompany: { servers: number } };
  const report = { status: 'passed', at: new Date().toISOString(), label, transport: 'real server + official SDK + local Messages API stand-in; not a measurement of the real model', machine: { cpus: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30) }, speed, modelLatencyMs: { configured: modelMs, p50: pct(modelCalls, .5), p95: pct(modelCalls, .95) }, students: 25, ordersSent: orders.length * rounds, outcomes: Object.fromEntries([...new Set(states)].map(s => [s, states.filter(x => x === s).length])), executorLatencyMs: { p50: pct(latencies, .5), p95: pct(latencies, .95), max: pct(latencies, 1) }, ordinaryAckMs: { control: { p50: pct(control, .5), p95: pct(control, .95) }, duringClaudeLoad: { p50: pct(loaded, .5), p95: pct(loaded, .95) } }, simulation: { wallSeconds: Math.round(wall * 10) / 10, simulatedSeconds: Math.round(simulated * 10) / 10, ratio: Math.round(simulated / wall / speed * 100) / 100, controlRatio }, company0Servers: snapshot.privateCompany.servers };
  assert.equal(report.company0Servers, 1 + rounds, 'each explicit order executed exactly once');
  assert(report.simulation.ratio > 0.8, 'the simulation must keep its pace while Claude answers');
  mkdirSync('docs/benchmarks/entrega-8', { recursive: true }); writeFileSync(`docs/benchmarks/entrega-8/${label}.json`, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} finally {
  for (const s of sockets) s.disconnect(); child.kill('SIGTERM'); await once(child, 'exit'); await new Promise<void>(r => mock.close(() => r())); rmSync(dir, { recursive: true, force: true });
}
