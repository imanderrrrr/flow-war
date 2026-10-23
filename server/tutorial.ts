import { applyCommand, createGame, project, step } from './engine.js';
import { completePlan, planGraph, type PlanPiece } from '../shared/plan.js';
import { issueInitialTraffic } from './traffic.js';
import { startConcurrency } from './scenarios.js';
import { isRunFinished } from './requests.js';
import { route, sellCapable } from './graphs.js';
import { activeScope } from './operations.js';
import { designPending } from './design.js';
import { productState } from './product.js';
import { DEFAULT_TEST, type TestScenario } from '../shared/actions.js';
import { PRODUCT_CATALOG } from '../shared/product.js';
import { TUTORIALS, type TutorialBoard, type TutorialEntry, type TutorialRole, type TutorialState, type TutorialView } from '../shared/tutorial.js';
import { ROLE_LABELS, type Command, type Company, type GameState, type Graph, type Identity, type Result, type Role, type Snapshot } from '../shared/types.js';
import type { Pacing } from '../shared/pacing.js';

/**
 * Mandatory tutorials (docs/25). Each student practices on an isolated copy of the engine: a GameState of its
 * own, never persisted, where scripted counterparts (the other roles of the same company) provide what the role
 * needs. Commands are validated and executed by the same applyCommand as real ones, so the practice teaches the
 * real rules; the real company, its economy and the room's determinism are never touched. Only the progress
 * (which step each player is on) lives in the real GameState, so a reload or a server restart resumes it.
 */

/** Practice copies never leave the calm phase (no bursts, no anomalous noise) but allow pruebas de control. */
export const PRACTICE_PACING: Pacing = { version: 1, calmUntil: 10_000_000, rampUntil: 10_000_001, calmDemand: .5, calmPenalty: .25, auditsInCalm: true };
/** A practice runs an hour of game time at most; a student who lingers past it gets a fresh copy at the same step. */
export const PRACTICE_DURATION = 3600;
/** Ticks per server iteration: normal time while the student works, faster while the engine produces a result. */
export const PRACTICE_SPEED = { working: 1, waiting: 4 } as const;
/** Practice snapshots carry their own generation, so switching back to the real room is always a full state. */
export const PRACTICE_GENERATION = 1_000_000;

export type Subject = { key: string; identity: Identity; participantId?: string };
/** `copy`: which build of this player's practice it is; a rebuilt copy is a new snapshot generation, so the
 * workspace remounts with no local state left over from the previous copy. */
export type Practice = { key: string; identity: Identity; game: GameState; step: number; seq: number; notes: string[]; copy: number };
type Context = { p: Practice; g: GameState; c: Company; identity: Identity };
type StepScript = {
  /** Scripted counterparts act when the step begins. */
  enter?: (x: Context) => void;
  /** Action steps: true once the practice copy shows the confirmed result. */
  done?: (x: Context) => boolean;
  /** Read steps: false while the engine is still producing what the step talks about. */
  ready?: (x: Context) => boolean;
  waiting?: (x: Context) => string | undefined;
  facts?: (x: Context) => string[];
  /** Per-tick upkeep by the counterparts, e.g. returning a change that would otherwise lock the student out. */
  sustain?: (x: Context) => void;
  /** The canonical student action, written against the snapshot a client sees: rebuilds a copy after a restart
   * and drives the real-server tests exactly like a browser would. */
  solve?: (s: Snapshot, identity: Identity) => Omit<Command, 'id'> | null;
};
type RoleScript = { setup?: (x: Context) => void; steps: Record<string, StepScript> };

// ---------------------------------------------------------------------------------------------------------------
// Progress in the real room

