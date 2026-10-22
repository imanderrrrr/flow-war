import type { ProtectionRule } from './collaboration.js';

/**
 * External auditor ("Auditor externo"): players left in the reserve after the draw. An auditor picks a company,
 * looks at the modules of its production release and runs a "prueba de control" against one control pendiente.
 * The company then receives simulated anomalous traffic of that category and the engine decides what is contained.
 */
export const AUDIT_PROBE = { durationSeconds: 30, cooldownSeconds: 60, requests: 30, perCompany: 2 } as const;

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
export type AuditorState = { sequence: number; probes: AuditProbe[] };

export type PendingControl = { check: ControlCheck; control: string; text: string; category: AnomalyCategory };
export type AuditModule = { nodeId: string; label: string; module: boolean; pending: PendingControl[] };
export type AuditCompany = { companyId: number; name: string; color: string; version: number; eliminated: boolean; modules: AuditModule[] };
/** A probe plus the server-composed narrative of what its traffic is doing to the company's system. */
export type AuditProbeView = Omit<AuditProbe, 'auditorId'> & { summary: string[] };
/** Everything an auditor sees: production modules with their pending controls and the auditor's own probes. */
export type AuditorView = {
  companies: AuditCompany[]; probes: AuditProbeView[]; nextAt: number;
  limits: { durationSeconds: number; cooldownSeconds: number; requests: number };
};
