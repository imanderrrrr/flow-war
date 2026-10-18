export const ROLES = ['backend', 'security', 'qa', 'cto', 'devops', 'product'] as const;
export type Role = typeof ROLES[number];
export type Identity = { id: string; role: Role | 'operator'; companyId: number | null };
export type Domain = 'backend' | 'security' | 'product';
export type ChangeStatus = 'QA_PENDING' | 'QA_RUNNING' | 'QA_REJECTED' | 'CTO_PENDING' | 'CTO_REJECTED' | 'AUTHORIZED' | 'DEPLOYING' | 'DEPLOYED' | 'DEPLOY_FAILED' | 'EXPIRED' | 'STALE';
export type GraphNode = { id: string; type: string; position: { x: number; y: number }; data: { label: string; value?: number } };
export type GraphEdge = { id: string; source: string; target: string };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type Report = { suite: string; requests: number; completed: number; rejected: number; oversold: number; breaches: number; duplicates: number; latency: number; tick: number };
export type Change = { id: string; companyId: number; domain: Domain; name: string; graph: Graph; status: ChangeStatus; cost: number; reserved: number; baseVersion: number; created: number; reports: Report[]; runningSuite?: string; due?: number; strategy?: string; expires?: number; actorId: string };
export type Migration = { id: string; from: number; to: number; count: number; at: number; color: string };
export type GameEvent = { id: number; at: number; companyId: number | null; text: string; tone: 'good' | 'bad' | 'neutral'; category: string };
export type FlowParticle = { id: string; born: number; duration: number; color: string; kind: 'success' | 'error' | 'attack'; route: 'browse' | 'purchase'; seed: number };
export type Company = {
  id: number; name: string; tag: string; color: string; customers: number; capital: number; reputation: number; pressure: number;
  servers: number; balancer: boolean; infraBudget: number; reserved: number; version: number; deployments: number;
  active: number; requests: number; successes: number; errors: number; breaches: number; oversold: number; duplicates: number;
  lostRevenue: number; revenue: number; latency: number; utilization: number; queue: number; migratedIn: number; migratedOut: number;
  eliminated: boolean; eliminatedAt?: number; crisisTicks: number; deadTicks: number; bankruptTicks: number; concurrencyUntil: number;
  backend: Graph; security: Graph; product: Graph; particles: FlowParticle[];
  drafts: Partial<Record<Domain, { graph: Graph; revision: number }>>;
  migrationRemainder: number; arrivalRemainder: number; processedRemainder: number; history: number[]; stock: number;
};
export type PrivateCompany = Omit<Company, 'drafts'> & { drafts: Company['drafts'] };
export type PublicCompany = Omit<Company, 'drafts' | 'backend' | 'security' | 'product' | 'migrationRemainder' | 'arrivalRemainder' | 'processedRemainder' | 'crisisTicks' | 'deadTicks' | 'bankruptTicks' | 'concurrencyUntil'> & { modules: string[]; pipelineCounts: number[] };
export type GameState = { schema: 1; tick: number; duration: number; status: 'LOBBY' | 'RUNNING' | 'PAUSED' | 'FINISHED'; seed: number; eventSeq: number; companies: Company[]; changes: Change[]; events: GameEvent[]; migrations: Migration[]; unserved: number; speed: number };
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
