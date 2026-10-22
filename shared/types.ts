import type { CrisisState, ObservabilityState, ServiceMode, SlackState, SlackMessage } from './observability.js';
import type { BlockConfiguration } from './blocks.js';
import type { LobbyState, LobbyView } from './lobby.js';
import type { ActionState, TestEvidence, DefectCode, OperationRuntime, CompanyRuntime, ExecutionRelease, ModuleRef, OperationsView, TestJob } from './simulation.js';
export const ROLES = ['backend', 'security', 'qa', 'cto', 'devops', 'product'] as const;
export type Role = typeof ROLES[number];
export type Identity = { id: string; role: Role | 'operator'; companyId: number | null };
export type Domain = 'backend' | 'security' | 'product';
export type ChangeStatus = 'SECURITY_PENDING' | 'QA_PENDING' | 'QA_RUNNING' | 'QA_REJECTED' | 'CTO_PENDING' | 'CTO_REJECTED' | 'AUTHORIZED' | 'DEPLOYING' | 'DEPLOYED' | 'DEPLOY_FAILED' | 'EXPIRED' | 'STALE';
export type GraphNode = { id: string; type: string; position: { x: number; y: number }; data: { label: string; value?: number; module?: ModuleRef; config?: BlockConfiguration } };
export type GraphEdge = { id: string; source: string; target: string };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type RequestStatus = 'PENDING' | 'RUNNING' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'ABANDONED' | 'FAILED';
export type RequestStage = 'entry' | 'security' | 'web' | 'checkout' | 'inventory' | 'payment' | 'exit';
export type ServiceId = 'security' | 'web' | 'checkout' | 'inventory' | 'payment';
export type TerminalReason = 'OK' | 'OUT_OF_STOCK' | 'CONFLICT' | 'SECURITY_REJECTED' | 'UNSUPPORTED_BLOCK' | 'INVALID_FLOW' | 'DEADLINE' | 'QUEUE_FULL' | 'ROOM_FINISHED' | 'ROOM_INTERRUPTED' | 'COMPANY_ELIMINATED' | 'MAINTENANCE' | 'ORDERS_PAUSED';
export const TERMINAL_LABELS: Record<TerminalReason, string> = { MAINTENANCE: 'Mantenimiento · 503', ORDERS_PAUSED: 'Operaciones suspendidas · 503', OK: 'OK', OUT_OF_STOCK: 'Sin stock', CONFLICT: 'Conflicto', SECURITY_REJECTED: 'Seguridad', UNSUPPORTED_BLOCK: 'No ejecutable', INVALID_FLOW: 'Flujo inválido', DEADLINE: 'Vencida', QUEUE_FULL: 'Cola llena', ROOM_INTERRUPTED: 'Partida interrumpida', ROOM_FINISHED: 'Fin de sala', COMPANY_ELIMINATED: 'Empresa cerrada' };
export type RequestResult = { defectLoss?: { amount: number; evidence: string[] }; status: 'COMPLETED' | 'REJECTED' | 'ABANDONED' | 'FAILED'; reason: TerminalReason; at: number; revenue: number; lostRevenue: number; capitalDelta: number; service?: ServiceId; operation?: string };
export type RequestJourney = { from: RequestStage; to: RequestStage; at: number; duration: number };
export type PurchaseRequest = {
  promotion?: { percent: number; audience: 'all' | 'new' }; promotionApplied?: boolean; recoveryRetry?: boolean; duplicateBusiness?: boolean; lockKeys?: string[]; queueKeys?: string[]; acquireAt?: number; retryPolicy?: { maxAttempts: number; delayMs: number }; transportFailures?: number; retryingPayment?: boolean; idempotentUntil?: number; cachedRead?: { stock: number; version: number }; invalidateCache?: boolean; executor?: 'requests-1' | 'requests-4a'; effectCodes?: DefectCode[]; loadDepth?: number; delayedNodes?: string[]; deferUntil?: number; discountApplied?: boolean; releaseOnInterrupt?: boolean; reservationSettled?: boolean;
  contractPrice?: number; execution?: ExecutionRelease; newCustomer?: boolean; couponCount?: number; invalidInput?: boolean; price?: number; duplicates?: number; retryCount?: number; waitOperation?: boolean;
  id: string; intentId?: string; customerId?: string; customerSource?: 'market' | 'qa' | 'legacy'; customerColor?: string; executionVersion: number; path: GraphNode[]; securityAllowed: boolean; commercial?: boolean;
  arrivalAt: number; nextAt: number; deadline: number; cursor: number; status: RequestStatus;
  read?: { stock: number; version: number }; atomic: boolean; quantity: number;
  committed: number; oversold: number; paid: boolean; result?: RequestResult; accounted: boolean;
  journey: RequestJourney;
};
export type ScenarioContext = { backend: Graph; security: Graph; executionVersion: number; execution?: ExecutionRelease };
export type ConcurrencyRun = { operationsState?: OperationRuntime;
  id: string; engineVersion: 'requests-1' | 'requests-4a'; fixture: 'last-unit-1'; startedAt: number;
  backendHash: string; securityHash: string;
  inventory: { sku: 'LAST-UNIT'; initialStock: number; stock: number; version: number; committed: number; oversold: number };
  requests: PurchaseRequest[];
  operations: { requestId: string; nodeId: string; type: string; at: number; stock: number; version: number }[];
};
export type ScenarioTotals = { generated: number; completed: number; rejected: number; abandoned: number; failed: number; committed: number; oversold: number; revenue: number; lostRevenue: number; capitalDelta: number };
export type ConcurrencyState = { nextAt: number; sequence: number; totals: ScenarioTotals; run?: ConcurrencyRun; reportedRunId?: string };
export type ConcurrencyView = { runId?: string; inventory?: ConcurrencyRun['inventory']; totals: ScenarioTotals };
export type InventoryState = Omit<ConcurrencyRun['inventory'], 'sku'> & { sku: 'REGULAR' | 'LAST-UNIT'; supplied?: number };
export type QueueVisit = { service: ServiceId; enteredAt: number; exitedAt?: number; position: number; exit?: 'SERVICE' | 'DEADLINE' | 'CANCELLED' };
export type TrafficRequest = PurchaseRequest & {
  companyId: number; customerId?: string; type: 'browse' | 'query' | 'purchase'; trafficClass: 'legitimate' | 'malicious';
  attackKind?: 'forged' | 'injection' | 'bot'; attempt: number; admittedAt?: number; startedAt?: number; finishedAt?: number; latencyMs?: number;
  queueEnteredAt?: number; queueExitedAt?: number; waits: QueueVisit[]; service: ServiceId; stage: RequestStage;
  phase: 'security' | 'web' | 'checkout' | 'backend'; transaction: 'NONE' | 'RESERVED' | 'CONFIRMED' | 'PENDING_RESOLUTION'; breach: boolean;
  trace: { type: string; at: number; stock?: number; version?: number }[];
};
export type ServiceQueue = { id: ServiceId; capacity: number; waiting: string[]; processing: string[]; credit: number; rate: number; started: number; offered: number };
export type TrafficScenario = {
  version: 'traffic-2.0'; restockPerSecond: number; quality: { healthyLatencyMs: number; latencyCeilingMs: number }; patience: Record<TrafficRequest['type'], number>; rates: Record<ServiceId, number>;
  queues: Record<ServiceId, number>; delays: Record<ServiceId, number>; window: number; retention: number;
};
export type TrafficReceipt = Omit<TrafficRequest, 'path'> & { path: { id: string; type: string; value?: number }[] };
export type TrafficMetrics = { legitimateTerminated: number; errors: number; rejected: number; abandoned: number; failed: number; latencyMs: number | null; errorRate: number; utilization: number; unavailable: number; fraudRate: number };
export type TrafficState = { funnel?: import('./product.js').FunnelState; operations?: OperationRuntime;
  scope?: 'qa'; namespace: string; seed: number; config: TrafficScenario; sequence: number; initialIssued: boolean; initialDebt: number;
  arrivalRemainder: number; attackRemainder: number; attackSequence: number; lastTick: number;
  inventory: InventoryState; paths: Record<number, GraphNode[]>; services: Record<ServiceId, ServiceQueue>; requests: Record<string, TrafficRequest>;
  totals: ScenarioTotals; legitimate: ScenarioTotals; malicious: ScenarioTotals; metrics: TrafficMetrics;
  observations: { at: number; legitimate: boolean; status: RequestResult['status']; latency: number; breach: boolean; oversold: number }[];
  capacityWindow: { at: number; dt: number; utilization: number; unavailable: number }[];
  outbox: TrafficReceipt[]; legacyMetrics?: { active: number; queue: number; latency: number; utilization: number }; unresolvedCount: number;
};
export type TrafficView = { scenario: string; totals: ScenarioTotals; legitimate?: ScenarioTotals; malicious?: ScenarioTotals; metrics: Omit<TrafficMetrics,'fraudRate'> & {fraudRate?:number}; inventory: InventoryState; queues: { id: ServiceId; capacity: number; depth: number; processing: number; rate: number }[]; pendingResolution: number };
export type ScenarioEvidence = { engineVersion: string; fixture: string; backendHash: string; securityHash: string; executionVersion: number; seed: number; inventory: ConcurrencyRun['inventory']; outcomes: { requestId: string; status: RequestStatus; reason: TerminalReason; read?: PurchaseRequest['read']; committed: number; oversold: number }[] };
export type Report = { securityOutcomes?: { attempts:number; blocked:number; successful:number; legitimateRejected:number }; testEvidence?: TestEvidence; suite: string; requests: number; completed: number; rejected: number; oversold: number; breaches: number; duplicates: number; latency: number; tick: number; abandoned?: number; failed?: number; evidence?: ScenarioEvidence; obsolete?: boolean; loadEvidence?: { engineVersion: string; fixture: string; seed: number; maxQueue: number; pending: number } };
export type Change = { product?: { draftId: string; catalogId: string; configuration: import('./actions.js').CampaignConfiguration }; releasedVersion?:number; qaRunId?:string; parentChangeId?:string; implementation?: import('./collaboration.js').SharedImplementation; artifactRefs?: ModuleRef[]; testJob?: TestJob; id: string; companyId: number; domain: Domain; name: string; graph: Graph; status: ChangeStatus; cost: number; reserved: number; baseVersion: number; created: number; reports: Report[]; runningSuite?: string; due?: number; strategy?: string; expires?: number; actorId: string; context?: ScenarioContext; qaScenario?: ConcurrencyRun; qaLoad?: { company: Company; startedAt: number; elapsed: number; maxQueue: number; latencySum: number; terminated: number } };
export type Migration = { id: string; from: number | null; to: number | null; count: number; at: number; color: string; customerId: string; reason: string };
export type CustomerMigration = { id: string; from: number | null; to: number | null; at: number; reason: string; color: string };
export type MarketCustomer = {
  readonly id: string; readonly cohort: number; readonly originCompanyId: number | null; currentCompanyId: number | null; readonly imported: boolean;
  loyalty: number; visualColor: string; transitionFromColor: string;
  previousCompanyId?: number | null; lastMigrationTick?: number; lastSuccessfulVisitTick?: number; lastFailedVisitTick?: number;
  successfulVisits: number; failedVisits: number; abandonedRequests: number; dissatisfaction: number; consecutiveFailures: number;
  activeRequests: number; history: CustomerMigration[];
  experiences: Record<number, { successes: number; failures: number }>;
  pendingMigration?: { targetCompanyId: number | null; reason: string; requestedAt: number };
};
export type MarketConfig = {
  version: 'market-3.0'; population: 5000; hazardPerSecond: number; cooldownSeconds: number; reentryPerSecond: number;
  successGain: Record<TrafficRequest['type'], number>; failureLoss: Record<TrafficRequest['type'], number>;
  severeLoss: number; slowLoss: number; satisfactoryLatencyMs: Record<TrafficRequest['type'], number>; minimumAttractiveness: number;
};
export type MarketState = {
  config: MarketConfig; customers: Record<string, MarketCustomer>; members: Record<string, string[]>;
  selection: Record<number, number>; pendingIds: string[]; sequence: number; lastDecisionTick: number;
  totals: { migrations: number; exits: number; returns: number; experiences: number }; importedAt?: number; legacyAggregateMigrations?: Omit<Migration, 'customerId' | 'reason'>[];
};
export type GameEvent = { id: number; at: number; companyId: number | null; text: string; tone: 'good' | 'bad' | 'neutral'; category: string };
export type FlowParticle = { id: string; born: number; duration: number; color: string; customerId?: string; kind: 'success' | 'error' | 'attack'; route: 'browse' | 'purchase' | 'query'; seed: number; requestId?: string; companyId?: number; executionVersion?: number; status?: RequestStatus; reason?: TerminalReason; finishedAt?: number; journey?: RequestJourney; queue?: { service: ServiceId; position: number; enteredAt: number; depth: number } };
export type Infrastructure = { instances: { id: number; status: 'UP' | 'RESTARTING' | 'STOPPED'; readyAt?: number }[]; stoppedServices: ServiceId[] };
export type Company = {
  crisis: CrisisState; serviceMode: { mode: ServiceMode; since: number };
  runtime: CompanyRuntime; infrastructure: Infrastructure;
  id: number; name: string; tag: string; color: string; customers: number; capital: number; reputation: number; pressure: number;
  servers: number; balancer: boolean; infraBudget: number; reserved: number; version: number; deployments: number;
  active: number; requests: number; successes: number; errors: number; breaches: number; oversold: number; duplicates: number;
  lostRevenue: number; revenue: number; latency: number; utilization: number; queue: number; migratedIn: number; migratedOut: number;
  eliminated: boolean; eliminatedAt?: number; crisisTicks: number; deadTicks: number; bankruptTicks: number; concurrencyUntil: number;
  backend: Graph; security: Graph; product: Graph; particles: FlowParticle[];
  drafts: Partial<Record<Domain, { graph: Graph; revision: number }>>;
  migrationRemainder: number; arrivalRemainder: number; processedRemainder: number; history: number[]; stock: number;
  concurrency: ConcurrencyState;
  traffic: TrafficState;
};
export type PrivateCompany = Omit<Company, 'drafts' | 'traffic' | 'runtime' | 'breaches'> & { breaches?:number; drafts: Company['drafts']; traffic: TrafficView };
export type PublicCompany = Omit<Company, 'infraBudget' | 'reserved' | 'breaches' | 'runtime' | 'drafts' | 'backend' | 'security' | 'product' | 'migrationRemainder' | 'arrivalRemainder' | 'processedRemainder' | 'crisisTicks' | 'deadTicks' | 'bankruptTicks' | 'concurrencyUntil' | 'concurrency' | 'traffic'> & { infraBudget?:number; reserved?:number; breaches?:number; modules: string[]; pipelineCounts: number[]; concurrency: ConcurrencyView; traffic: TrafficView };
export type HistoricalClosure = { generation: number; tick: number; previousStatus: string; reason: 'TEACHER_RESET' | 'LEGACY_UNCLOSED'; actor: Identity | null; receivedAt: number | null };
export type GameState = { lobby?: LobbyState; productEnabled?: boolean; dvrEnabled: boolean; closure?: HistoricalClosure; actions: ActionState; schema: 6; observability: ObservabilityState; slack: SlackState; market: MarketState; generation: number; tick: number; duration: number; status: 'LOBBY' | 'RUNNING' | 'PAUSED' | 'FINISHED' | 'ABORTED'; seed: number; eventSeq: number; companies: Company[]; changes: Change[]; events: GameEvent[]; migrations: Migration[]; unserved: number; speed: number };
export type Snapshot = { lobby?: LobbyView; productEnabled?: boolean; dvrEnabled?: boolean; generation: number; slack?: SlackMessage[]; operations?: OperationsView; tick: number; duration: number; status: GameState['status']; companies: PublicCompany[]; events: GameEvent[]; migrations: Migration[]; unserved: number; identity: Identity | null; privateCompany?: PrivateCompany; changes: Change[]; speed: number };
export type Command = { id: string; type: string; companyId?: number; changeId?: string; payload?: Record<string, unknown> };
export type Result = { refs?: string[]; ok: boolean; error?: string; code?: string };

