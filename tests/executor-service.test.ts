import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applyCommand, createGame, step } from '../server/engine.js';
import { AiGateway, AnthropicProvider, DEFAULT_MODEL, type InterpretRequest, type InterpretResult, type Provider } from '../server/claude.js';
import { AiScheduler } from '../server/ai-scheduler.js';
import { beginExecution, buildRequest, executeCalls, finishExecution, replyFor, snapshotFor } from '../server/executor-service.js';
import { createGameWriter } from '../server/storage.js';
import { createCommandPipeline } from '../server/command-pipeline.js';
import { bindObservability } from '../server/observability.js';
import { slackFact } from '../server/flowslack.js';
import { recoverGame, serializeGame } from '../server/persistence.js';
import { command, advanceGame, reviewForQa, authorizeInfra } from './helpers.js';
import type { Command, GameState, Identity, Result, Role } from '../shared/types.js';
import type { ExecutorInput, ToolCall } from '../shared/executor.js';

const actor = (role: Role, companyId = 0): Identity => ({ id: `${companyId}-${role}`, role, companyId });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const toolMessage = (calls: ToolCall[], model = 'm') => ({ id: 'msg', type: 'message', role: 'assistant', model, stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...calls.map((c, i) => ({ type: 'tool_use', id: `toolu_${i}`, name: c.name, input: c.input }))], usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 700, cache_creation_input_tokens: 0 } });
function harness() {
  let game = createGame(); game.status = 'RUNNING'; for (let c = 0; c < 5; c++) authorizeInfra(game, c, 3);
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE commands (identity TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, generation INTEGER, PRIMARY KEY(identity,id))');
  const write = createGameWriter(db); write(game);
  const pipeline = createCommandPipeline({ db, hash: s => createHash('sha256').update(s).digest('hex'), game: () => game, broadcast: () => {}, committed: () => {}, groupCommit: true, maxBatch: 64, restore: s => { game = s; bindObservability(game, f => slackFact(game, f)); }, write: (s, rows) => write(s, rows) });
  const submit = (identity: Identity) => (cmd: Command) => new Promise<Result>(resolve => pipeline.receive(identity, cmd, r => resolve(r as Result)));
  return { get game() { return game; }, submit, pipeline, db };
}
/** Same sequence as POST /api/ai/execute, against the real pipeline. */
async function execute(h: ReturnType<typeof harness>, who: Identity, input: ExecutorInput, gateway: AiGateway) {
  beginExecution(h.game, who, input);
  const { request, snapshot } = buildRequest(h.game, who, input);
  const result = await gateway.interpret(who.id, who.companyId!, request, { usedByGame: 0, usedByCompany: 0 });
  h.pipeline.flush();
  const executed = await executeCalls(() => ({ g: h.game, actor: who }), input, result.calls, snapshot, h.submit(who));
  const reply = replyFor(input, executed, 'test', result.model);
  finishExecution(h.game, who, input, reply, 'COMPLETED', undefined, result);
  return { reply, request, result };
}
const scripted = (fn: (request: InterpretRequest) => ToolCall[], delay = () => 0): Provider => ({ name: 'test', model: 'scripted', async generate() { throw new Error('unused'); }, async interpret(request) { await new Promise(r => setTimeout(r, delay())); return { calls: fn(request), usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'scripted', stopReason: 'tool_use', fallback: false } satisfies InterpretResult; } });
const instruction = (request: InterpretRequest) => JSON.parse(request.content).instruccion as string;

