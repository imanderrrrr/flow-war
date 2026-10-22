import type { Change, Company, GameState, Identity, Result } from '../shared/types.js';
import { INFRA_OPERATIONS, type InfraAuthorization, type InfraOperation, type InfraView, type OperationsState, type ReleaseRecord, type RollbackAuthorization } from '../shared/operations.js';
import { available } from './workflow.js';
import { auditCompletion } from './discipline.js';

/** Existing scenario cost: Q0.50 per provisioned server and simulated second (doc 03 §10). */
export const SERVER_COST_PER_SECOND = 0.5;
/** Existing transition times: Rolling 6 s, Restart Replace 3 s. A rollback uses the strategy DevOps chooses. */
export const STRATEGY_SECONDS = { rolling: 6, restart: 3 } as const;
export const AUTHORIZATION_SECONDS = 60;
const FOREVER = Number.MAX_SAFE_INTEGER;

export function initialOperationsState(c: Pick<Company, 'id' | 'infraBudget' | 'version' | 'backend' | 'security'>, duration: number): OperationsState {
  // Identical for the five companies: it funds and covers only the minimum infrastructure.
  return {
    requests: [], rollbacks: [],
    authorizations: [{ id: `C${c.id}-INFRA0`, companyId: c.id, amount: c.infraBudget, durationSeconds: duration, maxServers: 1, operations: [], authorizedBy: 'scenario', at: 0, expires: duration, status: 'ACTIVE', kind: 'initial' }],
    releases: [{ version: c.version, changeId: null, kind: 'initial', at: 0, backend: structuredClone(c.backend), security: structuredClone(c.security) }],
  };
}
/** Games saved before Entrega 8 keep the scope they had: scaling and balancer limited only by budget. */
export function operations(c: Company): OperationsState {
  return c.runtime.infra ??= {
    requests: [], rollbacks: [],
    authorizations: [{ id: `C${c.id}-LEGACY`, companyId: c.id, amount: c.infraBudget, durationSeconds: FOREVER, maxServers: 8, operations: [...INFRA_OPERATIONS], authorizedBy: 'legacy', at: 0, expires: FOREVER, status: 'ACTIVE', kind: 'legacy' }],
    releases: [{ version: c.version, changeId: null, kind: 'initial', at: 0, backend: structuredClone(c.backend), security: structuredClone(c.security) }],
  };
}
export function activeScope(c: Company, now: number): InfraAuthorization | undefined {
  return operations(c).authorizations.filter(a => a.status === 'ACTIVE' && now < a.expires).at(-1);
}
const LABELS: Record<InfraOperation, string> = { scale: 'escalar servidores', balancer: 'configurar el balanceador' };
/** DevOps executes only inside the scope the CTO authorized: operation type, window and maximum servers. */
export function assertScope(c: Company, now: number, op: InfraOperation, targetServers?: number) {
  const scope = activeScope(c, now);
  if (!scope) throw new Error('Sin autorización vigente de infraestructura. Solicita presupuesto al CTO.');
  if (!scope.operations.includes(op)) throw new Error(`La autorización vigente no incluye ${LABELS[op]}.`);
  if (op === 'scale' && targetServers !== undefined && targetServers > scope.maxServers) throw new Error(`Máximo autorizado: ${scope.maxServers} servidor${scope.maxServers === 1 ? '' : 'es'}.`);
}
function parseOperations(value: unknown): InfraOperation[] {
  const list = Array.isArray(value) ? value : [];
  if (!list.length || list.some(v => !INFRA_OPERATIONS.includes(v as InfraOperation)) || new Set(list).size !== list.length) throw new Error('Operaciones de infraestructura inválidas.');
  return INFRA_OPERATIONS.filter(o => list.includes(o));
}
export function rollbackInProgress(c: Company) { return operations(c).rollbacks.find(r => r.status === 'IN_PROGRESS'); }
/** Change (or rollback) currently replacing production; drives the capacity curve of its strategy. */
export function activeDeployment(g: GameState, c: Company): { strategy?: string } | undefined {
  return g.changes.find(ch => ch.companyId === c.id && ch.status === 'DEPLOYING') ?? rollbackInProgress(c);
}
export function recordRelease(g: GameState, c: Company, changeId: string | null, kind: ReleaseRecord['kind'], rollbackOf?: number) {
  const releases = operations(c).releases;
  releases.push({ version: c.version, changeId, kind, at: g.tick, backend: structuredClone(c.backend), security: structuredClone(c.security), ...(rollbackOf !== undefined ? { rollbackOf } : {}) });
  if (releases.length > 40) releases.splice(1, releases.length - 40);
}

