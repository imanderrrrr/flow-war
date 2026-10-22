import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyCommand, project } from '../server/engine.js';
import { ensureLobby, formTeams, joinLobby, participantIdentity } from '../server/lobby.js';
import { pendingControls, auditCompanies, targetService } from '../server/auditor.js';
import { recoverGame, serializeGame } from '../server/persistence.js';
import { route } from '../server/graphs.js';
import { serviceRates } from '../server/traffic.js';
import { DEFAULT_TEST } from '../shared/actions.js';
import { AUDIT_LEAK, AUDIT_PROBE, CONTROL_CHECKS } from '../shared/auditor.js';
import { LOBBY_ICONS } from '../shared/lobby.js';
import type { GameState, GraphNode, Identity } from '../shared/types.js';
import type { ModuleVersion } from '../shared/simulation.js';
import { command, advanceGame } from './helpers.js';

const auditor = (n = 1): Identity => ({ id: `auditor-P${n}`, role: 'auditor', companyId: null });
let sequence = 0;
const probe = (g: GameState, who: Identity, payload: Record<string, unknown>) => applyCommand(g, who, { id: `probe-${++sequence}`, type: 'audit.probe', payload });
const running = () => { const g = createGame(); assert(command(g, 'operator', 'room.start').ok); return g; };
const sustain = (g: GameState, who: Identity, payload: Record<string, unknown>) => applyCommand(g, who, { id: `sustain-${++sequence}`, type: 'audit.sustain', payload });
/** Runs a probe on that module until its finding is open, and returns it. */
function openFindingOn(g: GameState, companyId: number, nodeId: string, check: string, who = auditor()) {
  assert(probe(g, who, { companyId, nodeId, check }).ok);
  for (let i = 0; i < 500 && !(g.auditors?.findings ?? []).some(f => f.companyId === companyId && f.nodeId === nodeId); i++) advanceGame(g, 0.1);
  const finding = g.auditors!.findings.find(f => f.companyId === companyId && f.nodeId === nodeId);
  assert(finding, 'no se abrió el hallazgo'); return finding;
}

/** Backend → Seguridad (controls on one block) → QA → CTO → DevOps for company 0. */
function deployWithControls(g: GameState, nodeId: string, rules: unknown[]) {
  const c = g.companies[0];
  assert(command(g, 'backend', 'change.submit', { graph: structuredClone(c.backend), revision: c.drafts.backend?.revision ?? 0 }).ok);
  const ch = g.changes[0];
  assert(command(g, 'security', 'security.configure', { changeId: ch.id, nodeId, revision: 0, rules }).ok);
  assert(command(g, 'security', 'security.submit', { changeId: ch.id, revision: 1 }).ok);
  assert(command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario: DEFAULT_TEST }).ok); advanceGame(g, 1);
  assert(command(g, 'qa', 'qa.approve', {}, ch.id).ok); assert(command(g, 'cto', 'cto.authorize', {}, ch.id).ok);
  assert(command(g, 'devops', 'deploy.start', { strategy: 'rolling' }, ch.id).ok); advanceGame(g, 7);
  assert.equal(ch.status, 'DEPLOYED');
}

test('players left in the reserve after the draw become external auditors with no company', () => {
  const g = createGame(); ensureLobby(g, n => n - 1, 0);
  for (let i = 0; i < 27; i++) joinLobby(g, { pin: g.lobby!.pin, name: `Jugador ${i}`, icon: LOBBY_ICONS[i % LOBBY_ICONS.length] });
  const before = g.lobby!.participants[0];
  assert.equal(participantIdentity(g, { participant: before.id, lobby: g.lobby!.id }), null, 'nobody has a role before the draw');
  formTeams(g);
  const reserve = g.lobby!.participants.filter(p => p.companyId === undefined);
  assert.equal(reserve.length, 2);
  for (const p of reserve) assert.deepEqual(participantIdentity(g, { participant: p.id, lobby: g.lobby!.id }), { id: `auditor-${p.id}`, role: 'auditor', companyId: null });
  const seated = g.lobby!.participants.find(p => p.companyId === 1 && p.role === 'qa')!;
  assert.deepEqual(participantIdentity(g, { participant: seated.id, lobby: g.lobby!.id }), { id: '1-qa', role: 'qa', companyId: 1 });
  assert.equal(Object.keys(g.actions.employees).length, 30, 'auditors are not employees');
});

