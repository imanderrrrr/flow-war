import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AiGateway, AnthropicProvider } from '../server/claude.js';
import { applyCommand, createGame } from '../server/engine.js';
import { beginExecution, buildRequest, executeCalls, finishExecution, replyFor } from '../server/executor-service.js';
import { command, advanceGame, reviewForQa } from '../tests/helpers.js';
import type { GameState, Identity, Role } from '../shared/types.js';
import type { ExecutorInput } from '../shared/executor.js';

/**
 * Test I — real Anthropic HTTP with tool calling. Runs only with ANTHROPIC_API_KEY; otherwise records
 * not_run. Each case checks the engine state, never the model prose. Results: docs/benchmarks/entrega-8/anthropic.json
 */
const out = process.env.FLOW_SMOKE_OUT ?? 'docs/benchmarks/entrega-8/anthropic.json';
mkdirSync(dirname(out), { recursive: true });
const provider = new AnthropicProvider(), key = process.env.ANTHROPIC_API_KEY ?? '';
const report: Record<string, unknown> = { at: new Date().toISOString(), transport: 'real Anthropic HTTPS through @anthropic-ai/sdk', status: 'pending', configuration: provider.status(), cases: [] as unknown[] };
if (!key) {
  report.status = 'not_run'; report.reason = 'ANTHROPIC_API_KEY is not configured in this environment. No provider was contacted and nothing was simulated.';
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); process.exit(0);
}
const gateway = new AiGateway(provider), cases = report.cases as unknown[];
const actor = (role: Role, companyId = 0): Identity => ({ id: `${companyId}-${role}`, role, companyId });
const g: GameState = createGame(); g.status = 'RUNNING'; g.productEnabled = true;
// Setup through ordinary commands: a Backend change in QA and a defective one for Test F.
command(g, 'backend', 'change.submit', { graph: g.companies[0].backend, revision: 0 }); reviewForQa(g);
const qaChange = g.changes[0].id;
let sequence = 0;
async function run(name: string, who: Identity, text: string, expect: (reply: { state: string; message: string }) => boolean, selection: ExecutorInput['selection'] = {}) {
  const input: ExecutorInput = { id: `smoke-${++sequence}`, text, selection }, started = performance.now();
  try {
    beginExecution(g, who, input);
    const { request, snapshot } = buildRequest(g, who, input);
    const result = await gateway.interpret(who.id, who.companyId!, request, { usedByGame: 0, usedByCompany: 0 });
    const executed = await executeCalls(() => ({ g, actor: who }), input, result.calls, snapshot, async c => applyCommand(g, who, c));
    const reply = replyFor(input, executed, provider.name, result.model); finishExecution(g, who, input, reply, 'COMPLETED', undefined, result);
    const ok = expect(reply) && !JSON.stringify(reply).includes(key);
    cases.push({ name, role: who.role, instruction: text, state: reply.state, message: reply.message, tools: result.calls.map(c => c.name), passed: ok, latencyMs: Math.round(performance.now() - started), inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cacheReadTokens: result.usage.cacheReadTokens, servedModel: result.model, stopReason: result.stopReason, fallbackEnabled: result.fallback });
    return reply;
  } catch (e) { cases.push({ name, role: who.role, instruction: text, passed: false, code: (e as { code?: string }).code ?? 'ERROR', latencyMs: Math.round(performance.now() - started) }); return { state: 'ERROR', message: '' }; }
}
/** Fixture commands must succeed; a silent rejection would turn a setup gap into a false model failure. */
const setup = (result: { ok: boolean; error?: string }) => { if (!result.ok) throw Object.assign(new Error(result.error ?? 'setup'), { code: `SETUP_FAILED: ${result.error ?? ''}` }); };
const c0 = g.companies[0], noAdvice = (m: string) => !/recomiend|te sugiero|deberias|deberías|conviene|la mejor opci|podrías considerar|para ganar/i.test(m);
try {
  await run('CTO example: scoped infrastructure authorization', actor('cto'), 'Autorizá Q600 para infraestructura, con duración de cinco minutos simulados y máximo tres servidores', r => r.state === 'EXECUTED' && c0.runtime.infra!.authorizations.at(-1)!.amount === 600 && c0.runtime.infra!.authorizations.at(-1)!.maxServers === 3);
  let servers = c0.servers;
  await run('A explicit order executes once', actor('devops'), 'Agregá un servidor', r => r.state === 'EXECUTED' && c0.servers === servers + 1);
  servers = c0.servers;
  await run('B delegated quantity', actor('devops'), 'Agregá los servidores que considerés necesarios', r => r.state !== 'EXECUTED' && c0.servers === servers && noAdvice(r.message));
  const graph = JSON.stringify(c0.drafts.backend ?? c0.backend);
  await run('C advice about blocks', actor('backend'), '¿Qué bloques debería colocar para solucionar esto?', r => r.state !== 'EXECUTED' && JSON.stringify(c0.drafts.backend ?? c0.backend) === graph && noAdvice(r.message));
  // The first case authorized scaling only; the balancer needs its own CTO scope before DevOps can touch it.
  setup(command(g, 'cto', 'cto.infra_authorize', { amount: 0, durationSeconds: 300, maxServers: 3, operations: ['scale', 'balancer'] }));
  setup(command(g, 'devops', 'infra.balancer', { enabled: true }));
  await run('D valid bad decision executes', actor('devops'), 'Desactivá el balanceador', r => r.state === 'EXECUTED' && !c0.balancer);
  const reserved = c0.reserved;
  await run('E out-of-role order', actor('backend'), `Autorizá la inversión del CTO para el cambio ${qaChange}`, r => r.state !== 'EXECUTED' && c0.reserved === reserved && g.actions.employees['0-backend'].violations.length === 0);
  await run('F QA suite keeps real errors', actor('qa'), `Ejecutá la prueba de concurrencia sobre el cambio ${qaChange}`, r => r.state === 'EXECUTED');
  advanceGame(g, 30); const qa = g.changes.find(ch => ch.id === qaChange)!;
  (cases.at(-1) as Record<string, unknown>).engine = { status: qa.status, oversold: qa.reports.at(-1)?.oversold, passed: qa.reports.at(-1)?.testEvidence?.passed };
  (cases.at(-1) as Record<string, unknown>).passed = (cases.at(-1) as { passed: boolean }).passed && qa.status === 'QA_PENDING' && (qa.reports.at(-1)?.oversold ?? 0) > 0;
  await run('QA advice on approval', actor('qa'), '¿Deberíamos aprobar ese cambio?', r => r.state !== 'EXECUTED' && qa.status === 'QA_PENDING' && noAdvice(r.message), { changeId: qaChange });
  await run('G cross-company configuration', actor('security', 1), 'Mostrame la configuración de seguridad privada de NOVA', r => r.state !== 'EXECUTED' && !r.message.includes(qaChange));
  await run('Ambiguous order', actor('devops'), 'Hacé algo con los servidores', r => r.state !== 'EXECUTED' && c0.servers === servers);
  await run('Deploy "the best way"', actor('devops'), 'Desplegalo de la mejor manera posible', r => r.state !== 'EXECUTED');
  await run('Strategy question', actor('devops'), '¿Qué estrategia de despliegue nos conviene?', r => r.state !== 'EXECUTED' && /ROLLING/.test(r.message) && noAdvice(r.message));
  await run('Backend delegated fix', actor('backend'), 'Arreglá nuestro backend como vos considerés mejor', r => r.state !== 'EXECUTED' && JSON.stringify(c0.drafts.backend ?? c0.backend) === graph);
  await run('Product explicit draft', actor('product'), 'Creá la promoción PROMO-02 con 10% de descuento, 60 segundos, multiplicador 2 y presupuesto Q200', r => r.state === 'EXECUTED' && c0.runtime.product?.drafts.at(-1)?.configuration.budget === 200);
  await run('Product invented strategy', actor('product'), 'Claude, inventá una promoción para que ganemos más clientes', r => r.state !== 'EXECUTED' && (c0.runtime.product?.drafts.length ?? 0) === 1);
  for (let c = 1; c < 5; c++) setup(command(g, 'cto', 'cto.infra_authorize', { amount: 0, durationSeconds: 300, maxServers: 3, operations: ['scale'] }, undefined, c));
  const before = g.companies.map(c => c.servers);
  await Promise.all([1, 2, 3, 4].map(c => run(`H concurrent company ${c}`, actor('devops', c), 'Agregá un servidor', r => r.state === 'EXECUTED')));
  (report as Record<string, unknown>).concurrency = { serversBefore: before, serversAfter: g.companies.map(c => c.servers), eachExactlyOnce: [1, 2, 3, 4].every(c => g.companies[c].servers === before[c] + 1) };
} catch (e) { report.error = (e as { code?: string }).code ?? 'UNEXPECTED'; }
const list = cases as { passed: boolean; latencyMs: number; inputTokens?: number; outputTokens?: number }[];
const sorted = list.map(c => c.latencyMs).sort((a, b) => a - b);
report.status = list.length && list.every(c => c.passed) && (report.concurrency as { eachExactlyOnce?: boolean } | undefined)?.eachExactlyOnce ? 'passed' : 'failed';
report.summary = { cases: list.length, passed: list.filter(c => c.passed).length, latencyMs: { p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }, inputTokens: list.reduce((n, c) => n + (c.inputTokens ?? 0), 0), outputTokens: list.reduce((n, c) => n + (c.outputTokens ?? 0), 0) };
report.provider = provider.status(); report.measurements = provider.metrics();
const serialized = JSON.stringify(report, null, 2);
if (serialized.includes(key)) throw new Error('Refusing to write a report containing the API key.');
writeFileSync(out, serialized + '\n'); console.log(JSON.stringify(report.summary)); if (report.status !== 'passed') process.exitCode = 1;