type Event = (g: GameState, companyId: number, text: string, tone?: 'good' | 'bad' | 'neutral', category?: string) => void;
/** Infrastructure scope, budget requests and rollbacks. Returns undefined for other command types. */
export function operationsCommand(g: GameState, c: Company, actor: Identity, type: string, p: Record<string, unknown>, event: Event): Result | undefined {
  const state = operations(c);
  if (type === 'infra.request_budget') {
    if (state.requests.length >= 40) throw new Error('Límite de solicitudes de presupuesto alcanzado.');
    const request = { id: `C${c.id}-REQ${state.requests.length + 1}`, companyId: c.id, requestedBy: actor.id, amount: Number(p.amount), durationSeconds: Number(p.durationSeconds), maxServers: Number(p.maxServers), operations: parseOperations(p.operations), status: 'REQUESTED' as const, at: g.tick };
    state.requests.push(request);
    event(g, c.id, `${request.id}: DevOps solicita ${money(request.amount)} · ${request.durationSeconds} s · máx. ${request.maxServers} servidores.`, 'neutral', 'DEVOPS');
    return { ok: true, refs: [request.id] };
  }
  if (type === 'cto.infra_authorize') {
    const amount = Number(p.amount), request = p.requestId ? state.requests.find(r => r.id === p.requestId) : undefined;
    if (p.requestId && (!request || request.status !== 'REQUESTED')) throw new Error('Solicitud no disponible.');
    if (available(c) < amount) throw new Error('Saldo disponible insuficiente.');
    const ops = parseOperations(p.operations);
    for (const a of state.authorizations) if (a.status === 'ACTIVE') a.status = 'SUPERSEDED';
    c.infraBudget += amount;
    const authorization: InfraAuthorization = { id: `C${c.id}-INFRA${state.authorizations.length}`, companyId: c.id, amount, durationSeconds: Number(p.durationSeconds), maxServers: Number(p.maxServers), operations: ops, authorizedBy: actor.id, at: g.tick, expires: g.tick + Number(p.durationSeconds), status: 'ACTIVE', kind: 'cto', ...(request ? { requestId: request.id } : {}) };
    state.authorizations.push(authorization);
    if (request) { request.status = 'AUTHORIZED'; request.decidedBy = actor.id; request.decidedAt = g.tick; request.authorizationId = authorization.id; }
    event(g, c.id, `CTO autoriza ${money(amount)} de infraestructura · ${authorization.durationSeconds} s · máx. ${authorization.maxServers} servidores.`, 'neutral', 'CTO');
    return { ok: true, refs: [authorization.id, ...(request ? [request.id] : [])] };
  }
  if (type === 'cto.infra_reject') {
    const request = state.requests.find(r => r.id === p.requestId);
    if (!request || request.status !== 'REQUESTED') throw new Error('Solicitud no disponible.');
    request.status = 'REJECTED'; request.decidedBy = actor.id; request.decidedAt = g.tick;
    event(g, c.id, `${request.id} rechazada por CTO.`, 'neutral', 'CTO');
    return { ok: true, refs: [request.id] };
  }
  if (type === 'cto.rollback_authorize') {
    const target = Number(p.targetVersion), amount = Number(p.amount);
    if (target === c.version) throw new Error('Esa versión ya está en producción.');
    const record = state.releases.filter(r => r.version === target).at(-1);
    if (!record || (!c.runtime.releases[target] && record.kind !== 'initial')) throw new Error('Versión no disponible para rollback.');
    // A new rollback authorization replaces the previous one; its reservation is freed before checking funds.
    const previous = state.rollbacks.filter(r => r.status === 'AUTHORIZED'), freed = previous.reduce((sum, r) => sum + r.reserved, 0);
    if (available(c) + freed < amount) throw new Error('Saldo disponible insuficiente.');
    for (const r of previous) { c.reserved = Math.max(0, c.reserved - r.reserved); r.reserved = 0; r.status = 'CANCELLED'; }
    const rollback: RollbackAuthorization = { id: `C${c.id}-RB${state.rollbacks.length + 1}`, companyId: c.id, targetVersion: target, amount, reserved: amount, spent: 0, authorizedBy: actor.id, at: g.tick, expires: g.tick + AUTHORIZATION_SECONDS, status: 'AUTHORIZED' };
    c.reserved += amount; state.rollbacks.push(rollback);
    event(g, c.id, `CTO autoriza rollback a v${target} · reservado ${money(amount)}.`, 'neutral', 'CTO');
    return { ok: true, refs: [rollback.id] };
  }
  if (type === 'deploy.rollback') {
    const rollback = p.authorizationId ? state.rollbacks.find(r => r.id === p.authorizationId) : state.rollbacks.filter(r => r.status === 'AUTHORIZED').at(-1);
    if (!rollback || rollback.status !== 'AUTHORIZED' || g.tick > rollback.expires) throw new Error('No existe una autorización de rollback vigente.');
    if (g.changes.some(ch => ch.companyId === c.id && ch.status === 'DEPLOYING') || rollbackInProgress(c)) throw new Error('Ya existe un despliegue activo.');
    if (rollback.targetVersion === c.version) throw new Error('Esa versión ya está en producción.');
    if (c.capital - c.infraBudget < c.reserved) throw new Error('Saldo reservado insuficiente. Solicita evaluación del CTO.');
    const strategy = p.strategy === 'rolling' ? 'rolling' : 'restart';
    rollback.status = 'IN_PROGRESS'; rollback.strategy = strategy; rollback.startedBy = actor.id; rollback.startedAt = g.tick; rollback.due = g.tick + STRATEGY_SECONDS[strategy];
    event(g, c.id, `ROLLBACK a v${rollback.targetVersion} iniciado · ${strategy === 'rolling' ? 'ROLLING' : 'RESTART REPLACE'}.`, 'neutral', 'DEVOPS');
    return { ok: true, refs: [rollback.id] };
  }
}
const money = (n: number) => `Q${Math.round(n * 100) / 100}`;
function releaseRollback(c: Company, r: RollbackAuthorization) { c.reserved = Math.max(0, c.reserved - r.reserved); r.reserved = 0; }
/** Per tick: scope expiry, rollback expiry and completion. A rollback is a new release; it refunds nothing. */
export function advanceOperations(g: GameState, c: Company, event: Event, stale: (c: Company, keep?: Change) => void) {
  const state = operations(c);
  for (const a of state.authorizations) if (a.status === 'ACTIVE' && g.tick >= a.expires) { a.status = 'EXPIRED'; if (a.kind === 'cto') event(g, c.id, `${a.id}: autorización de infraestructura vencida.`, 'neutral', 'DEVOPS'); }
  for (const r of state.rollbacks) {
    if (r.status === 'AUTHORIZED' && g.tick > r.expires) { releaseRollback(c, r); r.status = 'EXPIRED'; }
    if (r.status !== 'IN_PROGRESS' || g.tick < (r.due ?? Infinity)) continue;
    const target = state.releases.filter(x => x.version === r.targetVersion).at(-1);
    if (!target || c.capital < r.amount || c.capital - c.infraBudget < c.reserved) { releaseRollback(c, r); r.status = 'FAILED'; event(g, c.id, `Rollback a v${r.targetVersion} cancelado por saldo insuficiente.`, 'neutral', 'CTO'); continue; }
    // The initial version has no modules; its execution bundle may never have been materialized.
    const execution = structuredClone(c.runtime.releases[r.targetVersion] ?? { modules: [] });
    c.backend = structuredClone(target.backend); c.security = structuredClone(target.security); c.version++;
    c.runtime.releases[c.version] = execution;
    c.deployments++; c.capital -= r.amount; c.reserved = Math.max(0, c.reserved - r.reserved); r.spent = r.amount; r.reserved = 0; r.status = 'COMPLETED'; r.resultVersion = c.version;
    recordRelease(g, c, null, 'rollback', r.targetVersion);
    auditCompletion(g, c.id, 'rollback.completed', [r.id], [`production.version:${c.version}`, `base.version:${r.targetVersion}`, `capital.delta:${-r.amount}`]);
    event(g, c.id, `ROLLBACK COMPLETADO · v${c.version} restaura v${r.targetVersion}`, 'good', 'DEPLOY');
    stale(c);
  }
}
/** Capital fell below commitments: unstarted rollback reservations are released, as unstarted deployments are. */
export function reconcileRollbacks(c: Company) {
  for (const r of operations(c).rollbacks) if (r.status === 'AUTHORIZED' && c.capital < c.reserved + c.infraBudget) { releaseRollback(c, r); r.status = 'EXPIRED'; }
}
export function closeOperations(c: Company) {
  for (const r of operations(c).rollbacks) if (['AUTHORIZED', 'IN_PROGRESS'].includes(r.status)) { releaseRollback(c, r); r.status = r.status === 'IN_PROGRESS' ? 'FAILED' : 'EXPIRED'; }
}
export function infraView(c: Company, now: number): InfraView {
  const state = operations(c);
  return {
    requests: structuredClone(state.requests.slice(-20)), authorizations: structuredClone(state.authorizations.slice(-12)), scope: structuredClone(activeScope(c, now) ?? null),
    rollbacks: structuredClone(state.rollbacks.slice(-12)), releases: state.releases.map(({ backend, security, ...r }) => r), costPerSecond: c.servers * SERVER_COST_PER_SECOND,
  };
}