test('auditor projection shows only production modules and controles pendientes, never private company data', () => {
  const g = running(), view = project(g, auditor());
  assert(view.auditor); assert.equal(view.auditor.companies.length, 5);
  assert.equal(view.privateCompany, undefined); assert.equal(view.operations, undefined); assert.equal(view.slack, undefined); assert.deepEqual(view.changes, []);
  const nova = view.auditor.companies[0];
  assert.deepEqual(nova.modules.map(m => m.nodeId), route(g.companies[0].backend).map(n => n.id));
  // Nothing is protected at the start: every control is pending on every module.
  for (const m of nova.modules) assert.deepEqual(m.pending.map(p => p.check), [...CONTROL_CHECKS]);
  assert.match(nova.modules[0].pending.find(p => p.check === 'waf')!.text, /no tiene validación de entrada/);
  const text = JSON.stringify(view.auditor);
  for (const secret of ['capital', 'infraBudget', 'drafts', 'defects', 'reserved', 'customers', 'credentials']) assert(!text.includes(secret), secret);
  assert.equal(project(g, { id: '0-backend', role: 'backend', companyId: 0 }).auditor, undefined, 'company roles do not get the auditor view');
});

test('a prueba de control sends 30 anomalous requests in 30 s; the engine decides what is contained', () => {
  const g = running(), c = g.companies[0], maliciousBefore = c.traffic.malicious.generated;
  const result = probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' });
  assert.equal(result.ok, true, result.error);
  const event = g.events.find(e => e.companyId === 0 && e.text.startsWith('Tráfico inusual entrante'))!;
  assert(event); assert(!event.text.includes('auditor') && !event.text.includes('P1'), 'the company never learns who sent it');
  advanceGame(g, 10);
  let p = project(g, auditor()).auditor!.probes[0];
  assert(p.sent >= 10 && p.sent <= 11 && !p.finished, `live counters (${p.sent})`);
  advanceGame(g, 21);
  p = project(g, auditor()).auditor!.probes[0];
  assert.equal(p.finished, true); assert.equal(p.sent, AUDIT_PROBE.requests);
  assert.equal(p.contained + p.notContained + p.unserved, AUDIT_PROBE.requests);
  // No WAF anywhere: input validation is pending on every module, so nothing is contained.
  assert.equal(p.notContained, 30); assert.equal(p.contained, 0);
  assert.equal(c.traffic.malicious.generated - maliciousBefore, 30);
  assert(g.events.some(e => e.companyId === 0 && e.text === 'Tráfico inusual finalizado · 0 contenidas, 30 no contenidas.'));
  assert(!project(g, auditor()).events.some(e => e.companyId === 0), 'auditors do not read company events');
});

test('controls configured by Seguridad contain the probe, even on another module', () => {
  const g = running();
  deployWithControls(g, 'backend-read', [{ kind: 'input' }]);
  const c = g.companies[0], read = route(c.backend).find(n => n.id === 'backend-read')!, write = route(c.backend).find(n => n.id === 'backend-write')!;
  assert(!pendingControls(c, read).some(p => p.check === 'waf'), 'WAF configured on Read Stock');
  assert(pendingControls(c, write).some(p => p.check === 'waf'), 'Write Stock still lists it');
  assert.equal(probe(g, auditor(), { companyId: 0, nodeId: 'backend-read', check: 'waf' }).code, 'NOT_PENDING');
  assert.equal(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok, true);
  advanceGame(g, 31);
  const p = g.auditors!.probes[0];
  assert.equal(p.contained, 30, 'the WAF rule on Read Stock rejects every injection'); assert.equal(p.notContained, 0);
});