const roleOf = (identity: Identity): TutorialRole | undefined => identity.role === 'operator' ? undefined : identity.role;
export function tutorialState(g: GameState): TutorialState {
  if (!g.tutorials || g.tutorials.generation !== g.generation) g.tutorials = { generation: g.generation, players: {} };
  return g.tutorials;
}
const peekState = (g: GameState) => g.tutorials?.generation === g.generation ? g.tutorials : undefined;
/** The player's entry for the seat they hold now; a seat changed by the teacher starts that role's tutorial over. */
export function entryFor(g: GameState, subject: Subject): TutorialEntry | undefined {
  const entry = peekState(g)?.players[subject.key], role = roleOf(subject.identity);
  return entry && entry.role === role && entry.companyId === subject.identity.companyId ? entry : undefined;
}
/** Room seats owe the tutorial from the draw on; a credential login owes it from its first entry into the workspace. */
export function owesTutorial(g: GameState, subject: Subject): boolean {
  // Producto/UX owes nothing in a room that did not enable the department.
  if (!roleOf(subject.identity) || (subject.identity.role === 'product' && g.productEnabled !== true)) return false;
  if (subject.participantId) return !!g.lobby?.formation;
  return !!entryFor(g, subject);
}
export const tutorialPending = (g: GameState, subject: Subject) => owesTutorial(g, subject) && entryFor(g, subject)?.finishedAt === undefined;
/** True when entering the workspace now would start this player's tutorial (nothing is written). */
export function startsTutorial(g: GameState, subject: Subject): boolean {
  const role = roleOf(subject.identity);
  if (!role || entryFor(g, subject) || (role === 'product' && g.productEnabled !== true)) return false;
  return !subject.participantId || !!g.lobby?.formation;
}
/** Creates the entry on the first entry into the workspace. Returns true when the room state changed. */
export function enterTutorial(g: GameState, subject: Subject, now = g.tick): boolean {
  if (!startsTutorial(g, subject)) return false;
  const role = roleOf(subject.identity)!;
  tutorialState(g).players[subject.key] = { role, companyId: subject.identity.companyId, step: 0, startedAt: now, ...(subject.participantId ? { participantId: subject.participantId } : {}) };
  return true;
}
export function setStep(g: GameState, subject: Subject, step: number, now = g.tick) {
  const entry = entryFor(g, subject) ?? (enterTutorial(g, subject, now), entryFor(g, subject));
  if (!entry) return;
  entry.step = Math.min(step, TUTORIALS[entry.role].steps.length);
  if (entry.step >= TUTORIALS[entry.role].steps.length) entry.finishedAt ??= now;
}

/**
 * The start gate. Counted: every room seat (team or reserve) and every credential login already in its tutorial,
 * when that player is connected right now and has not finished. A player who closed the page does not hold the
 * room: whoever comes back later still has to finish before acting, even with the game running.
 */
export function pendingPlayers(g: GameState, connected: Set<string>): { key: string; name: string }[] {
  return tutorialBoard(g, connected).rows.filter(r => r.connected && !r.finished).map(r => ({ key: r.key, name: r.name }));
}
export function tutorialBoard(g: GameState, connected: Set<string>): TutorialBoard {
  const rows: TutorialBoard['rows'] = [], players = peekState(g)?.players ?? {};
  const formation = g.lobby?.formation;
  if (formation) for (const p of g.lobby!.participants) {
    const identity: Identity = p.companyId !== undefined && p.role ? { id: `${p.companyId}-${p.role}`, role: p.role, companyId: p.companyId } : { id: `auditor-${p.id}`, role: 'auditor', companyId: null };
    const subject = { key: `p:${p.id}`, identity, participantId: p.id }, entry = entryFor(g, subject), role = roleOf(identity)!;
    rows.push({ key: subject.key, participantId: p.id, name: p.name, role, companyId: identity.companyId, step: entry?.step ?? 0, total: TUTORIALS[role].steps.length, finished: entry?.finishedAt !== undefined, connected: connected.has(subject.key) });
  }
  for (const [key, entry] of Object.entries(players)) {
    if (!key.startsWith('i:') || (entry.role === 'product' && g.productEnabled !== true)) continue;
    rows.push({ key, name: `${entry.companyId === null ? '' : `${g.companies[entry.companyId]?.name ?? ''} · `}${ROLE_LABELS[entry.role]}`, role: entry.role, companyId: entry.companyId, step: entry.step, total: TUTORIALS[entry.role].steps.length, finished: entry.finishedAt !== undefined, connected: connected.has(key) });
  }
  return { rows, pending: rows.filter(r => r.connected && !r.finished).length, finished: rows.filter(r => r.finished).length };
}

// ---------------------------------------------------------------------------------------------------------------
// Scripted counterparts and step checks