test('E8 SDK tool calling sends strict role tools, auto choice, low effort and cache control; keys never leave headers', async () => {
  let body: any, headers: Headers | undefined, url = '';
  const calls = [{ name: 'devops_balanceador', input: { activar: true, citas: ['Activá el balanceador'] } }];
  const transport: typeof fetch = async (u, init) => { url = String(u); body = JSON.parse(String(init!.body)); headers = new Headers(init!.headers); return json(toolMessage(calls, body.model)); };
  const h = harness(), who = actor('devops'), provider = new AnthropicProvider('sk-test-private', 'm', transport);
  const { request } = buildRequest(h.game, who, { id: 'r1', text: 'Activá el balanceador' });
  const result = await provider.interpret(request);
  assert.deepEqual(result.calls, calls); assert.equal(result.usage.cacheReadTokens, 700);
  assert.equal(url, 'https://api.anthropic.com/v1/messages'); assert.equal(headers!.get('x-api-key'), 'sk-test-private');
  assert.deepEqual(body.tool_choice, { type: 'auto' }); assert(body.tools.every((t: any) => t.strict === true && t.input_schema.additionalProperties === false));
  assert.equal(body.output_config.effort, 'low'); assert.equal(body.thinking, undefined); assert.equal(body.system[0].cache_control.type, 'ephemeral');
  assert(!JSON.stringify(body).includes('sk-test-private')); assert(!body.messages[0].content.includes('defects')); assert(!body.messages[0].content.includes('VERTEX'));
  assert(!body.tools.some((t: any) => /^(backend|qa|cto|seguridad)_/.test(t.name)));
  // Opus 5.5 opts into the server-side refusal fallback through the beta endpoint.
  const opus = new AnthropicProvider('k', 'claude-opus-5-5', transport); await opus.interpret(request);
  assert.match(url, /^https:\/\/api\.anthropic\.com\/v1\/messages/); assert.equal(body.fallbacks, 'default'); assert.equal(body.betas, undefined); assert.match(headers!.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/);
  // Sonnet 5.5 is the default for every call and opts into the fallback too.
  assert.equal(DEFAULT_MODEL, 'claude-sonnet-5-5');
  const sonnet = new AnthropicProvider('k', DEFAULT_MODEL, transport); await sonnet.interpret(request);
  assert.equal(body.model, 'claude-sonnet-5-5'); assert.equal(body.fallbacks, 'default'); assert.match(headers!.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/); assert.equal(body.output_config.effort, 'low'); assert.equal(body.thinking, undefined);
  // Haiku 5.5 has no server-side fallback, so the plain endpoint is used.
  const haiku = new AnthropicProvider('k', 'claude-haiku-5-5', transport); await haiku.interpret(request);
  assert.equal(body.model, 'claude-haiku-5-5'); assert.equal(body.fallbacks, undefined); assert.equal(headers!.get('anthropic-beta'), null); assert.equal(body.output_config.effort, 'low'); assert.equal(body.thinking, undefined);
  const refused = new AnthropicProvider('k', 'm', async () => json({ ...toolMessage([]), stop_reason: 'refusal', content: [] }));
  await assert.rejects(() => refused.interpret(request), e => (e as { code: string }).code === 'REFUSED');
  const text = new AnthropicProvider('k', 'm', async () => json({ ...toolMessage([]), stop_reason: 'end_turn', content: [{ type: 'text', text: 'Te recomiendo agregar tres servidores.' }] }));
  assert.deepEqual((await text.interpret(request)).calls, []);
});

test('E8 a model answering in prose executes nothing and its text never reaches the student', async () => {
  const h = harness(), who = actor('devops'), before = h.game.companies[0].servers;
  const gateway = new AiGateway(new AnthropicProvider('k', 'm', async () => json({ ...toolMessage([]), stop_reason: 'end_turn', content: [{ type: 'text', text: 'Te recomiendo agregar tres servidores.' }] })));
  const { reply } = await execute(h, who, { id: 'prose', text: '¿Cuántos servidores conviene?' }, gateway);
  assert.equal(reply.state, 'NO_OPERATION'); assert.doesNotMatch(reply.message, /recomiendo|tres/); assert.equal(h.game.companies[0].servers, before);
});

test('E8 executed operations go through the durable pipeline once, audited as agent work of the real actor', async () => {
  const h = harness(), who = actor('devops');
  const gateway = new AiGateway(scripted(r => instruction(r) === 'Agregá un servidor' ? [{ name: 'devops_escalar', input: { accion: 'agregar', cantidad: 1, citas: ['Agregá un servidor'] } }] : []));
  const input = { id: 'once', text: 'Agregá un servidor' };
  const { reply } = await execute(h, who, input, gateway);
  assert.equal(reply.state, 'EXECUTED'); assert.equal(h.game.companies[0].servers, 2);
  const audit = h.game.actions.audit.find(a => a.commandId === 'once:op1')!;
  assert.equal(audit.actorId, '0-devops'); assert.equal(audit.source, 'agent'); assert.equal(audit.correlationId, 'once'); assert(audit.effects.includes('servers.delta:1'));
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM commands WHERE id=?').get('once:op1') as { n: number }).n, 1);
  // A transport retry of the same request reuses the committed result.
  const again = await executeCalls(() => ({ g: h.game, actor: who }), input, [{ name: 'devops_escalar', input: { accion: 'agregar', cantidad: 1, citas: ['Agregá un servidor'] } }], snapshotFor(h.game, who), h.submit(who));
  assert.equal(h.game.companies[0].servers, 2, again.message);
  const thread = h.game.companies[0].runtime.conversations!.find(t => t.actor === '0-devops')!;
  assert.deepEqual(thread.messages.map(m => m.role), ['user', 'assistant']); assert.equal(h.game.companies[0].runtime.aiUsage!.requests, 1);
  assert.throws(() => beginExecution(h.game, who, { id: 'once', text: 'Agregá dos servidores' }), /ID de solicitud/);
});