test('duration and cooldown are enforced by the server in game time', () => {
  const g = running(), a = auditor(1), b = auditor(2), target = { companyId: 1, nodeId: 'backend-payment', check: 'bot_detection' };
  assert.equal(probe(g, a, target).ok, true);
  assert.equal(probe(g, a, { ...target, companyId: 2 }).code, 'PROBE_ACTIVE');
  assert.equal(probe(g, b, target).ok, true, 'each auditor has its own cooldown');
  advanceGame(g, 30.2);
  assert.equal(g.auditors!.probes[0].finished, true);
  const early = probe(g, a, target); assert.equal(early.code, 'COOLDOWN'); assert.match(early.error!, /en 60 s/);
  // A paused game does not consume the cooldown.
  assert(command(g, 'operator', 'room.pause').ok); for (let i = 0; i < 700; i++) advanceGame(g, .1);
  assert(command(g, 'operator', 'room.start').ok);
  assert.equal(probe(g, a, target).code, 'COOLDOWN');
  advanceGame(g, 60);
  assert.equal(probe(g, a, target).ok, true);
});

test('probes are validated commands: roles, targets and identities are checked', () => {
  const g = createGame();
  assert.equal(probe(g, auditor(), { companyId: 0, nodeId: 'backend-read', check: 'auth' }).code, 'ROOM_PAUSED');
  assert(command(g, 'operator', 'room.start').ok);
  assert.equal(probe(g, auditor(), { companyId: 0, nodeId: 'backend-read', check: 'ip_block' }).code, 'INVALID');
  assert.equal(probe(g, auditor(), { companyId: 7, nodeId: 'backend-read', check: 'auth' }).code, 'INVALID');
  assert.equal(probe(g, auditor(), { companyId: 0, nodeId: 'nope', check: 'auth' }).code, 'NOT_FOUND');
  assert.equal(probe(g, auditor(), { companyId: 0, nodeId: 'backend-read', check: 'auth', extra: 1 }).code, 'INVALID');
  assert.equal(probe(g, { id: 'mallory', role: 'auditor', companyId: null }, { companyId: 0, nodeId: 'backend-read', check: 'auth' }).code, 'FORBIDDEN');
  assert.equal(probe(g, { id: 'auditor-P1', role: 'auditor', companyId: 0 }, { companyId: 0, nodeId: 'backend-read', check: 'auth' }).code, 'FORBIDDEN');
  // Company roles cannot launch probes and auditors cannot act for a company; neither creates strikes for others.
  assert.equal(command(g, 'qa', 'audit.probe', { companyId: 1, nodeId: 'backend-read', check: 'auth' }).code, 'FORBIDDEN');
  assert.equal(applyCommand(g, auditor(), { id: 'x-1', type: 'qa.run', companyId: 0, payload: { suite: 'Seguridad' } }).code, 'FORBIDDEN');
  assert.equal(applyCommand(g, auditor(), { id: 'x-2', type: 'chat.send', companyId: 0, payload: { channel: 'general', text: 'hola' } }).code, 'FORBIDDEN');
  assert.equal(g.actions.employees['0-qa'].violations.length, 1, 'only the real out-of-role attempt counts');
  // Idempotent like every command: the same ID returns the same receipt and never starts a second probe.
  const first = applyCommand(g, auditor(9), { id: 'same', type: 'audit.probe', payload: { companyId: 3, nodeId: 'backend-exit', check: 'rate_limit' } });
  const again = applyCommand(g, auditor(9), { id: 'same', type: 'audit.probe', payload: { companyId: 3, nodeId: 'backend-exit', check: 'rate_limit' } });
  assert.deepEqual(again, first); assert.equal(g.auditors!.probes.filter(p => p.auditorId === 'auditor-P9').length, 1);
});

test('probes survive persistence and replay deterministically', () => {
  const run = () => {
    const g = running(); advanceGame(g, 2);
    assert(probe(g, auditor(), { companyId: 4, nodeId: 'backend-read', check: 'auth' }).ok);
    advanceGame(g, 12);
    // A recovered room comes back paused; the teacher resumes it.
    const restored = recoverGame(serializeGame(g)); assert.equal(restored.status, 'PAUSED'); restored.status = 'RUNNING'; advanceGame(restored, 20);
    return { probe: restored.auditors!.probes[0], breaches: restored.companies[4].breaches, malicious: restored.companies[4].traffic.malicious, companies: auditCompanies(restored) };
  };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.equal(a.probe.finished, true); assert.equal(a.probe.sent, 30);
  // Forged identities: half carry a session, none owns the purchase; nothing is configured, so all pass the controls.
  assert.equal(a.probe.notContained, 30);
});

