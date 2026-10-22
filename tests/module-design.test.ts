import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame, project } from '../server/engine.js';
import { EXECUTOR_SYSTEM, commandsFor, executorContext, finalReply, outcome, planCalls, systemFor, toolsFor } from '../server/executor.js';
import { buildRequest } from '../server/executor-service.js';
import { designPending, sanitizeDesign } from '../server/design.js';
import { pendingControls } from '../server/auditor.js';
import { route } from '../server/graphs.js';
import { DEFAULT_TEST } from '../shared/actions.js';
import { command, advanceGame } from './helpers.js';
import type { GameState, Identity, Role } from '../shared/types.js';
import type { ToolCall } from '../shared/executor.js';

const actor = (role: Role, companyId = 0): Identity => ({ id: `${companyId}-${role}`, role, companyId });
const start = () => { const g = createGame(); assert(command(g, 'operator', 'room.start').ok); return g; };
let sequence = 0;
function run(g: GameState, role: Role, text: string, calls: ToolCall[]) {
  const who = actor(role), ctx = executorContext(g, who, { id: `design-${++sequence}`, text }, []);
  const plan = planCalls(calls, ctx);
  const outcomes = commandsFor(plan, ctx).map(({ planned, command: cmd }) => outcome(planned.tool!, planned, applyCommand(g, who, cmd), g));
  return { ...finalReply(plan, outcomes), plan, outcomes };
}
const COMPONENTS = ['usuario', 'contraseña', 'token'];
const design = (nombre: string, citas: string[], descripcion = 'El usuario envía su contraseña y recibe un token para las compras siguientes.', componentes = COMPONENTS): ToolCall =>
  ({ name: 'backend_disenar_modulo', input: { nombre, componentes, descripcion, citas } });
/** Designs used below and the controles pendientes the server leaves on them (seed 7357). */
const LOGIN = 'Inicio de sesión', SIGNUP = 'Registro de clientes', RECOVERY = 'Recuperación de contraseña';

test('Backend describes a module; Claude drafts it in words and the server leaves controles pendientes', () => {
  const g = start(), c = g.companies[0], text = 'Necesito un módulo de inicio de sesión';
  const reply = run(g, 'backend', text, [design(LOGIN, ['Necesito un módulo de inicio de sesión'])]);
  assert.equal(reply.state, 'EXECUTED', reply.message);
  assert.match(reply.message, /Diseño de «Inicio de sesión» · componentes: usuario, contraseña, token\./);
  assert.match(reply.message, /recibe un token/); assert.match(reply.message, /enviado a Seguridad \(CH-001\)/);
  assert.doesNotMatch(reply.message, /WAF|Auth|Role Check|pendiente/i, 'Backend is not told which controls were left pending');
  const [module] = Object.values(c.runtime.modules).flat();
  assert.equal(module.name, LOGIN); assert.deepEqual(module.configuration, { kind: 'purchase', idempotent: false });
  assert.deepEqual(module.design, { components: COMPONENTS, summary: 'El usuario envía su contraseña y recibe un token para las compras siguientes.' });
  assert.deepEqual(designPending(g.seed, LOGIN, COMPONENTS), ['auth', 'role_check', 'waf']);
  assert.deepEqual(module.defects.map(d => [d.code, d.profile]), [['D05', 'design-1'], ['D08', 'design-1']]);
  const ch = g.changes[0];
  assert.equal(ch.status, 'SECURITY_PENDING'); assert(ch.graph.nodes.some(n => n.type === 'module' && n.data.label === LOGIN));
  // The company sees the design, never the simulated defects.
  const own = project(g, actor('backend')).operations!.modules[0] as Record<string, unknown>;
  assert.deepEqual(own.design, module.design); assert.equal(own.defects, undefined);
});

