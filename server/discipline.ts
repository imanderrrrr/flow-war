import { createHash } from 'node:crypto';
import { ROLES, type Identity, type GameState, type Command, type Result } from '../shared/types.js';
import { ACTION_CATALOG, allowedAction } from '../shared/actions.js';
import type { ActionState, Employee, ActionAudit } from '../shared/simulation.js';
import { parseAction, ActionError, validateParameters } from './action-validation.js';

export function initialActionState(): ActionState {
  const employees: Record<string, Employee> = {};
  for (let companyId = 0; companyId < 5; companyId++) for (const role of ROLES) { const id = `${companyId}-${role}`; employees[id] = { id, companyId, role, status: 'ACTIVE', violations: [] }; }
  return { employees, audit: [], receipts: {}, sequence: 0 };
}
export function employeeFor(g: GameState, identity: Identity): Employee | undefined {
  if (identity.role === 'operator') return undefined;
  return g.actions.employees[identity.id] ?? Object.values(g.actions.employees).find(e => e.companyId === identity.companyId && e.role === identity.role);
}
export function stableDigest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string,unknown>)[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function confirmViolation(g: GameState, employee: Employee, command: Command, reason: Employee['violations'][number]['reason']) {
  if (employee.status === 'EXPELLED' || employee.violations.some(v => v.commandId === command.id)) return;
  employee.violations.push({ commandId: command.id, at: g.tick, reason, action: command.type, policy: 'discipline-1' });
  if (employee.violations.filter(v => !v.reversed).length === 5) { employee.status = 'EXPELLED'; employee.expelledAt = g.tick; }
}
export function correctEmployee(g: GameState, p: Record<string, unknown>): Result {
  validateParameters('employee.correct', p);
  const employee = g.actions.employees[String(p.employeeId)], violation = employee && [...employee.violations].reverse().find(v => !v.reversed);
  if (!employee || !violation) return { ok: false, code: 'INVALID', error: 'No existe infracción corregible.' };
  violation.reversed = true; employee.status = 'ACTIVE'; delete employee.expelledAt;
  return { ok: true, refs: [employee.id, violation.commandId] };
}
export function auditCompletion(g: GameState, companyId: number, type: string, refs: string[], effects: string[]) {
  const id = `A${++g.actions.sequence}`;
  g.actions.audit.push({ id, commandId: id, actorId: 'engine', companyId, role: 'operator', type, at: g.tick, version: 1, ok: true, category: 'completion', source: 'ui', refs, effects });
}
export function dispatchCommand(g: GameState, identity: Identity | null, raw: Command, execute: (command: Command) => Result): Result {
  if (!identity || !raw || typeof raw.id !== 'string' || !raw.id || raw.id.length > 100 || typeof raw.type !== 'string') return { ok: false, code: 'FORBIDDEN', error: 'Sesión o comando no autorizado.' };
  let command = raw, source: ActionAudit['source'] = 'ui', correlationId: string | undefined;
  if (raw.type === 'action.execute') {
    try {
      const a = parseAction(raw.payload?.action); source = a.source; correlationId = a.correlationId;
      command = { id: a.id, type: a.type, companyId: a.companyId, changeId: a.changeId, payload: a.parameters };
    } catch (e) { return { ok: false, code: e instanceof ActionError ? e.code : 'TECHNICAL', error: (e as Error).message }; }
  }
  const employee = employeeFor(g, identity), key = `${employee?.id ?? identity.id}:${command.id}`, digest = stableDigest(command), prior = g.actions.receipts[key];
  if (prior) return prior.digest === digest ? structuredClone(prior.result) : { ok: false, code: 'ID_CONFLICT', error: 'ID de comando ya utilizado.' };
  if (employee?.status === 'EXPELLED') return { ok: false, code: 'EXPELLED', error: 'Empleado expulsado. Puesto vacante.' };
  if (identity.role !== 'operator' && (!employee || employee.role !== identity.role || employee.companyId !== identity.companyId)) return { ok: false, code: 'FORBIDDEN', error: 'Identidad no válida.' };
  if (g.actions.audit.length >= 12000 && command.type !== 'room.reset') return { ok: false, code: 'LIMIT', error: 'Límite de órdenes de la partida alcanzado.' };
  let result: Result;
  const company = identity.companyId == null ? undefined : g.companies[identity.companyId];
  const before = company && { capital: company.capital, servers: company.servers, reserved: company.reserved, infraBudget: company.infraBudget, version: company.version };
  const strikesBefore = employee?.violations.filter(v => !v.reversed).length ?? 0;
  const catalog = Object.hasOwn(ACTION_CATALOG, command.type) ? ACTION_CATALOG[command.type as keyof typeof ACTION_CATALOG] : undefined;
  if (!catalog) result = { ok: false, code: 'UNSUPPORTED', error: 'Acción no implementada.' };
  else if (!allowedAction(command.type, identity.role)) {
    if (employee) confirmViolation(g, employee, command, 'OUT_OF_ROLE');
    result = { ok: false, code: 'FORBIDDEN', error: 'Acción ajena al rol.' };
  } else if (identity.role !== 'operator' && command.companyId !== identity.companyId) {
    if (employee) confirmViolation(g, employee, command, 'CROSS_COMPANY');
    result = { ok: false, code: 'FORBIDDEN', error: 'Empresa no autorizada.' };
  } else {
    try { result = execute(command); }
    catch { result = { ok: false, code: 'TECHNICAL', error: 'No se pudo ejecutar la orden.' }; }
  }
  const audit: ActionAudit = { id: `A${++g.actions.sequence}`, commandId: command.id, actorId: identity.id, companyId: identity.companyId, role: identity.role, type: command.type, at: g.tick, version: 1, ok: result.ok, code: result.code, category: catalog?.category ?? 'unsupported', source, correlationId, refs: result.refs ?? (command.changeId ? [command.changeId] : typeof command.payload?.changeId === 'string' ? [command.payload.changeId] : []), effects: result.ok ? [command.type] : [] };
  if (result.ok && company && before) for (const field of ['capital','servers','reserved','infraBudget','version'] as const) if (company[field] !== before[field]) audit.effects.push(`${field}.delta:${company[field] - before[field]}`);
  if (employee && employee.violations.filter(v => !v.reversed).length > strikesBefore) audit.effects.push(`discipline.confirmed:${strikesBefore + 1}/5`, `employee.status:${employee.status}`);
  if (command.type === 'employee.correct' && result.ok) audit.effects.push(`justification:${String(command.payload?.justification)}`);
  g.actions.audit.push(audit); g.actions.receipts[key] = { digest, result: structuredClone(result) };
  return result;
}
