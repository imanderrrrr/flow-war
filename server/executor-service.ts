import type { Command, GameState, Identity, Result, Role } from '../shared/types.js';
import type { ExecutorInput, ExecutorReply, OperationOutcome, ToolCall } from '../shared/executor.js';
import type { AiUsage } from '../shared/workflow.js';
import { object, keys, string, integer, freeText } from './action-validation.js';
import { AiError, type AiGateway, type InterpretResult } from './claude.js';
import { stableDigest } from './discipline.js';
import { productEnabled } from './product.js';
import { systemFor, commandsFor, executorContext, finalReply, modelContext, outcome, planCalls, toolDefinitions, type ExecutorContext } from './executor.js';
import { sourceTexts } from './grounding.js';
import { screenInstruction } from './scope.js';

export function parseExecutorInput(raw: unknown): ExecutorInput {
  const p = object(raw); keys(p, ['id', 'text', 'threadId', 'selection']);
  string(p.id, 80); const text = freeText(p.text);
  if (!text.trim() || text.length > 2000) throw new AiError('INVALID', 'Escribe una instrucción de hasta 2000 caracteres.');
  if (p.threadId !== undefined) string(p.threadId, 60);
  let selection: ExecutorInput['selection'];
  if (p.selection !== undefined) {
    const s = object(p.selection); keys(s, ['changeId', 'nodeId', 'serverId', 'draftId']); selection = {};
    if (s.changeId !== undefined && s.changeId !== null) selection.changeId = string(s.changeId, 40);
    if (s.nodeId !== undefined && s.nodeId !== null) selection.nodeId = string(s.nodeId, 100);
    if (s.serverId !== undefined && s.serverId !== null) selection.serverId = integer(s.serverId, 1, 8);
    if (s.draftId !== undefined && s.draftId !== null) selection.draftId = string(s.draftId, 40);
  }
  return { id: String(p.id), text, ...(p.threadId ? { threadId: String(p.threadId) } : {}), ...(selection ? { selection } : {}) };
}
const threadOf = (g: GameState, actor: Identity, threadId: string) => g.companies[actor.companyId!].runtime.conversations?.find(t => t.id === threadId && t.actor === actor.id && t.role === actor.role && t.generation === g.generation);
/** Earlier instructions of the same student in the same thread: the only other source of stated values. */
export function previousInstructions(g: GameState, actor: Identity, threadId: string, requestId: string) {
  return (threadOf(g, actor, threadId)?.messages ?? []).filter(m => m.role === 'user' && m.requestId !== requestId).slice(-6).map(m => m.text);
}
export function usageOf(g: GameState, companyId: number): AiUsage { return g.companies[companyId].runtime.aiUsage ??= { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }; }
export function tokenBudget(g: GameState, companyId: number) {
  const total = (u?: AiUsage) => (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0);
  return { usedByGame: g.companies.reduce((sum, c) => sum + total(c.runtime.aiUsage), 0), usedByCompany: total(g.companies[companyId].runtime.aiUsage) };
}
/** Records the human instruction before any network I/O. A retry with the same ID and text reuses it. */
export function beginExecution(g: GameState, actor: Identity, input: ExecutorInput) {
  if (actor.role === 'product' && !productEnabled(g)) throw new AiError('PRODUCT_DISABLED', 'Producto/UX no está habilitado en esta partida.');
  if (g.status !== 'RUNNING') throw new AiError('ROOM_PAUSED', 'La simulación no está en curso.');
  const ctx = executorContext(g, actor, input, []), c = ctx.c;
  if (c.eliminated) throw new AiError('FORBIDDEN', 'La empresa está fuera de la partida.');
  const attempts = c.runtime.aiAttempts ??= [], digest = stableDigest({ text: input.text, threadId: ctx.threadId, selection: input.selection ?? {} });
  const prior = attempts.find(a => a.actor === actor.id && a.id === input.id && a.generation === g.generation);
  if (prior) { if (prior.digest !== digest) throw new AiError('ID_CONFLICT', 'ID de solicitud ya utilizado.'); return { attempt: prior, replay: true }; }
  if (attempts.filter(a => a.generation === g.generation).length >= 480) throw new AiError('AI_LIMIT', 'Límite de solicitudes de la partida alcanzado.');
  const threads = c.runtime.conversations ??= [];
  let thread = threadOf(g, actor, ctx.threadId);
  if (!thread) { if (threads.filter(t => t.actor === actor.id && t.generation === g.generation).length >= 8) throw new AiError('AI_LIMIT', 'Límite de hilos alcanzado.'); thread = { id: ctx.threadId, actor: actor.id, role: actor.role, generation: g.generation, companyId: c.id, messages: [] }; threads.push(thread); }
  if (thread.messages.length >= 800) throw new AiError('AI_LIMIT', 'Este hilo alcanzó su límite. Abre otro hilo.');
  const attempt = { id: input.id, actor: actor.id, role: actor.role, generation: g.generation, threadId: ctx.threadId, digest, state: 'QUEUED', at: g.tick, kind: 'executor' as const };
  attempts.push(attempt);
  thread.messages.push({ id: `${input.id}-human`, requestId: input.id, role: 'user', text: input.text, at: g.tick, refs: input.selection?.changeId ? [input.selection.changeId] : [] });
  return { attempt, replay: false };
}
export type Snapshot = { generation: number; version: number; servers: number; changes: Record<string, string>; rollbacks: Record<string, string> };
/** Pre-call state of the resources an operation can target. */
export function snapshotFor(g: GameState, actor: Identity): Snapshot {
  const c = g.companies[actor.companyId!];
  return { generation: g.generation, version: c.version, servers: c.servers, changes: Object.fromEntries(g.changes.filter(ch => ch.companyId === c.id).map(ch => [ch.id, `${ch.status}:${ch.implementation?.bundleDigest ?? ''}:${ch.reports.length}`])), rollbacks: Object.fromEntries((c.runtime.infra?.rollbacks ?? []).map(r => [r.id, `${r.status}:${r.targetVersion}`])) };
}
/** A late reply never operates on a revision or game that changed while Claude was answering. */
export function staleTargets(before: Snapshot, after: Snapshot, commands: { type: string; changeId?: string; payload: Record<string, unknown> }[]) {
  if (before.generation !== after.generation || before.version !== after.version) return true;
  return commands.some(c => { const id = c.changeId ?? (typeof c.payload.changeId === 'string' ? c.payload.changeId : undefined), rollback = typeof c.payload.authorizationId === 'string' ? c.payload.authorizationId : undefined;
    return (id !== undefined && before.changes[id] !== after.changes[id]) || (c.type === 'infra.scale' && before.servers !== after.servers) || (rollback !== undefined && (before.rollbacks[rollback] === undefined || before.rollbacks[rollback] !== after.rollbacks[rollback])); });
}
export function buildRequest(g: GameState, actor: Identity, input: ExecutorInput) {
  const threadId = input.threadId ?? `${actor.role}-default`, ctx = executorContext(g, actor, input, previousInstructions(g, actor, threadId, input.id));
  const content = JSON.stringify({ instruccion: input.text, instrucciones_previas_del_estudiante: ctx.sources.previous, contexto_autorizado: modelContext(ctx) });
  if (content.length > 48000) throw new AiError('CONTEXT_LIMIT', 'El contexto seleccionado excede el límite.');
  return { request: { id: input.id, system: systemFor(actor.role), tools: toolDefinitions(actor.role as Role), content }, snapshot: snapshotFor(g, actor) };
}
const dedupe = (calls: ToolCall[]) => [...new Map(calls.map(c => [`${c.name}:${JSON.stringify(c.input ?? {})}`, c])).values()];
/** Applies one engine command through the durable pipeline (ACK after COMMIT). */
export type Submit = (command: Command) => Promise<Result>;
const asAction = (command: Command, companyId: number, correlationId: string): Command => ({ id: command.id, type: 'action.execute', payload: { action: { version: 1, id: command.id, companyId, type: command.type, parameters: command.payload ?? {}, source: 'agent', correlationId, ...(command.changeId ? { changeId: command.changeId } : {}) } } });
/**
 * Validates every call against the current state first; nothing runs if any call is ungrounded, delegated or
 * refused. Then each call is planned again on the state left by the previous one and executed in order.
 */