export const ROLE_LABELS: Record<Role | 'operator', string> = { backend: 'Backend', security: 'Seguridad', qa: 'QA', cto: 'CTO', devops: 'DevOps / SRE', product: 'Producto / UX', operator: 'Control de partida' };
export const BLOCKS: Record<'backend' | 'security', { type: string; label: string; cost: number; value: number; unit: string }[]> = {
  backend: [
    { type: 'validation', label: 'Stock Validation', cost: 50, value: 1, unit: 'unidades' },
    { type: 'atomic', label: 'Atomic Update', cost: 180, value: 1, unit: 'unidades' },
    { type: 'lock', label: 'Lock', cost: 120, value: 1000, unit: 'ms · TTL' },
    { type: 'retry', label: 'Retry', cost: 60, value: 2, unit: 'intentos' },
    { type: 'queue', label: 'Queue', cost: 100, value: 40, unit: 'solicitudes' },
    { type: 'idempotency', label: 'Idempotency', cost: 150, value: 60, unit: 's · TTL' },
    { type: 'cache', label: 'Cache', cost: 90, value: 5, unit: 's · TTL' },
  ],
  security: [
    { type: 'auth', label: 'Auth', cost: 120, value: 1, unit: 'checkout protegido' },
    { type: 'role', label: 'Role Check', cost: 90, value: 1, unit: 'rol requerido' },
    { type: 'rate', label: 'Rate Limit', cost: 100, value: 12, unit: 'solicitudes/s · IP' },
    { type: 'waf', label: 'WAF', cost: 180, value: 2, unit: 'reglas activas' },
    { type: 'ip', label: 'IP Block', cost: 50, value: 1, unit: 'orígenes bloqueados' },
    { type: 'bot', label: 'Bot Detection', cost: 160, value: 65, unit: '% · umbral' },
  ],
};
export const SUITES = ['Concurrencia', 'Regresión', 'Carga', 'Seguridad', 'Integración', 'Unitarias'];
export const STATUS_LABELS: Record<ChangeStatus, string> = { SECURITY_PENDING: 'En Seguridad', QA_PENDING: 'En QA', QA_RUNNING: 'Prueba en curso', QA_REJECTED: 'Rechazado por QA', CTO_PENDING: 'Pendiente de CTO', CTO_REJECTED: 'Rechazado por CTO', AUTHORIZED: 'Autorizado', DEPLOYING: 'Desplegando', DEPLOYED: 'En producción', DEPLOY_FAILED: 'Deploy fallido', EXPIRED: 'Autorización vencida', STALE: 'Base modificada' };
