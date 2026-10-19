import { ACTION_CATALOG, type SimulatedAction, type ModuleConfiguration, type TestScenario, type SecurityConfiguration, type ActionType } from '../shared/actions.js';

export class ActionError extends Error { constructor(public code: string, message: string) { super(message); } }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ActionError('INVALID', 'Se requiere un objeto.');
  return value as Record<string, unknown>;
}
export function keys(p: Record<string, unknown>, names: string[]) {
  if (Object.keys(p).some(k => !names.includes(k))) throw new ActionError('INVALID', 'Parámetro desconocido.');
}
export function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ActionError('INVALID', `Entero requerido: ${min}–${max}.`);
  return v;
}
export function string(v: unknown, max = 100): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f]/.test(v)) throw new ActionError('INVALID', 'Texto inválido.'); return v;
}
export function bool(v: unknown): boolean { if (typeof v !== 'boolean') throw new ActionError('INVALID', 'Booleano requerido.'); return v; }
export function oneOf<T extends string>(v: unknown, values: readonly T[]): T { if (!values.includes(v as T)) throw new ActionError('INVALID', 'Valor no soportado.'); return v as T; }
export function moduleConfiguration(input: unknown): ModuleConfiguration {
  const p = object(input);
  switch (p.kind) {
    case 'discount': case 'coupon': keys(p, ['kind','percent','audience','stackable']); return { kind: p.kind, percent: integer(p.percent, 0, 70), audience: oneOf(p.audience, ['all','new']), stackable: bool(p.stackable) };
    case 'inventory': keys(p, ['kind','minimum']); return { kind: p.kind, minimum: integer(p.minimum, 1, 120) };
    case 'purchase': keys(p, ['kind','idempotent']); return { kind: p.kind, idempotent: bool(p.idempotent) };
    case 'concurrency': keys(p, ['kind','strategy']); return { kind: p.kind, strategy: oneOf(p.strategy, ['unsafe','atomic','lock']) };
    default: throw new ActionError('UNSUPPORTED', 'Tipo de módulo no implementado.');
  }
}
export function testScenario(input: unknown): TestScenario {
  const p = object(input); keys(p, ['suite','requests','stock','concurrency','retries','duplicateIntent','coupons','newCustomer','invalidInput','attack','interrupt']);
  const requests = integer(p.requests, 1, 500);
  return { suite: oneOf(p.suite, ['unit','integration','concurrency','load','security','regression']), requests, stock: integer(p.stock, 0, 2000), concurrency: integer(p.concurrency, 1, requests), retries: integer(p.retries, 0, 5), duplicateIntent: bool(p.duplicateIntent), coupons: integer(p.coupons, 0, 3), newCustomer: bool(p.newCustomer), invalidInput: bool(p.invalidInput), attack: oneOf(p.attack, ['none','forged','injection','bot']), interrupt: bool(p.interrupt) };
}
export function securityConfiguration(input: unknown): SecurityConfiguration {
  const p = object(input); keys(p, ['auth','authorization','waf','botThreshold','blockedOrigins','rate']);
  if (!Array.isArray(p.blockedOrigins) || p.blockedOrigins.length > 64) throw new ActionError('INVALID', 'Máximo 64 orígenes sintéticos.');
  const blockedOrigins = p.blockedOrigins.map(v => { const s = string(v); if (!/^sim-[0-9]{1,3}$/.test(s)) throw new ActionError('INVALID', 'Origen sintético requerido.'); return s; });
  let rate: SecurityConfiguration['rate'] = null;
  if (p.rate !== null) { const r = object(p.rate); keys(r, ['limit','windowSeconds','groupBy','scope','exceed']); rate = { limit: integer(r.limit, 1, 10000), windowSeconds: integer(r.windowSeconds, 1, 300), groupBy: oneOf(r.groupBy, ['origin','customer']), scope: oneOf(r.scope, ['all','purchase']), exceed: oneOf(r.exceed, ['reject']) }; }
  return { auth: bool(p.auth), authorization: bool(p.authorization), waf: bool(p.waf), botThreshold: integer(p.botThreshold, 0, 100), blockedOrigins, rate };
}
export function validateParameters(type: string, input: unknown) {
  const p = object(input);
  switch (type) {
    case 'module.create': case 'module.revise':
      keys(p, ['name','configuration','dependencies', ...(type === 'module.revise' ? ['moduleId'] : [])]); string(p.name); moduleConfiguration(p.configuration);
      if (type === 'module.revise') string(p.moduleId);
      if (!Array.isArray(p.dependencies) || p.dependencies.length > 8) throw new ActionError('INVALID', 'Dependencias inválidas.'); p.dependencies.forEach(v => string(v)); break;
    case 'security.prepare': securityConfiguration(p); break;
    case 'qa.execute': keys(p, ['changeId','scenario']); string(p.changeId); testScenario(p.scenario); break;
    case 'infra.maintenance': keys(p, ['mode']); oneOf(p.mode, ['OPERATING','ORDERS_PAUSED','FULL_MAINTENANCE']); break;
    case 'infra.restart': keys(p, ['serverId','duration']); integer(p.serverId, 1, 8); integer(p.duration, 1, 60); break;
    case 'infra.restart_all': keys(p, ['duration']); integer(p.duration, 1, 60); break;
    case 'infra.stop': case 'infra.recover': keys(p, ['service']); oneOf(p.service, ['security','web','checkout','inventory','payment']); break;
    case 'campaign.prepare': keys(p, ['percent','audience','duration','budget','demandMultiplier']); integer(p.percent, 0, 70); oneOf(p.audience, ['all','new']); integer(p.duration, 10, 300); integer(p.budget, 1, 2000); if (typeof p.demandMultiplier !== 'number' || !Number.isFinite(p.demandMultiplier) || p.demandMultiplier < 1 || p.demandMultiplier > 4) throw new ActionError('INVALID', 'Multiplicador: 1–4.'); break;
    case 'campaign.authorize': case 'campaign.reject': case 'campaign.activate': keys(p, ['campaignId']); string(p.campaignId); break;
    case 'product.propose': keys(p, ['name','description']); string(p.name); string(p.description, 1000); break;
    case 'employee.correct': keys(p, ['employeeId','justification']); string(p.employeeId); string(p.justification, 1000); break;
    case 'draft.save': case 'change.submit': keys(p, ['graph','revision']); integer(p.revision, 0, 100000); object(p.graph); break;
    case 'qa.run': keys(p, ['suite']); oneOf(p.suite, ['Concurrencia','Regresión','Carga','Seguridad','Integración','Unitarias']); break;
    case 'qa.approve': case 'qa.reject': case 'cto.authorize': case 'cto.reject': keys(p, []); break;
    case 'cto.budget': keys(p, ['amount']); if (![250,500,1000].includes(integer(p.amount, 250, 1000))) throw new ActionError('INVALID', 'Importe no soportado.'); break;
    case 'cto.prioritize': keys(p, ['incident']); oneOf(p.incident, ['security','concurrency']); break;
    case 'infra.scale': keys(p, ['delta']); if (![1,-1].includes(integer(p.delta, -1, 1))) throw new ActionError('INVALID', 'Delta inválido.'); break;
    case 'infra.balancer': keys(p, ['enabled']); bool(p.enabled); break;
    case 'deploy.start': keys(p, ['strategy']); oneOf(p.strategy, ['rolling','restart']); break;
    default: throw new ActionError('UNSUPPORTED', 'Acción no implementada.');
  }
}
export function parseAction(input: unknown): SimulatedAction {
  const p = object(input); keys(p, ['version','id','companyId','type','parameters','source','changeId','correlationId','requestedAt']);
  if (p.version !== 1) throw new ActionError('VERSION', 'Contrato de acción no soportado.');
  string(p.id); integer(p.companyId, 0, 4); string(p.type); oneOf(p.source, ['ui','agent','fixture']);
  if (!Object.hasOwn(ACTION_CATALOG, p.type as string) || String(p.type).startsWith('room.')) throw new ActionError('UNSUPPORTED', 'Acción no implementada.');
  if (p.changeId !== undefined) string(p.changeId); if (p.correlationId !== undefined) string(p.correlationId);
  if (p.requestedAt !== undefined && (typeof p.requestedAt !== 'number' || !Number.isFinite(p.requestedAt) || p.requestedAt < 0)) throw new ActionError('INVALID', 'Tiempo inválido.');
  validateParameters(p.type as ActionType, p.parameters);
  return structuredClone(p) as SimulatedAction;
}