test('probes stop when the target company leaves the game', () => {
  const g = running();
  assert(probe(g, auditor(), { companyId: 2, nodeId: 'backend-read', check: 'waf' }).ok); advanceGame(g, 3);
  g.companies[2].serviceMode = { mode: 'FULL_MAINTENANCE', since: -1000 }; advanceGame(g, .1);
  assert.equal(g.companies[2].eliminated, true);
  const p = g.auditors!.probes[0]; assert.equal(p.finished, true); assert(p.sent < 30);
  assert.equal(probe(g, auditor(2), { companyId: 2, nodeId: 'backend-read', check: 'waf' }).code, 'ELIMINATED');
  assert.deepEqual(project(g, auditor()).auditor!.companies[2].modules, []);
});

test('history reconstruction replays the probe command at its tick with identical counters', async () => {
  const { DatabaseSync } = await import('node:sqlite'), { createGameWriter } = await import('../server/storage.js'), { reconstruct } = await import('../server/history.js');
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT)');
  const write = createGameWriter(db), g = createGame(1200); write(g);
  assert(command(g, 'operator', 'room.start').ok); advanceGame(g, 5); write(g);
  assert(probe(g, auditor(), { companyId: 3, nodeId: 'backend-payment', check: 'bot_detection' }).ok); write(g);
  advanceGame(g, 40); const live = structuredClone(g.auditors!.probes[0]), malicious = { ...g.companies[3].traffic.malicious };
  assert(command(g, 'operator', 'room.finish').ok); write(g);
  const rebuilt = reconstruct(db, 0, 45);
  assert.deepEqual(rebuilt.auditors!.probes[0], live); assert.deepEqual(rebuilt.companies[3].traffic.malicious, malicious);
  db.close();
});

test('a room reset starts the new generation without the previous probes or cooldowns', () => {
  const g = running();
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-read', check: 'waf' }).ok); advanceGame(g, 5);
  assert(command(g, 'operator', 'room.reset', { duration: 1500 }).ok);
  assert.equal(g.auditors, undefined); assert.equal(g.generation, 1);
  assert(command(g, 'operator', 'room.start').ok);
  assert.equal(probe(g, auditor(), { companyId: 0, nodeId: 'backend-read', check: 'waf' }).ok, true, 'no cooldown carried over');
});

const viewOf = (g: GameState, who = auditor()) => project(g, who).auditor!;

test('the probe narrates what happens to the company: traffic enters, reaches Write Stock and breaches', () => {
  const g = running();
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  advanceGame(g, 40);
  const p = g.auditors!.probes[0];
  assert.equal(p.finished, true); assert.equal(p.contained, 0); assert.equal(p.notContained, 30); assert.equal(p.settled, 30);
  assert.equal(p.breached + p.served + p.rejectedLater + p.abandoned, 30);
  assert(p.breached >= 25, `breaches ${p.breached}`); assert.equal(p.reach, 'write');
  const v = viewOf(g).probes.find(x => x.id === p.id)!;
  assert(v.summary.some(l => /pasan los controles y entran al sistema de NOVA, hasta Write Stock/.test(l)));
  assert(v.summary.some(l => /SECURITY BREACH y pierde reputación/.test(l)));
  assert(v.summary.some(l => /Resultado: NOVA sufre .* accesos indebidos/.test(l)));
});

test('the narrative says which control stopped the traffic and where, even on another module', () => {
  const g = running();
  deployWithControls(g, 'backend-read', [{ kind: 'input' }]);
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  advanceGame(g, 32);
  const p = g.auditors!.probes[0];
  assert.equal(p.contained, 30); assert.equal(p.notContained, 0);
  assert.equal(p.stop!.scope, 'block'); assert.equal(p.stop!.nodeId, 'backend-read'); assert.equal(p.stop!.rule, 'input');
  const v = viewOf(g).probes.find(x => x.id === p.id)!;
  assert(v.summary.some(l => /el control WAF configurado en Read Stock lo detiene antes de llegar a Write Stock/.test(l)), v.summary.join(' | '));
  assert(v.summary.some(l => /Resultado: NOVA contuvo todo el tráfico/.test(l)));
});

