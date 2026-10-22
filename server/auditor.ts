import type { Command, Company, GameState, GraphNode, Identity, Result, TrafficRequest } from '../shared/types.js';
import type { ExecutionRelease } from '../shared/simulation.js';
import type { ProtectionRule } from '../shared/collaboration.js';
import { AUDIT_LEAK, AUDIT_PROBE, CATEGORY_LABELS, CONTROL_CHECKS, CONTROL_CHECK_INFO, RULE_LABELS, type AuditCompany, type AuditFinding, type AuditProbe, type AuditProbeView, type AuditorState, type AuditorView, type ControlCheck, type PendingControl, type ProbeStop } from '../shared/auditor.js';
import { route } from './graphs.js';
import { releaseFor } from './artifacts.js';
import { hasDefect } from './defects.js';
import { admitTraffic } from './traffic.js';
import { validateParameters } from './action-validation.js';
import { addSlackMessage } from './flowslack.js';
import type { SecurityVerdict } from './security.js';

type Emit = (g: GameState, companyId: number | null, text: string, tone: 'good' | 'bad' | 'neutral', category: string) => void;
type Kind = ProtectionRule['kind'];
const round = (n: number) => Math.round(n * 1000) / 1000;
/** One request per second of game time: the size of QA's Seguridad suite (30) over the 30 s of the probe. */
const SPACING = AUDIT_PROBE.durationSeconds / AUDIT_PROBE.requests;

export function auditorState(g: GameState): AuditorState {
  const s = g.auditors ??= { sequence: 0, probes: [], findings: [] };
  if (!s.findings) s.findings = [];   // games saved before findings existed
  return s;
}
/** Open findings of a company, for its own Security and CTO panel. Never carries the auditor's identity. */
export function findingsFor(g: GameState, companyId: number): AuditFinding[] {
  return (g.auditors?.findings ?? []).filter(f => f.companyId === companyId);
}

/** The production release, read without storing anything (projections must not write the game). */
function production(c: Company): ExecutionRelease | undefined {
  try { return c.runtime.releases[c.version] ?? releaseFor(c); } catch { return undefined; }
}

/**
 * Controls declared for the whole release: the release-wide configuration or the legacy security graph.
 * Pending is computed from configured controls and public module design only; it never reads hidden simulated
 * defects (D05/D08). Whether an attack is actually contained is revealed by running the probe, like QA's suite.
 */
function releaseWide(c: Company, release: ExecutionRelease): Set<Kind> {
  const covered = new Set<Kind>(), s = release.security;
  if (s) {
    if (s.auth) covered.add('authenticated');
    if (s.authorization) covered.add('owner');
    if (s.waf) covered.add('input'); if (s.botThreshold > 0) covered.add('bot'); if (s.rate) covered.add('rate');
  } else if (!release.blockPolicies) {
    const kinds: Record<string, Kind> = { auth: 'authenticated', role: 'owner', waf: 'input', bot: 'bot', rate: 'rate' };
    for (const n of route(c.security)) if (kinds[n.type]) covered.add(kinds[n.type]);
  }
  return covered;
}
/** A module drafted with Claude declares which controls it covers through its public design; seeded modules reveal nothing. */
function builtIn(release: ExecutionRelease, node: GraphNode): Set<Kind> {
  const ref = node.type === 'module' ? node.data.module : undefined;
  const m = ref && release.modules.find(x => x.id === ref.id && x.version === ref.version);
  if (!m || m.configuration.kind !== 'purchase' || !m.design) return new Set();
  return new Set<Kind>([...(hasDefect(m, 'D05') ? [] : ['authenticated', 'owner'] as Kind[]), ...(hasDefect(m, 'D08') ? [] : ['input'] as Kind[])]);
}
/** Controles pendientes of one production module, from the company's configured controls and public module design. */
export function pendingControls(c: Company, node: GraphNode, release = production(c)): PendingControl[] {
  if (!release) return [];
  const own = new Set(release.blockPolicies?.find(b => b.nodeId === node.id)?.rules.map(r => r.kind) ?? []);
  const wide = releaseWide(c, release), inside = builtIn(release, node);
  return CONTROL_CHECKS.filter(check => { const kind = CONTROL_CHECK_INFO[check].rule; return !own.has(kind) && !wide.has(kind) && !inside.has(kind); })
    .map(check => ({ check, control: CONTROL_CHECK_INFO[check].control, text: CONTROL_CHECK_INFO[check].pending, category: CONTROL_CHECK_INFO[check].category }));
}
/** Module/control view of the five production releases. No money, drafts, changes, defects or people. */
export function auditCompanies(g: GameState): AuditCompany[] {
  return g.companies.map(c => {
    const release = production(c);
    return { companyId: c.id, name: c.name, color: c.color, version: c.version, eliminated: c.eliminated,
      modules: c.eliminated ? [] : route(c.backend).map(node => ({ nodeId: node.id, label: node.data.label, module: node.type === 'module', pending: pendingControls(c, node, release) })) };
  });
}

