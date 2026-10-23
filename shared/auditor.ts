import type { ProtectionRule } from './collaboration.js';

/**
 * External auditor ("Auditor externo"): players left in the reserve after the draw. An auditor picks a company,
 * looks at the modules of its production release and runs a "prueba de control" against one control pendiente.
 * The company then receives simulated anomalous traffic of that category and the engine decides what is contained.
 */
export const AUDIT_PROBE = { durationSeconds: 30, cooldownSeconds: 60, requests: 30, perCompany: 2 } as const;

/**
 * A confirmed hole is a leak, not an event: finding it costs a one-time fine, and leaving it open keeps costing
 * while the anomalous traffic the engine already generates walks through it. The damage grows on its own because
 * that traffic grows during the game.
 */
export const AUDIT_LEAK = { fine: 250, costPerRequest: 1, reputationPerRequest: 0.02 } as const;
/**
 * The acute burst on top of the leak. The two shares are what keeps it non-lethal by construction: the auditor's
 * traffic never exceeds a third of the company's web capacity, and none is admitted once the target queue is
 * two thirds full, so legitimate customers always have room.
 */
export const AUDIT_SUSTAIN = { durationSeconds: 60, cooldownSeconds: 120, rateShare: 1 / 3, queueShare: 2 / 3, perCompany: 1 } as const;

export const RULE_LABELS: Record<ProtectionRule['kind'], string> = { authenticated: 'Auth', owner: 'Role Check', input: 'WAF', bot: 'Bot Detection', origin: 'IP Block', rate: 'Rate Limit' };

/** Anomalous request categories already modeled by the engine (server/security.ts admitSecurity). */
export type AnomalyCategory = 'forged' | 'injection' | 'bot';
export const CATEGORY_LABELS: Record<AnomalyCategory, string> = { forged: 'Identidad no verificada', injection: 'Entrada inválida', bot: 'Solicitudes automatizadas' };

/** Controls an auditor can find pending on a production module; IP Block targets a single origin and is not listed. */
export const CONTROL_CHECKS = ['auth', 'role_check', 'waf', 'bot_detection', 'rate_limit'] as const;
export type ControlCheck = typeof CONTROL_CHECKS[number];
export const CONTROL_CHECK_INFO: Record<ControlCheck, { control: string; rule: ProtectionRule['kind']; category: AnomalyCategory; pending: string }> = {
  auth: { control: 'Auth', rule: 'authenticated', category: 'forged', pending: 'Este módulo no verifica la sesión del cliente.' },
  role_check: { control: 'Role Check', rule: 'owner', category: 'forged', pending: 'Este módulo no comprueba que la compra sea de quien la pide.' },
  waf: { control: 'WAF', rule: 'input', category: 'injection', pending: 'Este módulo no tiene validación de entrada.' },
  bot_detection: { control: 'Bot Detection', rule: 'bot', category: 'bot', pending: 'Este módulo no distingue solicitudes automatizadas.' },
  rate_limit: { control: 'Rate Limit', rule: 'rate', category: 'bot', pending: 'Este módulo no limita la cantidad de solicitudes.' },
};

/** Where the simulated anomalous traffic of a probe is stopped, so the auditor sees which control acted and where. */
export type ProbeStop = { scope: 'module' | 'block' | 'release' | 'legacy'; rule?: ProtectionRule['kind']; nodeId?: string; label?: string };
/**
 * What happens to the company's system under one prueba de control. `contained` stop at admission; the rest enter
 * the production path and are followed to their outcome by the engine (never a model opinion):
 * - `breached`: reached Write Stock and caused an indebido access (the company records a SECURITY BREACH);
 * - `served`: completed a purchase as if legitimate; `rejectedLater`/`abandoned`: stopped or timed out downstream.
 */
export type AuditProbe = {
  id: string; auditorId: string; companyId: number; nodeId: string; module: string; check: ControlCheck; category: AnomalyCategory;
  startedAt: number; endsAt: number; finished: boolean;
  sent: number; contained: number; notContained: number; unserved: number;
  breached: number; served: number; rejectedLater: number; abandoned: number; settled: number;
  stop?: ProbeStop; reach?: 'security' | 'web' | 'checkout' | 'write';
};
/**
 * A control the auditor proved is not containing anything, on one module of one company. `uncontained` and `lost`
 * accumulate while it stays open; `closedAt` is set when the control stops being pending in production.
 */
export type AuditFinding = {
  id: string; companyId: number; nodeId: string; module: string; check: ControlCheck; category: AnomalyCategory;
  openedAt: number; closedAt?: number; fine: number; uncontained: number; lost: number;
  /** Open window of a sustained control test, and when the last one ended (for the cooldown). */
  /** `credit`/`at`: admission allowance earned tick by tick, so a capacity change can never discharge a backlog at once. */
  sustain?: { startedAt: number; endsAt: number; sent: number; credit: number; at: number }; sustainedAt?: number;
};
export type AuditorState = { sequence: number; probes: AuditProbe[]; findings: AuditFinding[] };

export type PendingControl = { check: ControlCheck; control: string; text: string; category: AnomalyCategory };
export type AuditModule = { nodeId: string; label: string; module: boolean; pending: PendingControl[] };
/** `assembling`: the company is still building its plan and does not accept purchases yet, so it has
 * nothing to audit. A company becomes auditable exactly when it closes its montaje. */
export type AuditCompany = { companyId: number; name: string; color: string; version: number; eliminated: boolean; assembling: boolean; modules: AuditModule[] };
/** A probe plus the server-composed narrative of what its traffic is doing to the company's system. */
export type AuditProbeView = Omit<AuditProbe, 'auditorId'> & { summary: string[] };
/** Everything an auditor sees: production modules with their pending controls and the auditor's own probes. */
export type AuditorView = {
  /** `opensAt`: end of the calm start, while pruebas de control are not yet allowed (shared/pacing.ts). */
  companies: AuditCompany[]; probes: AuditProbeView[]; nextAt: number; opensAt?: number;
  limits: { durationSeconds: number; cooldownSeconds: number; requests: number };
};