test('the pending list never reveals the hidden simulated defects of a seeded module', () => {
  const g = running(), c = g.companies[0];
  const node: GraphNode = { id: 'm', type: 'module', position: { x: 0, y: 0 }, data: { label: 'Login', module: { id: 'C0-M1', version: 1 } } };
  const base: ModuleVersion = { id: 'C0-M1', version: 1, companyId: 0, name: 'Login', configuration: { kind: 'purchase', idempotent: false }, dependencies: [], defects: [], profile: 'defects-1', createdBy: '0-backend', createdAt: 0, changeId: 'CH-001', graph: { nodes: [], edges: [] } };
  const secure = pendingControls(c, node, { modules: [base] });
  const vulnerable = pendingControls(c, node, { modules: [{ ...base, defects: [{ id: 'd', code: 'D08', severity: 'critical', profile: 'defects-1', artifactId: 'C0-M1', version: 1 }] }] });
  assert.deepEqual(secure.map(p => p.check), vulnerable.map(p => p.check), 'a hidden D08 does not change what the auditor sees');
  assert(secure.some(p => p.check === 'waf'), 'a seeded purchase module still lists WAF as pending');
});

test('at most two auditors can probe the same company at once', () => {
  const g = running(), target = { companyId: 1, nodeId: 'backend-read', check: 'auth' };
  assert(probe(g, auditor(1), target).ok); assert(probe(g, auditor(2), target).ok);
  assert.equal(probe(g, auditor(3), target).code, 'COMPANY_BUSY');
  assert(probe(g, auditor(3), { ...target, companyId: 2 }).ok, 'another company is free');
});

test('an auditor command never reaches another company (no cross-company observation or audit entry)', () => {
  const g = running();
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-read', check: 'auth' }).ok);
  // A forged command type or changeId is sanitized: no free text, no null-company marker.
  assert.equal(applyCommand(g, auditor(2), { id: 'x', type: 'EMPRESA NOVA PIERDE', companyId: 0, changeId: 'texto libre', payload: { companyId: 0 } }).code, 'UNSUPPORTED');
  const text = JSON.stringify(g.observability);
  assert(!text.includes('EMPRESA NOVA PIERDE') && !text.includes('texto libre'));
  for (const id of [1, 2, 3, 4]) {
    const events = project(g, { id: `${id}-qa`, role: 'qa', companyId: id }).events;
    assert(!events.some(e => e.text.startsWith('Tráfico inusual')), `company ${id} sees no probe event`);
  }
  // The audit entries of auditor commands are scoped to the target company (0), never null or another company.
  const entries = g.actions.audit.filter(a => a.actorId.startsWith('auditor-'));
  assert(entries.length >= 2); assert(entries.every(a => a.companyId === 0), JSON.stringify(entries.map(a => a.companyId)));
  assert(entries.every(a => a.type === 'audit.probe' || a.type === 'audit.rejected'));
});

/** Advances in small steps until the first finding opens; returns the capital right before it was charged. */
function advanceUntilFinding(g: GameState, limit = 500): number {
  let before = g.companies[0].capital;
  for (let i = 0; i < limit; i++) { before = g.companies[g.auditors?.probes[0]?.companyId ?? 0].capital; advanceGame(g, 0.1); if (g.auditors?.findings.length) return before; }
  throw new Error('no se abrió ningún hallazgo');
}

test('un hallazgo se abre una vez, cobra Q250 y se cierra al configurar el control', () => {
  const g = running(), c = g.companies[0];
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  const before = advanceUntilFinding(g);
  const finding = g.auditors!.findings[0];
  assert.equal(finding.check, 'waf'); assert.equal(finding.nodeId, 'backend-write'); assert.equal(finding.fine, 250);
  assert.equal(Math.round(before - c.capital), 250, 'la multa se cobró al abrirse');
  assert.equal(finding.closedAt, undefined);
  // Una segunda prueba sobre el mismo hueco no abre otro hallazgo ni cobra de nuevo.
  advanceGame(g, 100);
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  advanceGame(g, 40);
  assert.equal(g.auditors!.findings.length, 1);
  // Seguridad configura el control: el hallazgo se cierra.
  deployWithControls(g, 'backend-write', [{ kind: 'input' }]);
  advanceGame(g, 1);
  assert(g.auditors!.findings[0].closedAt !== undefined, 'se cerró al desaparecer el control pendiente');
});