const own = (g: GameState, auditorId: string) => (g.auditors?.probes ?? []).filter(p => p.auditorId === auditorId);
const label = (c: Company, nodeId?: string) => route(c.backend).find(n => n.id === nodeId)?.data.label;
/** Backend node label of a module artifact, so a verdict on a module reads as the module the auditor sees. */
const moduleLabel = (c: Company, moduleId?: string) => route(c.backend).find(n => n.type === 'module' && n.data.module?.id === moduleId)?.data.label;

const REACH_RANK = { security: 0, web: 1, checkout: 2, write: 3 } as const;
const REACH_TEXT: Record<NonNullable<AuditProbe['reach']>, string> = { security: 'los controles de entrada', web: 'la tienda', checkout: 'el checkout', write: 'Write Stock (el inventario)' };
/** How far a not-contained request reached, from its trace. */
function reachOf(r: TrafficRequest): NonNullable<AuditProbe['reach']> {
  if (r.breach || r.trace.some(t => ['read', 'write', 'atomic', 'validation', 'lock', 'payment', 'module'].includes(t.type))) return 'write';
  if (r.trace.some(t => t.type === 'checkout')) return 'checkout';
  return 'web';
}

/** What a contained request's stop reads as: which control acted and where, even if it is a different block. */
function stopText(c: Company, p: AuditProbe): string {
  const s = p.stop; if (!s) return 'los controles de la empresa lo detienen';
  const rule = s.rule ? RULE_LABELS[s.rule] : 'un control';
  if (s.scope === 'module') return `el módulo ${s.label ?? p.module} verifica ${rule} por su cuenta`;
  if (s.scope === 'block') return s.nodeId && s.nodeId !== p.nodeId
    ? `el control ${rule} configurado en ${s.label ?? 'otro bloque'} lo detiene antes de llegar a ${p.module}`
    : `el control ${rule} configurado en ${p.module} lo detiene`;
  if (s.scope === 'release') return `el control ${rule} de toda la versión lo detiene`;
  return 'la configuración de seguridad de la versión lo detiene';
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** The server composes the whole narrative from engine facts; no model text ever reaches the auditor. */
function summaryFor(g: GameState, p: AuditProbe): string[] {
  const c = g.companies[p.companyId], lines: string[] = [];
  lines.push(`Enviás ${p.sent}/${AUDIT_PROBE.requests} solicitudes de ${CATEGORY_LABELS[p.category].toLowerCase()} al módulo ${p.module} de ${c.name}.`);
  if (p.contained) lines.push(`${plural(p.contained, 'queda contenida', 'quedan contenidas')}: ${stopText(c, p)}.`);
  if (p.notContained) {
    lines.push(`${plural(p.notContained, 'pasa los controles y entra', 'pasan los controles y entran')} al sistema de ${c.name}${p.reach ? `, hasta ${REACH_TEXT[p.reach]}` : ''}.`);
    const parts: string[] = [];
    if (p.breached) parts.push(`${plural(p.breached, 'provoca un acceso indebido', 'provocan accesos indebidos')} en Write Stock (${c.name} registra SECURITY BREACH y pierde reputación)`);
    if (p.served) parts.push(`${plural(p.served, 'completa una compra', 'completan compras')} como si fueran clientes`);
    if (p.rejectedLater) parts.push(`${plural(p.rejectedLater, 'se rechaza', 'se rechazan')} más adelante (sin stock o cola llena)`);
    if (p.abandoned) parts.push(`${plural(p.abandoned, 'se abandona', 'se abandonan')} por tiempo de espera`);
    if (parts.length) lines.push(`De esas, ${parts.join('; ')}.`);
    else if (p.settled < p.notContained) lines.push('Midiendo el efecto en el sistema…');
  }
  if (p.unserved) lines.push(`${plural(p.unserved, 'no llega a entrar', 'no llegan a entrar')}: la empresa está en mantenimiento o con la cola llena.`);
  if (!p.contained && !p.notContained && !p.unserved) lines.push('Esperando las primeras respuestas del sistema…');
  if (p.finished) lines.push(p.breached ? `Resultado: ${c.name} sufre ${plural(p.breached, 'acceso indebido', 'accesos indebidos')} por este control pendiente.`
    : p.notContained ? `Resultado: el tráfico entró pero no provocó accesos indebidos.`
    : `Resultado: ${c.name} contuvo todo el tráfico de esta prueba.`);
  return lines;
}

export function auditorView(g: GameState, auditor: Identity): AuditorView {
  const probes = own(g, auditor.id), last = probes.at(-1);
  const view = probes.slice(-8).reverse().map(({ auditorId: _a, ...p }): AuditProbeView => ({ ...p, summary: summaryFor(g, p as AuditProbe) }));
  return { companies: auditCompanies(g), probes: view, nextAt: last ? round(last.endsAt + AUDIT_PROBE.cooldownSeconds) : 0,
    limits: { durationSeconds: AUDIT_PROBE.durationSeconds, cooldownSeconds: AUDIT_PROBE.cooldownSeconds, requests: AUDIT_PROBE.requests } };
}

/** `audit.probe`: validated like every command; duration, cooldown and the per-company limit are enforced here. */
export function auditCommand(g: GameState, auditor: Identity, command: Command, emit: Emit): Result {
  if (command.type !== 'audit.probe') return { ok: false, code: 'FORBIDDEN', error: 'Acción no autorizada para este rol.' };
  if (g.status !== 'RUNNING') return { ok: false, code: 'ROOM_PAUSED', error: 'La simulación no está en curso.' };
  const p = command.payload ?? {};
  try { validateParameters('audit.probe', p); } catch (e) { return { ok: false, code: 'INVALID', error: e instanceof Error ? e.message : 'Parámetros inválidos.' }; }
  const c = g.companies[p.companyId as number], check = p.check as ControlCheck;
  if (c.eliminated) return { ok: false, code: 'ELIMINATED', error: `${c.name} está fuera de la partida.` };
  const last = own(g, auditor.id).at(-1);
  if (last && !last.finished) return { ok: false, code: 'PROBE_ACTIVE', error: 'Tu prueba de control anterior sigue en curso.' };
  if (last && g.tick < last.endsAt + AUDIT_PROBE.cooldownSeconds) return { ok: false, code: 'COOLDOWN', error: `Podés lanzar otra prueba de control en ${Math.ceil(last.endsAt + AUDIT_PROBE.cooldownSeconds - g.tick)} s.` };
  // Several auditors cannot pile anomalous traffic on the same company at once.
  if ((g.auditors?.probes ?? []).filter(x => x.companyId === c.id && !x.finished).length >= AUDIT_PROBE.perCompany) return { ok: false, code: 'COMPANY_BUSY', error: `${c.name} ya tiene el máximo de pruebas de control en curso. Esperá un momento.` };
  const node = route(c.backend).find(n => n.id === p.nodeId);
  if (!node) return { ok: false, code: 'NOT_FOUND', error: `Ese módulo no está en producción en ${c.name}.` };
  if (!pendingControls(c, node).some(x => x.check === check)) return { ok: false, code: 'NOT_PENDING', error: `${CONTROL_CHECK_INFO[check].control} ya no figura como control pendiente de ${node.data.label}.` };
  const state = auditorState(g), category = CONTROL_CHECK_INFO[check].category;
  const probe: AuditProbe = { id: `AP-${++state.sequence}`, auditorId: auditor.id, companyId: c.id, nodeId: node.id, module: node.data.label, check, category,
    startedAt: g.tick, endsAt: round(g.tick + AUDIT_PROBE.durationSeconds), finished: false,
    sent: 0, contained: 0, notContained: 0, unserved: 0, breached: 0, served: 0, rejectedLater: 0, abandoned: 0, settled: 0 };
  state.probes.push(probe);
  // Bounded history: the oldest finished probes leave first; cooldowns only need each auditor's last probe.
  while (state.probes.length > 2000) { const i = state.probes.findIndex(x => x.finished); if (i < 0) break; state.probes.splice(i, 1); }
  // The company sees the traffic, never who requested it.
  emit(g, c.id, `Tráfico inusual entrante · ${CATEGORY_LABELS[category]} · ${AUDIT_PROBE.durationSeconds} s.`, 'bad', 'SECURITY');
  return { ok: true, refs: [probe.id] };
}

/** Records where a contained request was stopped (first one only), resolving a readable block/module label. */
function captureStop(c: Company, probe: AuditProbe, verdict: SecurityVerdict) {
  if (probe.stop || !verdict.scope) return;
  const stop: ProbeStop = { scope: verdict.scope, ...(verdict.rule ? { rule: verdict.rule } : {}) };
  if (verdict.scope === 'block' && verdict.nodeId) { stop.nodeId = verdict.nodeId; stop.label = label(c, verdict.nodeId); }
  else if (verdict.scope === 'module' && verdict.moduleId) stop.label = moduleLabel(c, verdict.moduleId);
  probe.stop = stop;
}
/** Classifies the final outcome of a not-contained request once the engine has settled it. */
function settle(probe: AuditProbe, r: TrafficRequest) {
  probe.settled++;
  const reach = reachOf(r); if (!probe.reach || REACH_RANK[reach] > REACH_RANK[probe.reach]) probe.reach = reach;
  if (r.breach) probe.breached++;
  else if (r.result!.status === 'COMPLETED') probe.served++;
  else if (r.result!.status === 'ABANDONED') probe.abandoned++;
  else probe.rejectedLater++;
}
/**
 * Admits the probes' simulated anomalous requests for one company, before its traffic advances, exactly like the
 * engine's periodic anomalous traffic, and follows the ones that pass to their outcome. Admission decides what is
 * contained; the engine decides the rest. Runs each tick, so results are counted before retention prunes them.
 */
export function advanceProbes(g: GameState, c: Company, emit: Emit) {
  const probes = (g.auditors?.probes ?? []).filter(x => x.companyId === c.id);
  if (!probes.length) return;
  const byId = new Map(probes.map(x => [x.id, x]));
  // Count the downstream outcome of requests that passed the controls and have now settled.
  for (const r of Object.values(c.traffic.requests)) {
    if (!r.probe || r.probeSettled || !r.result) continue;
    const probe = byId.get(r.probe); if (probe) { settle(probe, r); r.probeSettled = true; }
  }
  for (const probe of probes) {
    if (probe.finished) continue;
    while (probe.sent < AUDIT_PROBE.requests && g.tick + 1e-9 >= probe.startedAt + probe.sent * SPACING) {
      const verdict: SecurityVerdict = {};
      const request = admitTraffic(c, g.tick, 'purchase', 'malicious', probe.category, undefined, undefined, verdict);
      probe.sent++;
      if (request.result) probe.unserved++;               // rejected at admission (maintenance, paused, queue full)
      else if (request.securityAllowed) { probe.notContained++; request.probe = probe.id; } // followed to its outcome
      else { probe.contained++; captureStop(c, probe, verdict); }                            // stopped at the controls
    }
    // Finished once sending is done, the window closed and every request that entered has settled.
    if (probe.sent >= AUDIT_PROBE.requests && g.tick + 1e-9 >= probe.endsAt && probe.settled >= probe.notContained) {
      probe.finished = true;
      openFinding(g, probe, emit);
      emit(g, probe.companyId, `Tráfico inusual finalizado · ${probe.contained} contenidas, ${probe.notContained} no contenidas.`, probe.notContained ? 'bad' : 'good', 'SECURITY');
    }
  }
}
/**
 * A probe that proved nothing contains the traffic leaves a finding: a one-time fine and, from here on, a leak.
 * Re-proving the same hole does not open a second finding and does not charge the fine again.
 */
export function openFinding(g: GameState, probe: AuditProbe, emit: Emit): AuditFinding | undefined {
  if (!probe.notContained) return undefined;
  const state = auditorState(g), c = g.companies[probe.companyId];
  const open = state.findings.find(f => f.closedAt === undefined && f.companyId === probe.companyId && f.nodeId === probe.nodeId && f.check === probe.check);
  if (open) return open;
  const control = CONTROL_CHECK_INFO[probe.check].control;
  const finding: AuditFinding = { id: `AF-${state.findings.length + 1}`, companyId: probe.companyId, nodeId: probe.nodeId, module: probe.module,
    check: probe.check, category: probe.category, openedAt: g.tick, fine: AUDIT_LEAK.fine, uncontained: 0, lost: 0 };
  state.findings.push(finding);
  // What the probe itself proved is paid for by the fine; the leak charges only traffic from here on.
  for (const r of Object.values(c.traffic.requests)) if (r.result) r.leakCharged = true;
  c.capital = Math.max(0, c.capital - finding.fine);
  emit(g, c.id, `Hallazgo de auditoría externa en ${finding.module}: falta ${control}. Multa de Q${finding.fine}.`, 'bad', 'SECURITY');
  addSlackMessage(g, { companyId: c.id, channel: 'alertas-sistema', source: 'system', author: 'Sistema', cause: 0, dedup: `finding:${finding.id}`,
    text: `[CRITICAL] Auditoría externa: ${CONTROL_CHECK_INFO[probe.check].pending} Control pendiente: ${control} en ${finding.module}.`, refs: [finding.id] });
  return finding;
}
/**
 * The leak. Every anomalous request that the controls did not contain and that matches an open finding costs the
 * company a little money and a little reputation. The charge is per request, by absolute count and not by
 * proportion, so the damage starts imperceptible and grows on its own as the game's traffic grows.
 */
export function chargeLeaks(g: GameState, c: Company) {
  const findings = (g.auditors?.findings ?? []).filter(f => f.closedAt === undefined && f.companyId === c.id);
  if (!findings.length) return;
  for (const r of Object.values(c.traffic.requests)) {
    if (!r.result || r.leakCharged || r.trafficClass !== 'malicious' || !r.securityAllowed || !r.attackKind) continue;
    r.leakCharged = true;
    const finding = findings.find(f => f.category === r.attackKind);
    if (!finding) continue;
    finding.uncontained++;
    const cost = Math.min(AUDIT_LEAK.costPerRequest, c.capital);
    finding.lost += cost; c.capital -= cost;
    c.reputation = Math.min(100, Math.max(0, c.reputation - AUDIT_LEAK.reputationPerRequest));
  }
}

/** A finding closes by itself when its control stops being pending in production: Seguridad configured it. */
export function closeSettledFindings(g: GameState, c: Company, emit: Emit) {
  for (const f of g.auditors?.findings ?? []) {
    if (f.closedAt !== undefined || f.companyId !== c.id) continue;
    const node = route(c.backend).find(n => n.id === f.nodeId);
    if (node && pendingControls(c, node).some(x => x.check === f.check)) continue;
    f.closedAt = g.tick;
    const control = CONTROL_CHECK_INFO[f.check].control;
    emit(g, c.id, `Hallazgo de auditoría corregido en ${f.module}: ${control} configurado.`, 'good', 'SECURITY');
    addSlackMessage(g, { companyId: c.id, channel: 'alertas-sistema', source: 'system', author: 'Sistema', cause: 0, dedup: `finding-closed:${f.id}`,
      text: `[SISTEMA] El control ${control} de ${f.module} quedó configurado. El hallazgo de auditoría se cerró.`, refs: [f.id] });
  }
}

/** Probes of a company that left the game, or of a finished game, stop where they are. */
export function closeProbes(g: GameState, companyId?: number) {
  for (const probe of g.auditors?.probes ?? []) if (!probe.finished && (companyId === undefined || probe.companyId === companyId)) probe.finished = true;
}