const as = (role: Role, companyId: number): Identity => ({ id: `${companyId}-${role}`, role, companyId });
function run(p: Practice, identity: Identity, type: string, payload: Record<string, unknown> = {}, changeId?: string): Result {
  return applyCommand(p.game, identity, { id: `tutorial-${++p.seq}`, type, ...(identity.companyId !== null ? { companyId: identity.companyId } : {}), ...(changeId ? { changeId } : {}), payload });
}
/** A counterpart that fails is a bug in the script, never something the student caused. */
function script(p: Practice, identity: Identity, type: string, payload: Record<string, unknown> = {}, changeId?: string) {
  const result = run(p, identity, type, payload, changeId);
  if (!result.ok) throw new Error(`Guion de práctica ${type}: ${result.error}`);
  return result;
}
function fastForward(g: GameState, until: () => boolean, seconds = 120) { for (let i = 0; i < seconds * 10 && !until() && g.status === 'RUNNING'; i++) step(g); }
const types = (graph: Graph) => route(graph).map(n => n.type);
const atomicBetween = (graph: Graph) => { const t = types(graph), r = t.indexOf('read'), a = t.indexOf('atomic'), w = t.indexOf('write'); return r >= 0 && a > r && w > a; };
/** The draft as backend-enviar sends it: with Atomic Update between Read Stock and Write Stock, added only if missing. */
const fixed = (graph: Graph) => atomicBetween(graph) ? graph : withAtomic(graph);
/** The purchase-flow graph with Atomic Update between Read Stock and Write Stock (what backend-enviar asks for). */
export function withAtomic(graph: Graph): Graph {
  const copy = structuredClone(graph), write = copy.nodes.find(n => n.type === 'write')!, edge = copy.edges.find(e => e.target === write.id)!;
  copy.nodes.push({ id: 'tutorial-atomic', type: 'atomic', position: { x: write.position.x - 95, y: write.position.y + 140 }, data: { label: 'Atomic Update', value: 1 } });
  copy.edges = copy.edges.filter(e => e.id !== edge.id);
  copy.edges.push({ id: 'tutorial-atomic-in', source: edge.source, target: 'tutorial-atomic' }, { id: 'tutorial-atomic-out', source: 'tutorial-atomic', target: write.id });
  return copy;
}
/** Adds pieces to a plan in their solares, with roads chained in the order given. */
function extendPlan(plan: Graph, chain: PlanPiece[]): Graph {
  const copy = structuredClone(plan), id = (t: PlanPiece) => copy.nodes.find(n => n.type === t)?.id ?? `plan-${t}`;
  for (const t of chain) if (!copy.nodes.some(n => n.type === t)) copy.nodes.push(planGraph([t]).nodes[0]);
  chain.slice(1).forEach((t, i) => { const source = id(chain[i]); copy.edges = [...copy.edges.filter(e => e.source !== source), { id: `${source}->${id(t)}`, source, target: id(t) }]; });
  return copy;
}
const assemble = (g: GameState) => { for (const company of g.companies) { company.plan = completePlan(); company.assembly = { active: false, closedAt: g.tick }; } };
const CONCURRENCY_CASE: TestScenario = { ...DEFAULT_TEST, suite: 'concurrency', requests: 2, stock: 1, concurrency: 2 };
/** The last-unit case: any concurrency run on one unit with simultaneous purchases (the manual case or, once
 * quick suites leave evidence, the Concurrencia suite). */
const sameCase = (s: TestScenario) => s.suite === CONCURRENCY_CASE.suite && s.requests >= 2 && s.stock === 1 && s.concurrency >= 2;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** The change the scripted Backend delivers for QA, the CTO and DevOps to work on. */
const practiceChange = (x: Context) => x.g.changes.find(ch => ch.companyId === x.c.id && ch.implementation && !['STALE', 'QA_REJECTED'].includes(ch.status));
const caseRun = (x: Context) => { const ch = practiceChange(x); return x.c.runtime.workflow?.runs.filter(r => r.changeId === ch?.id && r.report && sameCase(r.scenario)).at(-1); };

/** "Inicio de sesión" drafted so that its session check is a control pendiente: the example Seguridad closes with Auth. */
const LOGIN = { name: 'Inicio de sesión', summary: 'Recibe usuario y contraseña, abre la sesión del cliente y la verifica en cada compra.' };
const LOGIN_COMPONENTS = [['usuario', 'contraseña', 'sesión'], ['usuario', 'contraseña', 'token'], ['formulario', 'sesión'], ['usuario', 'clave', 'sesión'], ['correo', 'contraseña', 'sesión'], ['usuario', 'sesión']];
export function loginDesign(seed: number) {
  const components = LOGIN_COMPONENTS.find(list => designPending(seed, LOGIN.name, list).includes('auth')) ?? LOGIN_COMPONENTS[0];
  return { ...LOGIN, components, pending: designPending(seed, LOGIN.name, components) };
}
const loginChange = (x: Context) => x.g.changes.find(ch => ch.companyId === x.c.id && ch.artifactRefs?.length && !['STALE', 'QA_REJECTED'].includes(ch.status));
const loginNode = (graph: Graph) => graph.nodes.find(n => n.type === 'module');

/** QA, the CTO and DevOps start from an assembled company with a change already through Backend and Seguridad. */
/** `control`: Seguridad reviews with WAF on Write Stock, so the lab's Concurrencia runs in staging and leaves a test
 * QA can mark (without modules or controls it runs the historical fixture, which only reports). */