test('the choice is the server’s: deterministic, recorded in the payload and verified on apply', () => {
  const g = start(), reply = run(g, 'backend', 'Necesito un módulo de registro de clientes', [design(SIGNUP, ['módulo de registro de clientes'])]);
  assert.equal(reply.state, 'EXECUTED', reply.message);
  assert.deepEqual(reply.plan.commands[0].payload.pending, ['waf']);
  assert.deepEqual(designPending(7357, SIGNUP, COMPONENTS), designPending(7357, ' registro de CLIENTES ', ['Usuario', 'contrasena', 'TOKEN']), 'case and accents do not change the draw');
  assert.deepEqual(designPending(7357, RECOVERY, COMPONENTS), ['auth', 'role_check']);
  // A command that tries to choose its own pendientes (or none) is refused without creating anything.
  const before = structuredClone(g.companies[0].runtime.modules);
  const g2 = start();
  for (const pending of [['auth'], ['waf', 'auth', 'role_check'], []]) {
    const r = command(g2, 'backend', 'module.design', { name: SIGNUP, components: COMPONENTS, summary: 'Alta de clientes.', pending });
    assert.equal(r.ok, false, JSON.stringify(pending));
  }
  assert.deepEqual(g2.companies[0].runtime.modules, {}); assert.equal(g2.changes.length, 0);
  assert.equal(command(g2, 'backend', 'module.design', { name: SIGNUP, components: COMPONENTS, summary: 'Alta de clientes.', pending: ['waf'] }).ok, true, 'the UI can send the same command; the server still decides');
  assert.deepEqual(Object.keys(before).length, 1);
});

test('designs are words only and must be the module the student described', () => {
  const g = start(), text = 'Necesito un módulo de inicio de sesión';
  const code = run(g, 'backend', text, [design(LOGIN, [text], 'function login(user) { return token; }')]);
  assert.equal(code.state, 'REJECTED'); assert.match(code.message, /sin código/);
  assert.equal(run(g, 'backend', text, [design(LOGIN, [text], 'Valida usuario.', ['SELECT * FROM usuarios'])]).state, 'REJECTED');
  assert.equal(run(g, 'backend', text, [design(LOGIN, [text], 'Valida usuario.', [])]).state, 'REJECTED');
  assert.equal(run(g, 'backend', text, [design('Pasarela de pagos', [text])]).state, 'NEEDS_INPUT', 'a module the student never asked for');
  assert.equal(run(g, 'backend', 'No necesito un módulo de inicio de sesión', [design(LOGIN, ['un módulo de inicio de sesión'])]).state, 'NEEDS_INPUT');
  assert.equal(run(g, 'backend', '¿Hace falta crear un módulo de inicio de sesión?', [design(LOGIN, ['crear un módulo de inicio de sesión'])]).state, 'REJECTED', 'a question never changes state');
  assert.equal(run(g, 'backend', '¿Qué es un módulo de inicio de sesión?', [design(LOGIN, ['módulo de inicio de sesión'])]).state, 'NEEDS_INPUT', 'no order at all');
  assert.equal(run(g, 'backend', text, [design(LOGIN, ['un módulo de pagos'])]).state, 'NEEDS_INPUT', 'invented quotes');
  assert.equal(Object.keys(g.companies[0].runtime.modules).length, 0); assert.equal(g.changes.length, 0);
  assert.throws(() => sanitizeDesign({ nombre: 'Inicio <b>', componentes: ['usuario'], descripcion: 'x' }));
});

test('only Backend gets the design exception; every other role keeps the strict executor', () => {
  assert.match(systemFor('backend'), /Excepción solo para Backend/);
  for (const role of ['security', 'qa', 'cto', 'devops', 'product'] as Role[]) {
    assert.equal(systemFor(role), EXECUTOR_SYSTEM);
    assert(!toolsFor(role).some(t => t.name === 'backend_disenar_modulo'), role);
  }
  const g = start(), r = run(g, 'security', 'Necesito un módulo de inicio de sesión', [design(LOGIN, ['Necesito un módulo de inicio de sesión'])]);
  assert.equal(r.state, 'DECLINED'); assert.equal(g.changes.length, 0); assert.equal(g.actions.employees['0-security'].violations.length, 0);
  const request = buildRequest(g, actor('backend'), { id: 'b-1', text: 'Necesito un módulo de inicio de sesión' }).request;
  assert.equal(request.system, systemFor('backend')); assert(request.tools.some(t => t.name === 'backend_disenar_modulo'));
  assert.equal(buildRequest(g, actor('qa'), { id: 'q-1', text: 'Ejecutá la suite Seguridad' }).request.system, EXECUTOR_SYSTEM);
});

