import { createHash } from 'node:crypto';
import type { ControlCheck } from '../shared/auditor.js';
import type { DefectCode } from '../shared/simulation.js';
import type { ModuleConfiguration } from '../shared/actions.js';

/**
 * Modules drafted in words with Claude (Backend only). Claude writes a short textual design; the server, never the
 * model, leaves some controles pendientes on the module. The choice is a pure function of the game seed and the
 * design, travels in the `module.design` command payload and is verified again when the command is applied.
 */
export const DESIGN_PROFILE = 'design-1' as const;
/**
 * A drafted module joins the purchase flow as a purchase module: it checks identity and input by itself unless a
 * control is pending. Each pending set maps to a simulated defect the engine already models (admitSecurity).
 */
export const DESIGN_CONFIGURATION: ModuleConfiguration = { kind: 'purchase', idempotent: false };
export const DESIGN_PENDING: readonly (readonly ControlCheck[])[] = [['waf'], ['auth', 'role_check'], ['auth', 'role_check', 'waf']];
export const PENDING_DEFECT: Partial<Record<ControlCheck, DefectCode>> = { auth: 'D05', role_check: 'D05', waf: 'D08' };
export const DESIGN_LIMITS = { name: 40, components: 6, component: 30, summary: 280 } as const;

const key = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function designPending(seed: number, name: string, components: string[]): ControlCheck[] {
  const digest = createHash('sha256').update(JSON.stringify([DESIGN_PROFILE, seed, key(name), components.map(key)])).digest();
  return [...DESIGN_PENDING[digest.readUInt32BE(0) % DESIGN_PENDING.length]];
}
export const pendingDefects = (pending: ControlCheck[]) => [...new Set(pending.map(p => PENDING_DEFECT[p]).filter((d): d is DefectCode => !!d))];
export const samePending = (a: ControlCheck[], b: ControlCheck[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export class DesignError extends Error {}
/** A design is plain words: no code, queries, markup or configuration. */
const CODE = /```|[{}<>;=$\\|]|=>|\b(function|class|import|export|const|let|var|return|select|insert|drop|script|eval|sql|https?)\b/i;
const WORDS = /^[\p{L}\p{N}][\p{L}\p{N} .,'/()-]*$/u;
const clean = (v: unknown) => typeof v === 'string' ? v.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim() : '';
export function sanitizeDesign(input: { nombre: unknown; componentes: unknown; descripcion: unknown }) {
  const name = clean(input.nombre), summary = clean(input.descripcion);
  const components = Array.isArray(input.componentes) ? [...new Set(input.componentes.map(clean).filter(Boolean))] : [];
  if (!name || name.length > DESIGN_LIMITS.name || !WORDS.test(name) || CODE.test(name)) throw new DesignError('nombre');
  if (!components.length || components.length > DESIGN_LIMITS.components || components.some(c => c.length > DESIGN_LIMITS.component || !WORDS.test(c) || CODE.test(c))) throw new DesignError('componentes');
  if (!summary || summary.length > DESIGN_LIMITS.summary || CODE.test(summary)) throw new DesignError('descripcion');
  return { name, components, summary };
}