function deliverChange(x: Context, control = false) {
  assemble(x.g);
  script(x.p, as('backend', x.c.id), 'change.submit', { graph: withAtomic(x.c.backend), revision: x.c.drafts.backend?.revision ?? 0 });
  const ch = practiceChange(x)!, review = () => x.c.runtime.collaboration!.reviews[ch.id];
  if (control) script(x.p, as('security', x.c.id), 'security.configure', { changeId: ch.id, nodeId: ch.graph.nodes.find(n => n.type === 'write')!.id, revision: review().revision, rules: [{ kind: 'input' }] });
  script(x.p, as('security', x.c.id), 'security.submit', { changeId: ch.id, revision: review().revision });
}
function approveChange(x: Context) {
  const ch = practiceChange(x)!;
  script(x.p, as('qa', x.c.id), 'qa.execute', { changeId: ch.id, scenario: CONCURRENCY_CASE });
  fastForward(x.g, () => !!caseRun(x));
  script(x.p, as('qa', x.c.id), 'qa.review', { changeId: ch.id, risks: 'Caso de concurrencia: 2 compras simultáneas sobre 1 unidad, sin sobreventa.', evidenceIds: [caseRun(x)!.id] });
}
/** The scope this CTO authorized, not the minimum one every company starts with. */
const ctoScope = (x: Context) => { const scope = activeScope(x.c, x.g.tick); return scope?.kind === 'cto' && scope.authorizedBy === x.identity.id ? scope : undefined; };
/** The CTO guionado renews DevOps's scope when it lapses, so a student who took a while is never locked out. */
function keepScope(x: Context) { const scope = activeScope(x.c, x.g.tick); if (!scope || !scope.operations.includes('scale') || !scope.operations.includes('balancer')) script(x.p, as('cto', x.c.id), 'cto.infra_authorize', DEVOPS_SCOPE); }
const DEVOPS_SCOPE = { amount: 300, durationSeconds: 900, maxServers: 3, operations: ['scale', 'balancer'] };
const ack = () => null;