/** Submits the Security review of the change with the given rules on the module node, then runs a QA scenario. */
function securityAndQa(g: GameState, rules: unknown[], scenario = { ...DEFAULT_TEST, suite: 'security' as const, requests: 30, concurrency: 30, attack: 'injection' as const }) {
  const ch = g.changes[0], node = ch.graph.nodes.find(n => n.type === 'module')!;
  if (rules.length) assert(command(g, 'security', 'security.configure', { changeId: ch.id, nodeId: node.id, revision: 0, rules }).ok);
  assert(command(g, 'security', 'security.submit', { changeId: ch.id, revision: rules.length ? 1 : 0 }).ok);
  assert(command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario }).ok); advanceGame(g, 8);
  return { ch, node, report: ch.reports.at(-1)! };
}

test('QA detects a WAF pendiente with the Seguridad suite and returns the change to Backend', () => {
  const g = start();
  assert.equal(run(g, 'backend', 'Necesito un módulo de registro de clientes', [design(SIGNUP, ['módulo de registro de clientes'])]).state, 'EXECUTED');
  const { ch, report } = securityAndQa(g, []);
  assert.equal(report.testEvidence!.passed, false); assert(report.securityOutcomes!.successful > 0, 'injections were admitted in staging');
  const run0 = g.companies[0].runtime.workflow!.runs.at(-1)!;
  assert(command(g, 'qa', 'qa.return', { changeId: ch.id, recipient: 'backend', subject: 'Entrada sin validar', description: 'El módulo acepta entradas inválidas.', steps: 'Suite Seguridad.', observed: 'Compras admitidas.', expected: 'Rechazo.', severity: 'high', evidenceIds: [run0.id], observationRefs: [] }).ok);
  assert.equal(ch.status, 'QA_REJECTED'); assert.equal(g.companies[0].runtime.workflow!.backendLock, undefined);
});

test('Seguridad can add the missing control: WAF on the module contains the same suite', () => {
  const g = start();
  assert.equal(run(g, 'backend', 'Necesito un módulo de registro de clientes', [design(SIGNUP, ['módulo de registro de clientes'])]).state, 'EXECUTED');
  const { report } = securityAndQa(g, [{ kind: 'input' }]);
  assert.equal(report.testEvidence!.passed, true); assert.equal(report.securityOutcomes!.blocked, 30);
});

test('a pendiente nobody catches reaches production and the auditors see it there', () => {
  const g = start();
  assert.equal(run(g, 'backend', 'Necesito un módulo de recuperación de contraseña', [design(RECOVERY, ['módulo de recuperación de contraseña'])]).state, 'EXECUTED');
  // The module validates input by itself, so the injection suite passes and QA approves.
  const { ch, node, report } = securityAndQa(g, []);
  assert.equal(report.testEvidence!.passed, true);
  assert(command(g, 'qa', 'qa.approve', {}, ch.id).ok); assert(command(g, 'cto', 'cto.authorize', {}, ch.id).ok);
  assert(command(g, 'devops', 'deploy.start', { strategy: 'rolling' }, ch.id).ok); advanceGame(g, 7); assert.equal(ch.status, 'DEPLOYED');
  const c = g.companies[0], production = route(c.backend).find(n => n.id === node.id)!;
  assert.deepEqual(pendingControls(c, production).map(p => p.check), ['auth', 'role_check', 'bot_detection', 'rate_limit']);
  const auditor: Identity = { id: 'auditor-P30', role: 'auditor', companyId: null };
  const view = project(g, auditor).auditor!.companies[0].modules.find(m => m.nodeId === node.id)!;
  assert.equal(view.label, RECOVERY); assert(view.module);
  assert(applyCommand(g, auditor, { id: 'p-1', type: 'audit.probe', payload: { companyId: 0, nodeId: node.id, check: 'role_check' } }).ok);
  advanceGame(g, 31);
  const probe = g.auditors!.probes[0];
  assert.equal(probe.notContained, 30, 'forged identities pass the module and no Auth/Role Check was configured');
});

test('a direct module.design command runs the same sanitizer as the executor', () => {
  const g = start();
  for (const payload of [
    { name: 'Login {inyectado}', components: COMPONENTS, summary: 'Alta de clientes.', pending: ['waf'] },
    { name: 'Registro de clientes', components: ['usuario; DROP'], summary: 'Alta de clientes.', pending: ['waf'] },
    { name: 'Registro de clientes', components: COMPONENTS, summary: 'function x() { return 1; }', pending: ['waf'] },
  ]) assert.equal(command(g, 'backend', 'module.design', payload).ok, false, JSON.stringify(payload));
  assert.equal(g.changes.length, 0); assert.deepEqual(g.companies[0].runtime.modules, {});
});