test('el hallazgo llega a Seguridad y al CTO de su empresa, y a nadie más', () => {
  const g = running();
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  advanceUntilFinding(g);
  for (const role of ['security', 'cto'] as const) {
    const view = project(g, { id: `0-${role}`, role, companyId: 0 }).operations!.findings;
    assert.equal(view?.length, 1, role); assert.equal(view![0].module, 'Write Stock');
    assert(!JSON.stringify(view).includes('auditor'), 'nunca la identidad del auditor');
  }
  assert.equal(project(g, { id: '0-backend', role: 'backend', companyId: 0 }).operations!.findings, undefined);
  assert.equal(project(g, { id: '1-security', role: 'security', companyId: 1 }).operations!.findings?.length ?? 0, 0);
});

/** Opens a finding just before `target` seconds and measures the leak over the next 60 s of game time. */
function leakWindow(target: number) {
  const g = running(), c = g.companies[0];
  c.capital = 1_000_000; c.infraBudget = 1_000_000;
  advanceGame(g, target - 35);
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  advanceUntilFinding(g);
  const f = g.auditors!.findings[0], before = { lost: f.lost, n: f.uncontained, reputation: c.reputation };
  advanceGame(g, 60);
  return { lost: f.lost - before.lost, n: f.uncontained - before.n, drop: before.reputation - c.reputation, eliminated: c.eliminated };
}

test('un hallazgo abierto sangra, y el daño por minuto crece con el tráfico', () => {
  const early = leakWindow(420), late = leakWindow(1200);
  assert(early.n > 0, 'se atribuyen las solicitudes no contenidas');
  assert(early.lost > 0, 'pierde dinero');
  assert(early.drop > 0, 'pierde reputación');
  assert(!late.eliminated, 'la empresa sigue en juego para poder medir');
  assert(late.n > early.n * 2, `no contenidas: temprano ${early.n}, tarde ${late.n}`);
  assert(late.lost > early.lost * 2, `pérdida: temprano ${early.lost}, tarde ${late.lost}`);
});

test('el sangrado no lleva el capital por debajo de cero ni sigue tras cerrar el hallazgo', () => {
  const g = running(), c = g.companies[0];
  advanceGame(g, 390);
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  advanceUntilFinding(g);
  const finding = g.auditors!.findings[0];
  // Con el capital casi agotado el cobro se detiene en cero, aunque la empresa siga facturando en paralelo.
  c.capital = 5;
  for (let i = 0; i < 300; i++) { advanceGame(g, 0.1); assert(c.capital >= 0, `capital ${c.capital}`); }
  assert(finding.lost > 0, 'el sangrado sí cobró');
  c.capital = 10000; c.bankruptTicks = 0;
  deployWithControls(g, 'backend-write', [{ kind: 'input' }]);
  advanceGame(g, 1);
  assert(finding.closedAt !== undefined, 'el hallazgo quedó cerrado');
  const frozen = finding.uncontained; advanceGame(g, 60);
  assert.equal(finding.uncontained, frozen, 'un hallazgo cerrado deja de sangrar');
});

test('la prueba sostenida respeta sus topes y nunca deja a la empresa sin capacidad', () => {
  const g = running(), c = g.companies[0];
  const finding = openFindingOn(g, 0, 'backend-write', 'waf');
  assert.equal(sustain(g, auditor(), { findingId: finding.id }).ok, true);
  const sold = c.traffic.totals.completed;
  for (let i = 0; i < 700; i++) { advanceGame(g, 0.1); assert(serviceRates(c).web > 0, 'la capacidad nunca llega a cero'); }
  assert(c.traffic.totals.completed > sold, 'la empresa sigue vendiendo durante la ventana');
  assert.equal(c.eliminated, false);
  assert.equal(finding.sustain, undefined, 'la ventana se cerró sola al cumplirse los 60 s');
});

test('sostener exige un hallazgo abierto y respeta la espera', () => {
  const g = running(), finding = openFindingOn(g, 0, 'backend-write', 'waf');
  assert.equal(sustain(g, auditor(), { findingId: 'AF-404' }).code, 'NOT_FOUND');
  assert(sustain(g, auditor(), { findingId: finding.id }).ok);
  assert.equal(sustain(g, auditor(), { findingId: finding.id }).code, 'SUSTAIN_ACTIVE');
  advanceGame(g, 65);
  assert.equal(sustain(g, auditor(), { findingId: finding.id }).code, 'COOLDOWN');
});