const SCRIPTS: Record<TutorialRole, RoleScript> = {
  backend: { steps: {
    'backend-publicar': {
      // Any route that can take a purchase closes the montaje for good, so any such route completes the step:
      // asking for the drawn order after that would leave the student with nothing left to publish.
      done: x => !x.c.assembly.active && sellCapable(x.c.plan),
      facts: x => x.c.version > 1 && x.c.assembly.active ? ['El plano publicado todavía no lleva la compra de la Tienda web a la Salida por Checkout, Inventario y Pagos. Revisá los caminos y publicá otra vez.'] : [],
      solve: (s, me) => ({ type: 'plan.publish', companyId: me.companyId!, payload: { graph: extendPlan(s.privateCompany!.plan, ['web', 'checkout', 'inventory', 'payment', 'exit']), revision: s.privateCompany!.planDrafts?.backend?.revision ?? 0 } }),
    },
    'backend-sobreventa': {
      // The scripted market sends two customers for the last unit at once; the plan has no protection yet.
      enter: x => { if (!x.c.concurrency.run) startConcurrency(x.c, x.g.tick); },
      ready: x => !!x.c.concurrency.run && isRunFinished(x.c.concurrency.run) && x.c.concurrency.run.requests.every(r => r.accounted),
      waiting: x => x.c.concurrency.run && isRunFinished(x.c.concurrency.run) ? undefined : 'Llegan dos compras a la vez por la última unidad…',
      facts: x => { const r = x.c.concurrency.run; if (!r || !isRunFinished(r)) return []; const done = r.requests.filter(q => q.result?.status === 'COMPLETED').length; return [`Última unidad: ${plural(done, 'compra completada', 'compras completadas')} sobre ${plural(r.inventory.initialStock, 'unidad', 'unidades')} · ${plural(r.inventory.oversold, 'sobreventa', 'sobreventas')}.`]; },
    },
    'backend-atomic': {
      // A practice rebuilt past this step (a restart, EMPEZAR DE NUEVO) gets the block the student put with PONER.
      solve: (s, me) => { const draft = s.privateCompany!.drafts.backend; const graph = draft?.graph ?? s.privateCompany!.backend;
        return atomicBetween(graph) ? null : { type: 'draft.save', companyId: me.companyId!, payload: { graph: withAtomic(graph), revision: draft?.revision ?? 0 } }; },
    },
    'backend-enviar': {
      done: x => x.g.changes.some(ch => ch.companyId === x.c.id && ch.domain === 'backend' && ch.actorId === x.identity.id && !['STALE', 'QA_REJECTED'].includes(ch.status) && atomicBetween(ch.graph)),
      // A change without the fix would lock the student's logic until QA returns it: the scripted QA does so at once.
      sustain: x => {
        const lock = x.c.runtime.workflow?.backendLock, ch = lock && x.g.changes.find(c => c.id === lock.changeId);
        if (!ch || atomicBetween(ch.graph)) return;
        script(x.p, as('qa', x.c.id), 'change.cancel', { changeId: ch.id, reason: 'Práctica: falta Atomic Update entre Read Stock y Write Stock.', confirmed: true });
        x.p.notes = ['QA te devolvió el cambio: falta Atomic Update entre Read Stock y Write Stock. Corregilo y enviá otra vez.'];
      },
      facts: x => x.p.notes.length ? x.p.notes : atomicBetween(x.c.drafts.backend?.graph ?? x.c.backend) ? [] : ['Tu borrador todavía no tiene Atomic Update: tocá la pieza Inventario y PONER en Atomic Update.'],
      solve: (s, me) => ({ type: 'change.submit', companyId: me.companyId!, payload: { graph: fixed(s.privateCompany!.drafts.backend?.graph ?? s.privateCompany!.backend), revision: s.privateCompany!.drafts.backend?.revision ?? 0 } }),
    },
  } },
  security: { steps: {
    'seguridad-publicar': {
      done: x => types(x.c.plan).slice(0, 3).join() === 'entry,security,web',
      facts: x => x.c.version > 1 && types(x.c.plan).slice(0, 3).join() !== 'entry,security,web' ? ['El plano publicado no pasa por el perímetro: el camino tiene que ser Entrada → Seguridad → Tienda web.'] : [],
      solve: (s, me) => ({ type: 'plan.publish', companyId: me.companyId!, payload: { graph: extendPlan(s.privateCompany!.plan, ['entry', 'security', 'web']), revision: s.privateCompany!.planDrafts?.security?.revision ?? 0 } }),
    },
    'seguridad-cambio': {
      // Backend finishes its part of the plan (the first sale closes the montaje) and delivers the sign-in module.
      enter: x => {
        if (loginChange(x)) return;
        if (x.c.assembly.active) script(x.p, as('backend', x.c.id), 'plan.publish', { graph: extendPlan(x.c.plan, ['web', 'checkout', 'inventory', 'payment', 'exit']), revision: x.c.planDrafts.backend?.revision ?? 0 });
        const { name, summary, components, pending } = loginDesign(x.g.seed);
        script(x.p, as('backend', x.c.id), 'module.design', { name, summary, components, pending });
      },
    },
    'seguridad-controles': {
      done: x => { const ch = loginChange(x), node = ch && loginNode(ch.graph), kinds = new Set(node ? x.c.runtime.collaboration?.reviews[ch!.id]?.blocks[node.id]?.rules.map(r => r.kind) : []); return ['authenticated', 'owner', 'input', 'bot'].every(k => kinds.has(k as never)); },
      facts: x => {
        const ch = loginChange(x), node = ch && loginNode(ch.graph), blocks = ch ? x.c.runtime.collaboration?.reviews[ch.id]?.blocks ?? {} : {};
        if (!node) return [];
        const own = new Set(blocks[node.id]?.rules.map(r => r.kind) ?? []), names = { authenticated: 'Auth', owner: 'Role Check', input: 'WAF', bot: 'Bot Detection' } as const;
        if (!own.size && Object.keys(blocks).length) return ['Guardaste controles en otro bloque: el que se puede saltear es Inicio de sesión.'];
        const missing = (Object.keys(names) as (keyof typeof names)[]).filter(k => !own.has(k)).map(k => names[k]);
        return own.size && missing.length ? [`En Inicio de sesión falta marcar: ${missing.join(', ')}.`] : [];
      },
      solve: (s, me) => { const ch = s.changes.find(c => c.artifactRefs?.length && c.status === 'SECURITY_PENDING')!, node = loginNode(ch.graph)!; return { type: 'security.configure', companyId: me.companyId!, payload: { changeId: ch.id, nodeId: node.id, revision: s.operations!.collaboration!.reviews[ch.id].revision, rules: [{ kind: 'authenticated' }, { kind: 'owner' }, { kind: 'input' }, { kind: 'bot' }] } }; },
    },
    'seguridad-entregar': {
      done: x => { const ch = loginChange(x); return !!ch?.implementation?.security && ch.status !== 'SECURITY_PENDING'; },
      solve: (s, me) => { const ch = s.changes.find(c => c.artifactRefs?.length && c.status === 'SECURITY_PENDING')!; return { type: 'security.submit', companyId: me.companyId!, payload: { changeId: ch.id, revision: s.operations!.collaboration!.reviews[ch.id].revision } }; },
    },
  } },
  qa: { setup: x => deliverChange(x, true), steps: {
    'qa-ejecutar': {
      done: x => !!caseRun(x),
      waiting: x => practiceChange(x)?.status === 'QA_RUNNING' ? 'La prueba está corriendo en staging…' : undefined,
      facts: x => { const ch = practiceChange(x), runs = x.c.runtime.workflow?.runs.filter(r => r.changeId === ch?.id && r.report) ?? []; return runs.length && !caseRun(x) ? ['Esa prueba no fue Concurrencia: tocá Concurrencia y después PROBAR.'] : []; },
      solve: s => ({ type: 'qa.run', companyId: s.identity!.companyId!, changeId: s.changes.find(c => c.implementation && c.status === 'QA_PENDING')!.id, payload: { suite: 'Concurrencia' } }),
    },
    'qa-leer': {
      facts: x => { const r = caseRun(x)?.report; return r ? [`${plural(r.completed, 'compra completada', 'compras completadas')} · ${plural(r.rejected, 'rechazada', 'rechazadas')} · ${plural(r.oversold, 'sobreventa', 'sobreventas')}.`, r.oversold ? 'Hay sobreventa: este cambio no protege la última unidad.' : 'Con Atomic Update solo una compra se cobra y las demás se rechazan por falta de stock: no hay sobreventa.'] : []; },
    },
    'qa-aprobar': {
      done: x => { const ch = practiceChange(x); return !!ch && x.c.runtime.workflow?.decisions.some(d => d.changeId === ch.id && d.kind === 'qa.approve' && d.actor === x.identity.id) === true; },
      solve: s => { const ch = s.changes.find(c => c.implementation && c.status === 'QA_PENDING')!, runId = s.operations!.workflow!.runs.filter(r => r.changeId === ch.id).at(-1)!.id; return { type: 'qa.review', companyId: s.identity!.companyId!, payload: { changeId: ch.id, risks: 'Probé 2 compras simultáneas sobre la última unidad: una completa, otra rechazada, sin sobreventa.', evidenceIds: [runId] } }; },
    },
  } },
  cto: { setup: x => { deliverChange(x); approveChange(x); script(x.p, as('devops', x.c.id), 'infra.request_budget', DEVOPS_SCOPE); }, steps: {
    'cto-alcance': {
      done: x => { const scope = ctoScope(x); return !!scope && scope.operations.includes('scale') && scope.operations.includes('balancer'); },
      facts: x => { const scope = ctoScope(x); return scope && !(scope.operations.includes('scale') && scope.operations.includes('balancer')) ? ['El alcance que autorizaste no incluye las dos operaciones: marcá ESCALAR y BALANCEADOR.'] : []; },
      solve: s => ({ type: 'cto.infra_authorize', companyId: s.identity!.companyId!, payload: DEVOPS_SCOPE }),
    },
    'cto-decision': {
      done: x => { const ch = practiceChange(x); return !!ch && x.c.runtime.workflow?.decisions.some(d => d.changeId === ch.id && d.kind === 'cto.authorize' && d.actor === x.identity.id) === true; },
      facts: x => { const ch = practiceChange(x), last = ch && x.c.runtime.workflow?.decisions.filter(d => d.changeId === ch.id && d.actor === x.identity.id).at(-1); return last && last.kind !== 'cto.authorize' ? ['Registraste otra decisión y el cambio volvió a QA. Para este paso tocá AUTORIZAR.'] : []; },
      // A request for evidence or a rejection sends the change back to QA; the scripted QA brings it again.
      sustain: x => { const ch = practiceChange(x); if (ch?.status === 'QA_PENDING' && x.c.runtime.workflow?.decisions.some(d => d.changeId === ch.id && d.actor === x.identity.id)) script(x.p, as('qa', x.c.id), 'qa.review', { changeId: ch.id, risks: 'Repetí la revisión con la misma evidencia.', evidenceIds: [caseRun(x)!.id] }); },
      solve: s => ({ type: 'cto.decide', companyId: s.identity!.companyId!, payload: { changeId: s.changes.find(c => c.implementation && c.status === 'CTO_PENDING')!.id, decision: 'authorize', reason: 'QA probó la última unidad sin sobreventa.', confirmed: true } }),
    },
  } },
  devops: { setup: x => { deliverChange(x); approveChange(x); script(x.p, as('cto', x.c.id), 'cto.infra_authorize', DEVOPS_SCOPE); }, steps: {
    'devops-servidor': { enter: keepScope, sustain: keepScope, done: x => x.c.servers >= 2, solve: s => ({ type: 'infra.scale', companyId: s.identity!.companyId!, payload: { delta: 1 } }) },
    'devops-balanceador': { enter: keepScope, sustain: keepScope, done: x => x.c.balancer, solve: s => ({ type: 'infra.balancer', companyId: s.identity!.companyId!, payload: { enabled: true } }) },
    'devops-deploy': {
      // The CTO authorizes when DevOps gets here: an authorization lasts 60 s and expires if nobody deploys.
      enter: x => { const ch = practiceChange(x); if (ch && ['CTO_PENDING', 'EXPIRED'].includes(ch.status)) script(x.p, as('cto', x.c.id), 'cto.decide', { changeId: ch.id, decision: 'authorize', reason: 'Autorizado para la práctica de despliegue.', confirmed: true }); },
      sustain: x => { keepScope(x); const ch = practiceChange(x); if (ch?.status === 'EXPIRED') script(x.p, as('cto', x.c.id), 'cto.decide', { changeId: ch.id, decision: 'authorize', reason: 'La autorización anterior venció; se renueva.', confirmed: true }); },
      done: x => practiceChange(x)?.status === 'DEPLOYED',
      waiting: x => practiceChange(x)?.status === 'DEPLOYING' ? `Desplegando con ${practiceChange(x)!.strategy === 'rolling' ? 'ROLLING' : 'RESTART REPLACE'}…` : undefined,
      solve: s => { const ch = s.changes.find(c => c.status === 'AUTHORIZED'); return ch ? { type: 'deploy.start', companyId: s.identity!.companyId!, changeId: ch.id, payload: { strategy: 'rolling' } } : null; },
    },
  } },
  product: { setup: x => { x.g.productEnabled = true; assemble(x.g); }, steps: {
    'producto-borrador': {
      done: x => productState(x.c).drafts.some(d => d.author === x.identity.id),
      solve: s => ({ type: 'product.draft', companyId: s.identity!.companyId!, payload: { catalogId: PRODUCT_CATALOG[0].id, percent: 10, duration: 60, demandMultiplier: 1.5, budget: 100 } }),
    },
    'producto-enviar': {
      done: x => productState(x.c).drafts.some(d => d.author === x.identity.id && d.status !== 'DRAFT'),
      solve: s => ({ type: 'product.submit', companyId: s.identity!.companyId!, payload: { draftId: s.operations!.product!.drafts.find(d => d.status === 'DRAFT')!.id } }),
    },
  } },
  auditor: { setup: x => assemble(x.g), steps: {
    'auditor-prueba': {
      done: x => (x.g.auditors?.probes ?? []).some(probe => probe.auditorId === x.identity.id),
      solve: s => { const company = s.auditor!.companies.find(c => !c.eliminated && !c.assembling && c.modules.some(m => m.pending.length))!, module = company.modules.find(m => m.pending.length)!; return { type: 'audit.probe', payload: { companyId: company.companyId, nodeId: module.nodeId, check: module.pending[0].check } }; },
    },
    'auditor-resultado': {
      ready: x => (x.g.auditors?.probes ?? []).some(probe => probe.auditorId === x.identity.id && probe.finished),
      waiting: x => { const probe = (x.g.auditors?.probes ?? []).filter(pr => pr.auditorId === x.identity.id).at(-1); return probe && !probe.finished ? `La prueba de control está en curso: ${probe.sent}/30 solicitudes enviadas…` : undefined; },
      facts: x => { const probe = (x.g.auditors?.probes ?? []).filter(pr => pr.auditorId === x.identity.id).at(-1); return probe?.finished ? [`${plural(probe.contained, 'contenida', 'contenidas')} · ${plural(probe.notContained, 'no contenida', 'no contenidas')}.`] : []; },
    },
  } },
};
// Reading and UI steps are solved by acknowledging them, like a student closing the card or reaching the UI state.
for (const role of Object.keys(TUTORIALS) as TutorialRole[]) for (const s of TUTORIALS[role].steps) if (s.kind !== 'action') (SCRIPTS[role].steps[s.id] ??= {}).solve ??= ack;

