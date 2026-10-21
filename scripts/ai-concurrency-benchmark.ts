import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { AiGateway, AnthropicProvider } from '../server/claude.js';
import { AiScheduler } from '../server/ai-scheduler.js';
import { toolDefinitions } from '../server/executor.js';

/**
 * Executor concurrency through the official SDK against a simulated Messages API transport.
 * Measures scheduling only: fairness, per-company bound and queueing. It asserts nothing about
 * the real capacity contracted with Anthropic.
 */
const began = performance.now(), order: number[] = [], active = Array(5).fill(0), maximum = Array(5).fill(0);
let global = 0, maxGlobal = 0;
const perCompany = Number(process.env.FLOW_AI_COMPANY_CONCURRENCY ?? 2);
const transport: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init!.body)), company = Number(JSON.parse(body.messages[0].content).instruccion.split('-')[1]);
  active[company]++; global++; maximum[company] = Math.max(maximum[company], active[company]); maxGlobal = Math.max(global, maxGlobal); order.push(company);
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, company === 0 ? 120 : 20); init!.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true }); });
  active[company]--; global--;
  return new Response(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu', name: 'consultar_datos', input: { tema: 'infraestructura' } }], usage: { input_tokens: 2100, output_tokens: 30, cache_read_input_tokens: 1900 } }), { headers: { 'content-type': 'application/json' } });
};
const provider = new AnthropicProvider('synthetic-key', 'simulated-transport', transport);
const gateway = new AiGateway(provider, Date.now, new AiScheduler(5, 30, 30000, perCompany)), tasks: Promise<unknown>[] = [];
const tools = toolDefinitions('devops');
for (let round = 0; round < 6; round++) for (let company = 0; company < 5; company++)
  tasks.push(gateway.interpret(`${company}-u${round}`, company, { id: `${company}-${round}`, system: 'benchmark', tools, content: JSON.stringify({ instruccion: `company-${company}-${round}` }) }, { usedByGame: 0, usedByCompany: 0 }).then(r => assert.equal(r.calls[0].name, 'consultar_datos')));
await Promise.all(tasks); await new Promise<void>(r => setImmediate(r));
assert(maxGlobal <= 5); assert(maximum.every(n => n <= perCompany)); assert.deepEqual(order.slice(0, 5), [0, 1, 2, 3, 4]);
const metrics = gateway.scheduler.metrics(), percentiles = (nums: number[]) => { const s = nums.slice().sort((a, b) => a - b); return { n: s.length, p50: s[Math.ceil(s.length * .5) - 1], p95: s[Math.ceil(s.length * .95) - 1], max: s.at(-1) }; };
const report = { status: 'passed', at: new Date().toISOString(), transport: 'official SDK over a simulated Messages API transport; not a measurement of Anthropic capacity', requests: tasks.length, companies: 5, capacity: 5, perCompany, maxGlobal, maxPerCompany: maximum, slowCompany: 0, wallMs: Math.round(performance.now() - began), waitMs: percentiles(metrics.recent.map(r => r.waitMs ?? 0)), durationMs: percentiles(metrics.recent.map(r => r.durationMs ?? 0)), inputTokens: provider.metrics().reduce((n, m) => n + (m.inputTokens ?? 0), 0), outputTokens: provider.metrics().reduce((n, m) => n + (m.outputTokens ?? 0), 0), cacheReadTokens: provider.metrics().reduce((n, m) => n + (m.cacheReadTokens ?? 0), 0), toolsPerRequest: tools.length };
mkdirSync('docs/benchmarks/entrega-8', { recursive: true });
writeFileSync('docs/benchmarks/entrega-8/ai-concurrency.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