test('la ventana se corta si la empresa sale de la partida', () => {
  const g = running(), c = g.companies[2];
  const finding = openFindingOn(g, 2, 'backend-write', 'waf');
  assert(sustain(g, auditor(), { findingId: finding.id }).ok);
  advanceGame(g, 3);
  c.serviceMode = { mode: 'FULL_MAINTENANCE', since: -1000 }; advanceGame(g, 0.1);
  assert.equal(c.eliminated, true);
  assert.equal(finding.sustain, undefined, 'la ventana quedó cerrada');
});

test('auditar Write Stock deja el inventario en cero durante la ventana y se recupera al cerrarse', () => {
  const g = running(), c = g.companies[0];
  const finding = openFindingOn(g, 0, 'backend-write', 'waf');
  assert(sustain(g, auditor(), { findingId: finding.id }).ok);
  advanceGame(g, 5);
  assert.equal(c.traffic.inventory.stock, 0, 'ventas frenadas');
  advanceGame(g, 70);
  assert.equal(finding.sustain, undefined);
  assert(c.traffic.inventory.stock > 0, 'el reabastecimiento lo recupera');
});

test('el reabastecimiento vuelve aunque la ventana termine por el cierre del hallazgo', () => {
  const g = running(), c = g.companies[0];
  const finding = openFindingOn(g, 0, 'backend-read', 'waf');
  assert(sustain(g, auditor(), { findingId: finding.id }).ok);
  advanceGame(g, 5);
  deployWithControls(g, 'backend-read', [{ kind: 'input' }]);
  advanceGame(g, 2);
  assert(finding.closedAt !== undefined); assert.equal(finding.sustain, undefined);
  const stock = c.traffic.inventory.stock; advanceGame(g, 5);
  assert(c.traffic.inventory.stock >= stock, 'el motor volvió a reabastecer');
});

test('auditar Payment deja compras legítimas sin cobrar', () => {
  const g = running(), c = g.companies[0];
  advanceGame(g, 60);
  const finding = openFindingOn(g, 0, 'backend-payment', 'auth');
  const revenue = c.revenue, lost = c.lostRevenue;
  assert(sustain(g, auditor(), { findingId: finding.id }).ok);
  advanceGame(g, 45);
  assert.equal(c.revenue, revenue, 'no factura durante la ventana');
  assert(c.lostRevenue > lost, 'el monto se registra como ingreso perdido');
});

test('cada módulo golpea el servicio al que pertenece', () => {
  assert.equal(targetService({ id: 'a', type: 'entry', position: { x: 0, y: 0 }, data: { label: '' } }), 'security');
  assert.equal(targetService({ id: 'a', type: 'write', position: { x: 0, y: 0 }, data: { label: '' } }), 'inventory');
  assert.equal(targetService({ id: 'a', type: 'payment', position: { x: 0, y: 0 }, data: { label: '' } }), 'payment');
});

test('calibración: corregir temprano cuesta poco más que la multa; ignorarlo deja a la empresa en crisis', () => {
  const horizon = 600;
  const play = (fix: boolean) => {
    const g = createGame(horizon); assert(command(g, 'operator', 'room.start').ok);
    const c = g.companies[0];
    advanceGame(g, horizon * 0.27);
    const finding = openFindingOn(g, 0, 'backend-write', 'waf');
    if (fix) { advanceGame(g, 120); deployWithControls(g, 'backend-write', [{ kind: 'input' }]); }
    while (g.status === 'RUNNING') advanceGame(g, 1);
    return { total: finding.fine + finding.lost, reputation: c.reputation, closed: finding.closedAt !== undefined };
  };
  const fixed = play(true), ignored = play(false);
  assert(fixed.closed, 'configurar el control cierra el hallazgo');
  assert(fixed.total < AUDIT_LEAK.fine * 3, `corregir temprano cuesta poco más que la multa: Q${Math.round(fixed.total)}`);
  assert(ignored.total > fixed.total * 3, `ignorarlo cuesta mucho más: Q${Math.round(ignored.total)} contra Q${Math.round(fixed.total)}`);
  assert(ignored.reputation < fixed.reputation, `ignorarlo deja peor reputación: ${ignored.reputation} contra ${fixed.reputation}`);
});