test('E8 a late reply cannot operate on a game or resource that changed while Claude was answering', async () => {
  const h = harness(), who = actor('devops'), c = h.game.companies[0];
  const input = { id: 'late', text: 'Agregá un servidor' };
  beginExecution(h.game, who, input);
  const { snapshot } = buildRequest(h.game, who, input);
  assert(command(h.game, 'devops', 'infra.scale', { delta: 1 }).ok);
  const executed = await executeCalls(() => ({ g: h.game, actor: who }), input, [{ name: 'devops_escalar', input: { accion: 'agregar', cantidad: 1, citas: ['Agregá un servidor'] } }], snapshot, h.submit(who));
  assert.equal(executed.state, 'REJECTED'); assert.match(executed.message, /cambió durante la solicitud/); assert.equal(c.servers, 2);
});

test('E8 informal QA order runs the real engine; the result message is built from the report, not from the model', async () => {
  const h = harness(), who = actor('qa');
  assert(command(h.game, 'backend', 'change.submit', { graph: h.game.companies[0].backend, revision: 0 }).ok); reviewForQa(h.game);
  const ch = h.game.changes[0], text = 'Hacé q dos compradores compren la ultima unidad al mismo tiempo';
  let sent: any;
  const transport: typeof fetch = async (_u, init) => { sent = JSON.parse(String(init!.body)); return json(toolMessage([{ name: 'qa_ejecutar_escenario', input: { cambio: '', tipo: 'concurrency', solicitudes: 2, stock: 1, concurrencia: 2, simultaneas: true, reintentos: null, ataque: null, cupones: null, mismo_pago: null, citas: ['dos compradores', 'la ultima unidad', 'al mismo tiempo'] } }])); };
  const { reply } = await execute(h, who, { id: 'informal', text, selection: { changeId: ch.id } }, new AiGateway(new AnthropicProvider('k', 'm', transport)));
  assert.equal(reply.state, 'EXECUTED', reply.message); assert(!sent.messages[0].content.includes('defects')); assert(!sent.messages[0].content.includes('customers'));
  advanceGame(h.game, 3);
  assert.equal(ch.reports[0].requests, 2); assert.equal(ch.reports[0].oversold, 1); assert.equal(ch.status, 'QA_PENDING');
  const restored = recoverGame(serializeGame(h.game)), thread = restored.companies[0].runtime.conversations!.find(t => t.actor === '0-qa')!;
  assert(thread.messages.some(m => m.text.includes('1 sobreventas'))); assert.equal(restored.companies[0].runtime.workflow!.runs[0].request, text);
});

test('E8 interrupted requests keep the human text and never act after a restart', () => {
  const h = harness(), who = actor('cto'), c = h.game.companies[0];
  beginExecution(h.game, who, { id: 'cut', text: 'Autorizá CH-001' });
  const restored = recoverGame(serializeGame(h.game));
  assert.equal(restored.companies[0].runtime.aiAttempts![0].state, 'INTERRUPTED'); assert.equal(restored.companies[0].runtime.conversations![0].messages[0].text, 'Autorizá CH-001');
  assert.equal(restored.companies[0].reserved, c.reserved); assert.equal(restored.changes.length, 0);
});

