import type { ModuleConfiguration, SecurityConfiguration, CampaignConfiguration, TestScenario } from './actions.js';
import type { Company, ConcurrencyRun, TrafficReceipt, Graph, Identity, PurchaseRequest, Report } from './types.js';

export type DefectCode = 'D01' | 'D02' | 'D03' | 'D04' | 'D05' | 'D06' | 'D07' | 'D08';
export type SimulatedDefect = { id: string; code: DefectCode; severity: 'medium' | 'high' | 'critical'; profile: 'defects-1'; artifactId: string; version: number };
export type ModuleRef = { id: string; version: number };
export type ModuleVersion = ModuleRef & { companyId: number; name: string; configuration: ModuleConfiguration; dependencies: ModuleRef[]; defects: SimulatedDefect[]; profile: 'defects-1'; createdBy: string; createdAt: number; changeId: string; graph: Graph };
/** Secret execution bundle, shared by requests of a release; never projected. */
export type ExecutionRelease = { modules: ModuleVersion[]; security?: SecurityConfiguration };
export type Campaign = { id: string; configuration: CampaignConfiguration; status: 'PROPOSED' | 'AUTHORIZED' | 'ACTIVE' | 'COMPLETED' | 'REJECTED' | 'EXPIRED'; createdBy: string; createdAt: number; reserved: number; expires?: number; activatedAt?: number; endsAt?: number; authorizedBy?: string };
export type OperationRuntime = {
  payments: Record<string, { until: number; owner: string }>;
  locks: Record<string, { owner: string; until: number }>;
  queues: Record<string, string[]>;
  intents: Record<string, { until: number; owner: string }>;
  cache: Record<string, { until: number; stock: number; version: number }>;
  counters: { lockWaits: number; cacheHits: number; cacheMisses: number; retries: number; duplicates: number; activations: Partial<Record<DefectCode, number>> };
};
export type CompanyRuntime = { modules: Record<string, ModuleVersion[]>; releases: Record<number, ExecutionRelease>; campaigns: Campaign[]; proposals: { id: string; name: string; description: string; at: number }[]; priority: 'security' | 'concurrency'; rateBuckets: Record<string, { start: number; count: number }>; operations: OperationRuntime };
export type TestEvidence = { input: TestScenario; expected: { revenue: number; maxCommitted: number; accepted: number }; observed: { revenue: number; committed: number; accepted: number; duplicates: number; pendingReservations: number }; passed: boolean; outcomes: { id: string; status: string; revenue: number; committed: number; price: number; attempts: number }[]; graphHash: string; elapsed: number };
export type TestJob = { run?: ConcurrencyRun; finished?: TrafficReceipt[]; scenario: TestScenario; staging: Company; elapsed: number; next: number; requests: PurchaseRequest[]; evidence?: TestEvidence; reports: Report[] };
export type Employee = { id: string; companyId: number; role: Identity['role']; status: 'ACTIVE' | 'EXPELLED'; violations: { commandId: string; at: number; reason: 'OUT_OF_ROLE' | 'CROSS_COMPANY' | 'OUT_OF_SCOPE'; action: string; policy: 'discipline-1'; reversed?: boolean }[]; expelledAt?: number };
export type ActionAudit = { id: string; commandId: string; actorId: string; companyId: number | null; role: Identity['role']; type: string; at: number; version: 1; ok: boolean; code?: string; category: string; source: 'ui' | 'agent' | 'fixture'; correlationId?: string; refs: string[]; effects: string[] };
export type ActionState = { employees: Record<string, Employee>; audit: ActionAudit[]; receipts: Record<string, { digest: string; result: { ok: boolean; error?: string; code?: string; refs?: string[] } }>; sequence: number };
export type ModuleView = Omit<ModuleVersion, 'defects' | 'profile' | 'graph'>;
export type OperationsView = { protection?: SecurityConfiguration; modules: ModuleView[]; campaigns: Campaign[]; employees: Employee[]; audit: ActionAudit[]; priority: CompanyRuntime['priority']; proposals: CompanyRuntime['proposals'] };
