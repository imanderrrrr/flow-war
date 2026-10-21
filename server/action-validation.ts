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
  const p = object(input); keys(p, ['suite','requests','stock','concurrency','retries','duplicateIntent','coupons','newCustomer','invalidInput','attack','interrupt','authenticated','ownsPurchase','automated','origin']);
  const context:Record<string,unknown>={};for(const key of ['authenticated','ownsPurchase','automated'])if(p[key]!==undefined)context[key]=bool(p[key]);
  if(p.origin!==undefined){if(!/^sim-\d{1,3}$/.test(string(p.origin)))throw new ActionError('INVALID','Origen sintético requerido.');context.origin=p.origin;}
  const requests = integer(p.requests, 1, 500);
  return { ...context, suite: oneOf(p.suite, ['unit','integration','concurrency','load','security','regression']), requests, stock: integer(p.stock, 0, 2000), concurrency: integer(p.concurrency, 1, requests), retries: integer(p.retries, 0, 5), duplicateIntent: bool(p.duplicateIntent), coupons: integer(p.coupons, 0, 3), newCustomer: bool(p.newCustomer), invalidInput: bool(p.invalidInput), attack: oneOf(p.attack, ['none','forged','injection','bot']), interrupt: bool(p.interrupt) };
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
    case 'ai.confirm':keys(p,['proposalId','confirmed']);string(p.proposalId);if(p.confirmed!==true)throw new ActionError('INVALID','Confirma la decisión.');break;
    case 'investment.link':keys(p,['orderId','changeId']);string(p.orderId);string(p.changeId);break;
    case 'qa.return':
      keys(p,['changeId','recipient','subject','description','steps','observed','expected','severity','evidenceIds','observationRefs']);string(p.changeId);oneOf(p.recipient,['backend','security']);oneOf(p.severity,['low','medium','high','critical']);
      for(const k of ['subject','description','steps','observed','expected'])if(!freeText(p[k]).trim())throw new ActionError('INVALID','Carta incompleta.');
      for(const k of ['evidenceIds','observationRefs']){if(!Array.isArray(p[k])||(p[k] as unknown[]).length>160)throw new ActionError('INVALID','Referencias inválidas.');(p[k] as unknown[]).forEach(v=>string(v));}break;
    case 'qa.repeat':keys(p,['runId']);string(p.runId);break;
    case 'qa.review':keys(p,['changeId','risks','evidenceIds']);string(p.changeId);if(!freeText(p.risks).trim())throw new ActionError('INVALID','Registra tu evaluación de riesgos.');if(!Array.isArray(p.evidenceIds)||!p.evidenceIds.length||p.evidenceIds.length>160)throw new ActionError('INVALID','Selecciona evidencia.');p.evidenceIds.forEach(v=>string(v));break;
    case 'change.cancel':keys(p,['changeId','reason','confirmed']);string(p.changeId);if(p.confirmed!==true||!freeText(p.reason).trim())throw new ActionError('INVALID','Confirmación y motivo requeridos.');break;
    case 'cto.decide':keys(p,['changeId','decision','reason','confirmed']);string(p.changeId);oneOf(p.decision,['authorize','reject','evidence']);if(p.confirmed!==true||!freeText(p.reason).trim())throw new ActionError('INVALID','Confirmación y motivo requeridos.');break;
    case 'investment.create':keys(p,['department','objective','justification','maximum','changeId','confirmed']);oneOf(p.department,['backend','security']);for(const k of ['objective','justification'])if(!freeText(p[k]).trim())throw new ActionError('INVALID','Objetivo y justificación requeridos.');integer(p.maximum,1,10000);if(p.changeId!==undefined)string(p.changeId);if(p.confirmed!==true)throw new ActionError('INVALID','Confirma la orden.');break;
    case 'investment.transition':keys(p,['orderId','status','spent','confirmed']);string(p.orderId);oneOf(p.status,['AUTHORIZED','IN_PROGRESS','COMPLETED','CANCELLED']);integer(p.spent,0,0);if(p.confirmed!==true)throw new ActionError('INVALID','Confirma la transición.');break;
    case 'security.save':
      keys(p, ['changeId','nodeId','text','revision','interpretationId']); string(p.changeId); string(p.nodeId); freeText(p.text); integer(p.revision,0,100000); if(p.interpretationId!==undefined)string(p.interpretationId); break;
    case 'security.configure': keys(p,['changeId','nodeId','revision','rules']); string(p.changeId); string(p.nodeId); integer(p.revision,0,100000); if(!Array.isArray(p.rules)||p.rules.length>12)throw new ActionError('INVALID','Política inválida.'); break;
    case 'security.submit': keys(p,['changeId','revision']); string(p.changeId); integer(p.revision,0,100000); break;
    case 'security.correction': keys(p,['changeId','nodeId','text']); string(p.changeId); string(p.nodeId); freeText(p.text); if(!String(p.text).trim())throw new ActionError('INVALID','Observación vacía.'); break;
    case 'ai.accept': case 'ai.reject': keys(p,['proposalId']); string(p.proposalId); break;
    case 'module.create': case 'module.revise':
      keys(p, ['name','configuration','dependencies', ...(type === 'module.revise' ? ['moduleId'] : [])]); string(p.name); moduleConfiguration(p.configuration);
      if (type === 'module.revise') string(p.moduleId);
      if (!Array.isArray(p.dependencies) || p.dependencies.length > 8) throw new ActionError('INVALID', 'Dependencias inválidas.'); p.dependencies.forEach(v => string(v)); break;
    case 'security.prepare': securityConfiguration(p); break;
    case 'qa.execute': keys(p, ['changeId','scenario','request','threadId']); string(p.changeId); testScenario(p.scenario); if (p.request !== undefined && !freeText(p.request).trim()) throw new ActionError('INVALID', 'Solicitud vacía.'); if (p.threadId !== undefined) string(p.threadId); break;
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
    case 'infra.scale': if ('target' in p) { keys(p, ['target']); integer(p.target, 1, 8); } else { keys(p, ['delta']); if (![1,-1].includes(integer(p.delta, -1, 1))) throw new ActionError('INVALID', 'Delta inválido.'); } break;
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

export function freeText(v: unknown): string { if(typeof v !== 'string' || v.length>4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))throw new ActionError('INVALID','Texto inválido.'); return v; }