// ---------------------------------------------------------------------------------------------------------------
// The practice copy

const stepsOf = (identity: Identity) => TUTORIALS[roleOf(identity)!].steps;
const context = (p: Practice): Context => {
  const companyId = p.identity.companyId ?? 0;
  return { p, g: p.game, c: p.game.companies[companyId], identity: p.identity };
};
const scriptFor = (p: Practice, index = p.step): StepScript | undefined => { const s = stepsOf(p.identity)[index]; return s && SCRIPTS[roleOf(p.identity)!].steps[s.id]; };

/** A fresh practice copy at `stepIndex`: the counterparts set the scene, then every earlier step is solved again. */
export function createPractice(real: Pick<GameState, 'seed' | 'generation'>, subject: Subject, stepIndex = 0, copy = 0): Practice {
  const g = createGame(PRACTICE_DURATION, real.seed, real.generation, false, PRACTICE_PACING);
  g.practice = true; g.status = 'RUNNING';
  for (const company of g.companies) issueInitialTraffic(company, g.tick);
  const p: Practice = { key: subject.key, identity: subject.identity, game: g, step: 0, seq: 0, notes: [], copy };
  const x = context(p);
  SCRIPTS[roleOf(subject.identity)!].setup?.(x);
  scriptFor(p)?.enter?.(x);
  while (p.step < stepIndex && p.step < stepsOf(p.identity).length) {
    const s = scriptFor(p)!, solution = s.solve?.(practiceProjection(p), p.identity);
    if (solution) run(p, p.identity, solution.type, solution.payload ?? {}, solution.changeId);
    fastForward(g, () => { s.sustain?.(x); return isComplete(p); }, 60);
    p.step++; p.notes = []; scriptFor(p)?.enter?.(x);
  }
  return p;
}

