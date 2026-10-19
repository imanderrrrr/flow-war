import type { Graph, Role, ServiceId } from './types.js';

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
  suite: 'unit' | 'integration' | 'concurrency' | 'load' | 'security' | 'regression';
  requests: number; stock: number; concurrency: number; retries: number; duplicateIntent: boolean;
  coupons: number; newCustomer: boolean; invalidInput: boolean; attack: 'none' | 'forged' | 'injection' | 'bot'; interrupt: boolean;
};
export const DEFAULT_TEST: TestScenario = { suite: 'unit', requests: 1, stock: 100, concurrency: 1, retries: 0, duplicateIntent: false, coupons: 1, newCustomer: true, invalidInput: false, attack: 'none', interrupt: false };
export type CampaignConfiguration = { percent: number; audience: 'all' | 'new'; duration: number; budget: number; demandMultiplier: number };
export type ActionParameters = {
  'module.create': { name: string; configuration: ModuleConfiguration; dependencies: string[] };
  'module.revise': { moduleId: string; name: string; configuration: ModuleConfiguration; dependencies: string[] };
  'security.prepare': SecurityConfiguration;
  'qa.execute': { changeId: string; scenario: TestScenario };
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
  'infra.scale': { delta: 1 | -1 }; 'infra.balancer': { enabled: boolean };
  'deploy.start': { strategy: 'rolling' | 'restart' };
};
export type ActionType = keyof ActionParameters;
export type SimulatedAction = { [K in ActionType]: {
  version: 1; id: string; companyId: number; type: K; parameters: ActionParameters[K]; source: 'ui' | 'agent' | 'fixture';
  changeId?: string; correlationId?: string; requestedAt?: number;
} }[ActionType];
export type ActionCategory = 'artifact' | 'preparation' | 'qa' | 'finance' | 'operation' | 'publication' | 'administration';
const entry = (roles: (Role | 'operator')[], category: ActionCategory) => ({ roles, category, version: ACTION_VERSION });
/** Shared by the existing UI, structured adapter and future provider. */
export const ACTION_CATALOG = {
  'module.create': entry(['backend'], 'artifact'), 'module.revise': entry(['backend'], 'artifact'),
  'security.prepare': entry(['security'], 'preparation'), 'qa.execute': entry(['qa'], 'qa'),
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
  'room.start': entry(['operator'], 'administration'), 'room.pause': entry(['operator'], 'administration'),
  'room.reset': entry(['operator'], 'administration'), 'room.speed': entry(['operator'], 'administration'), 'room.finish': entry(['operator'], 'administration'),
} as const;
export function allowedAction(type: string, role: Role | 'operator') {
  return Object.hasOwn(ACTION_CATALOG, type) && (ACTION_CATALOG[type as keyof typeof ACTION_CATALOG].roles as readonly string[]).includes(role);
}