export async function executeCalls(current: () => { g: GameState; actor: Identity }, input: ExecutorInput, calls: ToolCall[], before: Snapshot, submit: Submit) {
  const context = (): ExecutorContext => { const { g, actor } = current(); return executorContext(g, actor, input, previousInstructions(g, actor, input.threadId ?? `${actor.role}-default`, input.id)); };
  const first = context(), dry = planCalls(calls, first);
  if (dry.state !== 'EXECUTED') return { ...finalReply(dry, []), outcomes: [] as OperationOutcome[] };
  if (staleTargets(before, snapshotFor(first.g, first.actor), dry.commands)) return { state: 'REJECTED' as const, message: 'La revisión o la partida cambió durante la solicitud. No se ejecutó nada.', outcomes: [] as OperationOutcome[] };
  const outcomes: OperationOutcome[] = [], information: string[] = [];
  let index = 0;
  for (const call of dedupe(calls)) {
    // Session, employment and game are rechecked before every operation; a change stops the rest.
    let ctx: ExecutorContext;
    try { ctx = context(); } catch { outcomes.push({ tool: call.name, ok: false, message: 'La sesión, el empleo o la partida cambió. Se detuvieron las operaciones restantes.', refs: [] }); break; }
    if (ctx.g.generation !== before.generation) { outcomes.push({ tool: call.name, ok: false, message: 'La partida cambió. Se detuvieron las operaciones restantes.', refs: [] }); break; }
    const plan = planCalls([call], ctx);
    information.push(...plan.information);
    if (plan.state === 'INFORMATION') continue;
    if (plan.state !== 'EXECUTED') { outcomes.push({ tool: call.name, ok: false, message: plan.message, refs: [] }); break; }
    let failed = false;
    for (const { planned, command } of commandsFor(plan, ctx)) {
      const id = `${input.id}:op${++index}`.slice(0, 100), result = await submit(asAction({ ...command, id }, ctx.c.id, input.id));
      let g = ctx.g; try { g = current().g; } catch { /* the reply still describes the committed result */ }
      outcomes.push(outcome(call.name, planned, result, g));
      if (!result.ok) { failed = true; break; }
    }
    if (failed) break;
  }
  const ok = outcomes.filter(o => o.ok).length;
  return { state: ok === outcomes.length && ok ? 'EXECUTED' as const : ok ? 'PARTIAL' as const : 'REJECTED' as const, message: [...outcomes.map(o => o.message), ...information].join('\n'), outcomes };
}
/** Stores the server-composed reply, provider consumption and request state in the same game transaction. */
export function finishExecution(g: GameState, actor: Identity, input: ExecutorInput, reply: { state: string; message: string; refs: string[] }, state: string, code?: string, interpretation?: InterpretResult) {
  const c = g.companies[actor.companyId!], attempt = c.runtime.aiAttempts?.find(a => a.actor === actor.id && a.id === input.id && a.generation === g.generation);
  if (attempt) { attempt.state = state; attempt.finishedAt = g.tick; attempt.code = code; attempt.reply = { state: reply.state, message: reply.message, refs: reply.refs }; }
  if (interpretation && interpretation.stopReason !== SCREENED) { const u = usageOf(g, c.id); u.requests++; u.inputTokens += interpretation.usage.inputTokens; u.outputTokens += interpretation.usage.outputTokens; u.cacheReadTokens += interpretation.usage.cacheReadTokens; u.cacheWriteTokens += interpretation.usage.cacheWriteTokens; }
  const thread = threadOf(g, actor, attempt?.threadId ?? input.threadId ?? `${actor.role}-default`);
  if (thread && !thread.messages.some(m => m.id === `${input.id}-assistant`)) thread.messages.push({ id: `${input.id}-assistant`, requestId: input.id, role: 'assistant', text: reply.message, at: g.tick, refs: reply.refs, state: reply.state });
}
export function replyFor(input: ExecutorInput, result: { state: ExecutorReply['state']; message: string; outcomes: OperationOutcome[] }, provider: string, model: string): ExecutorReply {
  return { id: input.id, state: result.state, message: result.message, operations: result.outcomes, refs: [...new Set(result.outcomes.flatMap(o => o.refs))], provider, model };
}
/** Stop reason of an instruction the scope screen refused before any provider call (server/scope.ts). */
export const SCREENED = 'screened';
export async function interpret(gateway: AiGateway, g: GameState, actor: Identity, input: ExecutorInput) {
  const { request, snapshot } = buildRequest(g, actor, input), threadId = input.threadId ?? `${actor.role}-default`;
  // Out of scope on the student's words alone: nothing is sent, and planCalls composes the refusal from no calls.
  if (screenInstruction(g, actor.companyId!, sourceTexts({ instruction: input.text, previous: previousInstructions(g, actor, threadId, input.id) })))
    return { result: { calls: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: gateway.provider.model, stopReason: SCREENED, fallback: false } as InterpretResult, snapshot };
  const result = await gateway.interpret(actor.id, actor.companyId!, request, tokenBudget(g, actor.companyId!));
  return { result, snapshot };
}