/** A script that throws is a bug in the guion: it is logged and the step simply does not move. */
function guarded<T>(fallback: T, run: () => T): T { try { return run(); } catch (e) { console.error('Guion de práctica:', e); return fallback; } }
/** Action steps are complete when the copy shows the confirmed result; read and UI steps only by acknowledgement. */
function isComplete(p: Practice): boolean {
  const meta = stepsOf(p.identity)[p.step], s = scriptFor(p);
  if (!meta) return true;
  if (meta.kind === 'action') return guarded(false, () => !!s?.done?.(context(p)));
  return guarded(false, () => !s?.ready || s.ready(context(p)));
}
function advance(p: Practice): boolean {
  if (p.step >= stepsOf(p.identity).length) return false;
  p.step++; p.notes = [];
  guarded(undefined, () => scriptFor(p)?.enter?.(context(p)));
  return true;
}
/** After a practice command or tick: moves on as many action steps as the copy already satisfies. */
export function settle(p: Practice): boolean {
  let moved = false;
  while (stepsOf(p.identity)[p.step]?.kind === 'action' && isComplete(p)) moved = advance(p) || moved;
  return moved;
}
/** Applies a student command to the practice copy with the real validation. */
export function practiceCommand(p: Practice, command: Command): Result {
  const result = applyCommand(p.game, p.identity, command);
  return result;
}
/** A read or UI step closed by the student. Returns false when it is not the current step or not ready yet. */
export function acknowledge(p: Practice, stepId: string): boolean {
  const meta = stepsOf(p.identity)[p.step];
  if (!meta || meta.id !== stepId || meta.kind === 'action' || !isComplete(p)) return false;
  return advance(p);
}
/** One server iteration: the copy's clock runs faster while the engine works on the student's action. */
export function tickPractice(p: Practice): boolean {
  const s = scriptFor(p), x = context(p), speed = s?.waiting?.(x) ? PRACTICE_SPEED.waiting : PRACTICE_SPEED.working;
  for (let i = 0; i < speed && p.game.status === 'RUNNING'; i++) step(p.game);
  guarded(undefined, () => s?.sustain?.(x));
  return settle(p);
}
export const practiceExpired = (p: Practice) => p.game.status !== 'RUNNING';
export const practiceFinished = (p: Practice) => p.step >= stepsOf(p.identity).length;

