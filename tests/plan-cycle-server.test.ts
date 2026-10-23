import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { io } from '../shared/live-client.js';
import { planGraph } from '../shared/plan.js';
import type { Snapshot } from '../shared/types.js';

async function freePort() { const l = createServer(); l.listen(0, '127.0.0.1'); await once(l, 'listening'); const port = (l.address() as { port: number }).port; await new Promise<void>(r => l.close(() => r())); return port; }
const ROLES = ['backend', 'security', 'qa', 'cto', 'devops'] as const;

test('real server: a company sells, then Seguridad adds the perímetro through QA, CTO and DevOps', { timeout: 60000 }, async () => {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const dir = await mkdtemp(join(tmpdir(), 'flow-plan-cycle-'));
  await writeFile(join(dir, 'access.json'), JSON.stringify({ credentials: [
    { code: 'operator-test', identity: { id: 'operator', role: 'operator', companyId: null }, label: 'Docente' },
    ...ROLES.map(role => ({ code: `${role}-test`, identity: { id: `0-${role}`, role, companyId: 0 }, label: `NOVA / ${role}` })),
  ] }));
  // No model is involved; keep any key or endpoint of the calling shell away from the server.
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', FLOW_DATA_DIR: dir, FLOW_PORT: String(port), ANTHROPIC_API_KEY: '' };
  delete env.ANTHROPIC_BASE_URL; delete env.ANTHROPIC_AUTH_TOKEN;
  let child: ReturnType<typeof spawn>, sockets: ReturnType<typeof io>[] = [];
  const launch = async () => { child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env, stdio: 'ignore' }); for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* starting */ } await new Promise(r => setTimeout(r, 50)); } throw new Error('server did not start'); };
  const stop = async () => { for (const s of sockets) s.disconnect(); sockets = []; if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } };
  const login = async (code: string) => (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).headers.get('set-cookie')!.split(';')[0];
  const snapshot = async (cookie: string): Promise<Snapshot> => (await fetch(base + '/api/snapshot', { headers: { Cookie: cookie } })).json();
  const send = async (cookie: string, type: string, payload: Record<string, unknown> = {}, changeId?: string) => {
    const socket = io(base, { forceNew: true, transports: ['websocket'], extraHeaders: { Cookie: cookie } }); sockets.push(socket);
    await new Promise<void>((res, rej) => { socket.once('connect', res); socket.once('connect_error', rej); });
    return new Promise<{ ok: boolean; error?: string; code?: string; refs?: string[] }>((res, rej) => socket.timeout(3000).emit('command', { id: `${type}-${Math.random()}`, type, companyId: type.startsWith('room.') ? undefined : 0, changeId, payload }, (e: Error | null, r: { ok: boolean }) => e ? rej(e) : res(r)));
  };
  const until = async (check: () => Promise<boolean>, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('timeout'); };
  const roadsOf = (plan: Snapshot['companies'][number]['plan']) => { const type = new Map(plan.nodes.map(n => [n.id, n.type])); return plan.edges.map(e => `${type.get(e.source)}>${type.get(e.target)}`).sort(); };
  try {
    await launch();
    const operator = await login('operator-test');
    const as = Object.fromEntries(await Promise.all(ROLES.map(async role => [role, await login(`${role}-test`)] as const))) as Record<typeof ROLES[number], string>;
    assert.equal((await send(operator, 'room.start')).ok, true);
    assert.equal((await send(operator, 'room.speed', { speed: 20 })).ok, true);

    // Backend builds a plan that sells and has no perímetro: the montaje closes.
    const selling = planGraph(['entry', 'web', 'checkout', 'inventory', 'payment', 'exit']);
    assert.equal((await send(as.backend, 'plan.publish', { graph: selling, revision: 0 })).ok, true);
    await until(async () => !(await snapshot(as.security)).companies[0].assembly.active);

    // The shortcut stays closed; the cycle is the way in.
    const perimeter = planGraph(['entry', 'security', 'web', 'checkout', 'inventory', 'payment', 'exit']);
    assert.equal((await send(as.security, 'plan.publish', { graph: perimeter, revision: 0 })).code, 'PIPELINE_REQUIRED');
    const submitted = await send(as.security, 'plan.submit', { graph: perimeter, revision: 0 });
    assert.equal(submitted.ok, true, submitted.error);
    const changeId = submitted.refs![0];
    assert.equal((await snapshot(as.qa)).changes.find(ch => ch.id === changeId)!.status, 'QA_PENDING');

    // QA runs a quick suite in staging and approves with that run as evidence.
    assert.equal((await send(as.qa, 'qa.run', { suite: 'Seguridad' }, changeId)).ok, true);
    await until(async () => { const ch = (await snapshot(as.qa)).changes.find(ch => ch.id === changeId)!; return ch.status === 'QA_PENDING' && ch.reports.length > 0; });
    const run = (await snapshot(as.qa)).operations!.workflow!.runs.find(r => r.changeId === changeId)!;
    const reviewed = await send(as.qa, 'qa.review', { changeId, risks: 'Con el perímetro en el camino la suite no dejó pasar accesos indebidos.', evidenceIds: [run.id] });
    assert.equal(reviewed.ok, true, reviewed.error);

    // The CTO authorizes the same cost the editor showed; DevOps deploys it.
    const pending = (await snapshot(as.cto)).changes.find(ch => ch.id === changeId)!;
    assert.equal(pending.status, 'CTO_PENDING'); assert.equal(pending.cost, 400);
    assert.equal((await send(as.cto, 'cto.authorize', {}, changeId)).ok, true);
    assert.equal((await send(as.devops, 'deploy.start', { strategy: 'rolling' }, changeId)).ok, true);
    await until(async () => (await snapshot(as.devops)).changes.find(ch => ch.id === changeId)!.status === 'DEPLOYED');

    const expected = ['checkout>inventory', 'entry>security', 'inventory>payment', 'payment>exit', 'security>web', 'web>checkout'];
    assert.deepEqual(roadsOf((await snapshot(as.backend)).companies[0].plan), expected, 'the public plan routes through the perímetro');

    // The production plan is durable state: it survives a restart.
    assert.equal((await send(operator, 'room.pause')).ok, true);
    await stop(); await launch();
    assert.deepEqual(roadsOf((await snapshot(as.backend)).companies[0].plan), expected);
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
