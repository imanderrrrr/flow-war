import type { Graph, Identity, ServiceId } from './types.js';

export const ACTION_VERSION = 1 as const;
export type ModuleConfiguration =
  | { kind: 'discount' | 'coupon'; percent: number; audience: 'all' | 'new'; stackable: boolean }
  | { kind: 'inventory'; minimum: number }
  | { kind: 'purchase'; idempotent: boolean }
  | { kind: 'concurrency'; strategy: 'unsafe' | 'atomic' | 'lock' };
export type SecurityConfiguration = {
  auth: boolean; authorization: boolean; waf: boolean; botThreshold: number; blockedOrigins: string[];
  rate: { limit: number; windowSeconds: number; groupBy: 'origin' | 'customer'; scope: 'all' | 'purchase'; exceed: 'reject' } | null;
};
export type TestScenario = {
  authenticated?: boolean; ownsPurchase?: boolean; automated?: boolean; origin?: string;
  suite: 'unit' | 'integration' | 'concurrency' | 'load' | 'security' | 'regression';
  requests: number; stock: number; concurrency: number; retries: number; duplicateIntent: boolean;
  coupons: number; newCustomer: boolean; invalidInput: boolean; attack: 'none' | 'forged' | 'injection' | 'bot'; interrupt: boolean;
};
export const DEFAULT_TEST: TestScenario = { suite: 'unit', requests: 1, stock: 100, concurrency: 1, retries: 0, duplicateIntent: false, coupons: 1, newCustomer: true, invalidInput: false, attack: 'none', interrupt: false };
export type CampaignConfiguration = { percent: number; audience: 'all' | 'new'; duration: number; budget: number; demandMultiplier: number };
export type ActionParameters = {
  'ai.confirm': {proposalId:string;confirmed:true};
  'investment.link': {orderId:string;changeId:string};
  'qa.return': {changeId:string; recipient:'backend'|'security'|'product'; subject:string; description:string; steps:string; observed:string; expected:string; severity:'low'|'medium'|'high'|'critical'; evidenceIds:string[]; observationRefs:string[]};
  'qa.repeat': {runId:string};
  'qa.review': {changeId:string; risks:string; evidenceIds:string[]};
  'change.cancel': {changeId:string; reason:string; confirmed:true};
  'cto.decide': {changeId:string; decision:'authorize'|'reject'|'evidence'; reason:string; confirmed:true};
  'investment.create': {department:'backend'|'security'; objective:string; justification:string; maximum:number; changeId?:string; confirmed:true};
  'investment.transition': {orderId:string; status:'AUTHORIZED'|'IN_PROGRESS'|'COMPLETED'|'CANCELLED'; spent:number; confirmed:true};
  'security.save': { changeId: string; nodeId: string; text: string; revision: number; interpretationId?: string };
  'security.configure': { changeId: string; nodeId: string; revision: number; rules: import('./collaboration.js').ProtectionRule[] };
  'security.submit': { changeId: string; revision: number };
  'security.correction': { changeId: string; nodeId: string; text: string };
  'ai.accept': { proposalId: string }; 'ai.reject': { proposalId: string };
  'module.create': { name: string; configuration: ModuleConfiguration; dependencies: string[] };
  'module.revise': { moduleId: string; name: string; configuration: ModuleConfiguration; dependencies: string[] };
  /** A module drafted in words with Claude. `pending` is chosen by the server (server/design.ts) and verified on apply. */
  'module.design': { name: string; components: string[]; summary: string; pending: import('./auditor.js').ControlCheck[] };
  /** External auditor: one prueba de control against a control pendiente of a production module. */
  'audit.probe': { companyId: number; nodeId: string; check: import('./auditor.js').ControlCheck };
  /** External auditor: sustains the anomalous traffic of an open finding for a bounded window. */
  'audit.sustain': { findingId: string };
  'security.prepare': SecurityConfiguration;
  'qa.execute': { changeId: string; scenario: TestScenario; request?: string; threadId?: string };
  'infra.maintenance': { mode: 'OPERATING' | 'ORDERS_PAUSED' | 'FULL_MAINTENANCE' };
  'infra.restart': { serverId: number; duration: number };
  'infra.restart_all': { duration: number };
  'infra.stop': { service: ServiceId };
  'infra.recover': { service: ServiceId };
  'campaign.prepare': CampaignConfiguration;
  'campaign.authorize': { campaignId: string };
  'campaign.reject': { campaignId: string };
  'campaign.activate': { campaignId: string };
  'product.propose': { name: string; description: string };
  'employee.correct': { employeeId: string; justification: string };
  'draft.save': { graph: Graph; revision: number };
  'change.submit': { graph: Graph; revision: number };
  'qa.run': { suite: string };
  'qa.approve': Record<string, never>; 'qa.reject': Record<string, never>;
  'cto.authorize': Record<string, never>; 'cto.reject': Record<string, never>;
  'cto.budget': { amount: number }; 'cto.prioritize': { incident: 'security' | 'concurrency' };
  'infra.scale': { delta: 1 | -1 } | { target: number }; 'infra.balancer': { enabled: boolean };
  'deploy.start': { strategy: 'rolling' | 'restart' };
  'infra.request_budget': { amount: number; durationSeconds: number; maxServers: number; operations: import('./operations.js').InfraOperation[] };
  'cto.infra_authorize': { amount: number; durationSeconds: number; maxServers: number; operations: import('./operations.js').InfraOperation[]; requestId?: string };
  'cto.infra_reject': { requestId: string };
  'cto.rollback_authorize': { targetVersion: number; amount: number };
  'deploy.rollback': { strategy: 'rolling' | 'restart'; authorizationId?: string };
  'infra.server_stop': { serverId: number }; 'infra.server_start': { serverId: number };
  'product.draft': { catalogId: string; percent: number; duration: number; demandMultiplier: number; budget: number }; 'product.submit': { draftId: string };
};
export type ActionType = keyof ActionParameters;
export type SimulatedAction = { [K in ActionType]: {
  version: 1; id: string; companyId: number; type: K; parameters: ActionParameters[K]; source: 'ui' | 'agent' | 'fixture';
  changeId?: string; correlationId?: string; requestedAt?: number;
} }[ActionType];
export type ActionCategory = 'artifact' | 'preparation' | 'qa' | 'finance' | 'operation' | 'publication' | 'administration';
const entry = (roles: Identity['role'][], category: ActionCategory) => ({ roles, category, version: ACTION_VERSION });
/** Shared by the existing UI, structured adapter and future provider. */
export const ACTION_CATALOG = {
  'ai.confirm': entry(['cto'], 'finance'), 'investment.link': entry(['backend','security'], 'preparation'),
  'qa.return': entry(['qa'], 'qa'), 'qa.repeat': entry(['qa'], 'qa'), 'qa.review': entry(['qa'], 'qa'),
  'change.cancel': entry(['qa'], 'qa'), 'cto.decide': entry(['cto'], 'finance'),
  'investment.create': entry(['cto'], 'finance'), 'investment.transition': entry(['cto','backend','security'], 'finance'),
  'security.save': entry(['security'], 'preparation'), 'security.configure': entry(['security'], 'preparation'), 'security.submit': entry(['security'], 'preparation'),
  'security.correction': entry(['security'], 'preparation'), 'ai.accept': entry(['backend', 'security','qa'], 'preparation'), 'ai.reject': entry(['backend', 'security','qa','cto'], 'preparation'),
  'module.create': entry(['backend'], 'artifact'), 'module.revise': entry(['backend'], 'artifact'), 'module.design': entry(['backend'], 'artifact'),
  'audit.probe': entry(['auditor'], 'operation'), 'audit.sustain': entry(['auditor'], 'operation'),
  'security.prepare': entry(['security'], 'preparation'), 'qa.execute': entry(['qa'], 'qa'),
  'infra.maintenance': entry(['devops'], 'operation'),
  'infra.restart': entry(['devops'], 'operation'), 'infra.restart_all': entry(['devops'], 'operation'),
  'infra.stop': entry(['devops'], 'operation'), 'infra.recover': entry(['devops'], 'operation'),
  'campaign.prepare': entry(['product'], 'artifact'), 'campaign.authorize': entry(['cto'], 'finance'),
  'campaign.reject': entry(['cto'], 'finance'), 'campaign.activate': entry(['product'], 'operation'),
  'product.propose': entry(['product'], 'preparation'), 'employee.correct': entry(['operator'], 'administration'),
  'draft.save': entry(['backend', 'security'], 'preparation'), 'change.submit': entry(['backend', 'security'], 'preparation'),
  'qa.run': entry(['qa'], 'qa'), 'qa.approve': entry(['qa'], 'qa'), 'qa.reject': entry(['qa'], 'qa'),
  'cto.authorize': entry(['cto'], 'finance'), 'cto.reject': entry(['cto'], 'finance'),
  'cto.budget': entry(['cto'], 'finance'), 'cto.prioritize': entry(['cto'], 'operation'),
  'infra.scale': entry(['devops'], 'operation'), 'infra.balancer': entry(['devops'], 'operation'), 'deploy.start': entry(['devops'], 'publication'),
  'infra.request_budget': entry(['devops'], 'finance'), 'cto.infra_authorize': entry(['cto'], 'finance'), 'cto.infra_reject': entry(['cto'], 'finance'),
  'cto.rollback_authorize': entry(['cto'], 'finance'), 'deploy.rollback': entry(['devops'], 'publication'),
  'infra.server_stop': entry(['devops'], 'operation'), 'infra.server_start': entry(['devops'], 'operation'),
  'product.draft': entry(['product'], 'artifact'), 'product.submit': entry(['product'], 'preparation'), 'room.product': entry(['operator'], 'administration'),
  'room.dvr': entry(['operator'], 'administration'),
  'room.start': entry(['operator'], 'administration'), 'room.pause': entry(['operator'], 'administration'),
  'room.reset': entry(['operator'], 'administration'), 'room.speed': entry(['operator'], 'administration'), 'room.finish': entry(['operator'], 'administration'),
} as const;
export function allowedAction(type: string, role: Identity['role']) {
  return Object.hasOwn(ACTION_CATALOG, type) && (ACTION_CATALOG[type as keyof typeof ACTION_CATALOG].roles as readonly string[]).includes(role);
}
