export const ROLES = ['backend', 'security', 'qa', 'cto', 'devops', 'product'] as const;
export type Role = typeof ROLES[number];
export type Identity = { id: string; role: Role | 'operator'; companyId: number | null };
export type Domain = 'backend' | 'security' | 'product';
export type ChangeStatus = 'QA_PENDING' | 'QA_RUNNING' | 'QA_REJECTED' | 'CTO_PENDING' | 'CTO_REJECTED' | 'AUTHORIZED' | 'DEPLOYING' | 'DEPLOYED' | 'DEPLOY_FAILED' | 'EXPIRED' | 'STALE';
export type GraphNode = { id: string; type: string; position: { x: number; y: number }; data: { label: string; value?: number } };
export type GraphEdge = { id: string; source: string; target: string };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type RequestStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'REJECTED' | 'ABANDONED' | 'FAILED';
export type RequestStage = 'entry' | 'security' | 'checkout' | 'inventory' | 'payment' | 'exit';
export type TerminalReason = 'OK' | 'OUT_OF_STOCK' | 'CONFLICT' | 'SECURITY_REJECTED' | 'UNSUPPORTED_BLOCK' | 'INVALID_FLOW' | 'DEADLINE' | 'ROOM_FINISHED' | 'COMPANY_ELIMINATED';
export const TERMINAL_LABELS: Record<TerminalReason, string> = { OK: 'OK', OUT_OF_STOCK: 'Sin stock', CONFLICT: 'Conflicto', SECURITY_REJECTED: 'Seguridad', UNSUPPORTED_BLOCK: 'No ejecutable', INVALID_FLOW: 'Flujo inválido', DEADLINE: 'Vencida', ROOM_FINISHED: 'Fin de sala', COMPANY_ELIMINATED: 'Empresa cerrada' };
export type RequestResult = { status: Exclude<RequestStatus, 'PENDING' | 'RUNNING'>; reason: TerminalReason; at: number; revenue: number; lostRevenue: number; capitalDelta: number };
export type RequestJourney = { from: RequestStage; to: RequestStage; at: number; duration: number };
export type PurchaseRequest = {
  id: string; intentId: string; executionVersion: number; path: GraphNode[]; securityAllowed: boolean;
  arrivalAt: number; nextAt: number; deadline: number; cursor: number; status: RequestStatus;
  read?: { stock: number; version: number }; atomic: boolean; quantity: number;
  committed: number; oversold: number; paid: boolean; result?: RequestResult; accounted: boolean;
  journey: RequestJourney;
};
export type ScenarioContext = { backend: Graph; security: Graph; executionVersion: number };
export type ConcurrencyRun = {
  id: string; engineVersion: 'requests-1'; fixture: 'last-unit-1'; startedAt: number;
  backendHash: string; securityHash: string;
  inventory: { sku: 'LAST-UNIT'; initialStock: number; stock: number; version: number; committed: number; oversold: number };
  requests: PurchaseRequest[];
  operations: { requestId: string; nodeId: string; type: string; at: number; stock: number; version: number }[];
};
export type ScenarioTotals = { generated: number; completed: number; rejected: number; abandoned: number; failed: number; committed: number; oversold: number; revenue: number; lostRevenue: number; capitalDelta: number };
export type ConcurrencyState = { nextAt: number; sequence: number; totals: ScenarioTotals; run?: ConcurrencyRun; reportedRunId?: string };
export type ConcurrencyView = { runId?: string; inventory?: ConcurrencyRun['inventory']; totals: ScenarioTotals };
export type ScenarioEvidence = { engineVersion: string; fixture: string; backendHash: string; securityHash: string; executionVersion: number; seed: number; inventory: ConcurrencyRun['inventory']; outcomes: { requestId: string; status: RequestStatus; reason: TerminalReason; read?: PurchaseRequest['read']; committed: number; oversold: number }[] };
export type Report = { suite: string; requests: number; completed: number; rejected: number; oversold: number; breaches: number; duplicates: number; latency: number; tick: number; abandoned?: number; failed?: number; evidence?: ScenarioEvidence; obsolete?: boolean };
export type Change = { id: string; companyId: number; domain: Domain; name: string; graph: Graph; status: ChangeStatus; cost: number; reserved: number; baseVersion: number; created: number; reports: Report[]; runningSuite?: string; due?: number; strategy?: string; expires?: number; actorId: string; context?: ScenarioContext; qaScenario?: ConcurrencyRun };
export type Migration = { id: string; from: number; to: number; count: number; at: number; color: string };
export type GameEvent = { id: number; at: number; companyId: number | null; text: string; tone: 'good' | 'bad' | 'neutral'; category: string };
export type FlowParticle = { id: string; born: number; duration: number; color: string; kind: 'success' | 'error' | 'attack'; route: 'browse' | 'purchase'; seed: number; requestId?: string; executionVersion?: number; status?: RequestStatus; reason?: TerminalReason; journey?: RequestJourney };
export type Company = {
  id: number; name: string; tag: string; color: string; customers: number; capital: number; reputation: number; pressure: number;
  servers: number; balancer: boolean; infraBudget: number; reserved: number; version: number; deployments: number;
  active: number; requests: number; successes: number; errors: number; breaches: number; oversold: number; duplicates: number;
  lostRevenue: number; revenue: number; latency: number; utilization: number; queue: number; migratedIn: number; migratedOut: number;
  eliminated: boolean; eliminatedAt?: number; crisisTicks: number; deadTicks: number; bankruptTicks: number; concurrencyUntil: number;
  backend: Graph; security: Graph; product: Graph; particles: FlowParticle[];
  drafts: Partial<Record<Domain, { graph: Graph; revision: number }>>;
  migrationRemainder: number; arrivalRemainder: number; processedRemainder: number; history: number[]; stock: number;
  concurrency: ConcurrencyState;
};
export type PrivateCompany = Omit<Company, 'drafts'> & { drafts: Company['drafts'] };
export type PublicCompany = Omit<Company, 'drafts' | 'backend' | 'security' | 'product' | 'migrationRemainder' | 'arrivalRemainder' | 'processedRemainder' | 'crisisTicks' | 'deadTicks' | 'bankruptTicks' | 'concurrencyUntil' | 'concurrency'> & { modules: string[]; pipelineCounts: number[]; concurrency: ConcurrencyView };
export type GameState = { schema: 2; tick: number; duration: number; status: 'LOBBY' | 'RUNNING' | 'PAUSED' | 'FINISHED'; seed: number; eventSeq: number; companies: Company[]; changes: Change[]; events: GameEvent[]; migrations: Migration[]; unserved: number; speed: number };
export type Snapshot = { tick: number; duration: number; status: GameState['status']; companies: PublicCompany[]; events: GameEvent[]; migrations: Migration[]; unserved: number; identity: Identity | null; privateCompany?: PrivateCompany; changes: Change[]; speed: number };
export type Command = { id: string; type: string; companyId?: number; changeId?: string; payload?: Record<string, unknown> };
export type Result = { ok: boolean; error?: string; code?: string };

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
export const SUITES = ['Concurrencia', 'Regresión', 'Carga', 'Seguridad', 'Integración'];
export const STATUS_LABELS: Record<ChangeStatus, string> = { QA_PENDING: 'En QA', QA_RUNNING: 'Prueba en curso', QA_REJECTED: 'Rechazado por QA', CTO_PENDING: 'Pendiente de CTO', CTO_REJECTED: 'Rechazado por CTO', AUTHORIZED: 'Autorizado', DEPLOYING: 'Desplegando', DEPLOYED: 'En producción', DEPLOY_FAILED: 'Deploy fallido', EXPIRED: 'Autorización vencida', STALE: 'Base modificada' };