export function tutorialView(p: Practice): TutorialView {
  const steps = stepsOf(p.identity), meta = steps[Math.min(p.step, steps.length - 1)], s = scriptFor(p), x = context(p);
  const waiting = guarded(undefined, () => s?.waiting?.(x));
  return { role: roleOf(p.identity)!, step: p.step, total: steps.length, stepId: meta.id, ready: isComplete(p), facts: guarded([], () => s?.facts?.(x) ?? []), ...(waiting ? { waiting } : {}) };
}
const practiceProjection = (p: Practice) => project(p.game, p.identity);
/** What the student's workspace receives while practicing: the copy as the real UI expects it, plus the step. */
export function practiceSnapshot(p: Practice, realGeneration: number): Snapshot {
  return { ...practiceProjection(p), generation: PRACTICE_GENERATION + realGeneration * 1000 + p.copy % 1000, tutorial: tutorialView(p) };
}
/** The canonical action for the current step, for tests and for rebuilding a copy. `null` means acknowledge it. */
export function solutionFor(snapshot: Snapshot): Omit<Command, 'id'> | null {
  const view = snapshot.tutorial, identity = snapshot.identity;
  if (!view || !identity) return null;
  return SCRIPTS[view.role].steps[view.stepId]?.solve?.(snapshot, identity) ?? null;
}