test('E8 provider context stays compact and private with long team documents', () => {
  const h = harness(), c = h.game.companies[0], long = 'Texto extenso del estudiante. '.repeat(140);
  c.runtime.workflow = { letters: [], runs: [], decisions: [], investments: Array.from({ length: 8 }, (_, i) => ({ id: `I${i}`, companyId: 0, cto: '0-cto', department: 'security' as const, objective: long, justification: long, maximum: 500, reserved: 0, spent: 0, status: 'REQUESTED' as const, at: 0, expires: 300 })) };
  for (let i = 0; i < 5; i++) beginExecution(h.game, actor('cto'), { id: `p${i}`, text: `Instrucción privada ${i}` });
  const { request } = buildRequest(h.game, actor('cto'), { id: 'q', text: 'Mostrame las finanzas' });
  assert(request.content.length < 20000); assert(!request.content.includes('Texto extenso')); assert(request.content.includes('Instrucción privada 4'));
  const back = buildRequest(h.game, actor('cto'), { id: 'q2', text: 'Usá los mismos valores que te indiqué' }).request.content;
  assert(back.includes('Instrucción privada 4'));
  const rival = buildRequest(h.game, actor('cto', 1), { id: 'q3', text: 'Usá los mismos valores que te indiqué' }).request.content;
  assert(!rival.includes('Instrucción privada'));
});

test('E8 Test H: five companies operate through Claude concurrently while the simulation runs, isolated and without duplicates', async () => {
  const h = harness(), active = new Map<number, number>(), peak = new Map<number, number>();
  let seed = 7;
  const random = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const script = (request: InterpretRequest): ToolCall[] => {
    const text = instruction(request);
    if (text === 'Agregá un servidor') return [{ name: 'devops_escalar', input: { accion: 'agregar', cantidad: 1, citas: ['Agregá un servidor'] } }];
    if (text === 'Priorizá seguridad') return [{ name: 'cto_priorizar', input: { incidente: 'seguridad', citas: ['seguridad'] } }];
    if (text === 'Agregá un bloque Cache') return [{ name: 'backend_agregar_bloque', input: { tipo: 'cache', citas: ['Cache'] } }];
    if (text === 'Mostrame las suites') return [{ name: 'consultar_datos', input: { tema: 'suites' } }];
    return [{ name: 'rechazar_instruccion', input: { motivo: 'CONSEJO' } }];
  };
  const provider: Provider = { name: 'test', model: 'concurrent', async generate() { throw new Error('unused'); },
    async interpret(request) {
      const company = JSON.parse(request.content).contexto_autorizado.empresa as string, id = ['NOVA', 'VERTEX', 'BYTE', 'EMBER', 'ORBIT'].indexOf(company);
      active.set(id, (active.get(id) ?? 0) + 1); peak.set(id, Math.max(peak.get(id) ?? 0, active.get(id)!));
      await new Promise(r => setTimeout(r, 2 + Math.floor(random() * 20)));
      active.set(id, active.get(id)! - 1);
      return { calls: script(request), usage: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'concurrent', stopReason: 'tool_use', fallback: false };
    } };
  const gateway = new AiGateway(provider, Date.now, new AiScheduler(5, 30, 10000, 2));
  const tickBefore = h.game.tick, timer = setInterval(() => { h.pipeline.flush(); step(h.game); }, 1);
  const orders: [Role, string][] = [['devops', 'Agregá un servidor'], ['cto', 'Priorizá seguridad'], ['backend', 'Agregá un bloque Cache'], ['qa', 'Mostrame las suites'], ['security', '¿Qué control conviene?']];
  try {
    const replies = await Promise.all([0, 1, 2, 3, 4].flatMap(companyId => orders.map(([role, text], i) => execute(h, actor(role, companyId), { id: `h-${companyId}-${i}`, text }, gateway).then(r => ({ companyId, role, reply: r.reply })))));
    assert.equal(replies.length, 25);
    for (const { role, reply } of replies) assert.equal(reply.state, role === 'security' ? 'DECLINED' : role === 'qa' ? 'INFORMATION' : 'EXECUTED', `${role}: ${reply.message}`);
  } finally { clearInterval(timer); }
  assert(h.game.tick > tickBefore, 'the simulation kept advancing during the calls');
  for (const c of h.game.companies) {
    assert.equal(c.servers, 2); assert.equal(c.runtime.priority, 'security');
    const caches = c.drafts.backend!.graph.nodes.filter(n => n.type === 'cache'); assert.equal(caches.length, 1);
    assert(caches[0].id.startsWith(`blk-h${c.id}`));
    assert.equal(h.game.actions.audit.filter(a => a.companyId === c.id && a.source === 'agent').length, 3);
    assert(peak.get(c.id)! <= 2); assert.equal(c.runtime.aiUsage!.requests, 5);
  }
  assert.equal(gateway.scheduler.metrics().active, 0);
});
