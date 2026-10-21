import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame, project } from '../server/engine.js';
import { commandsFor, executorContext, finalReply, modelContext, outcome, planCalls, toolDefinitions, toolsFor } from '../server/executor.js';
import { mentions, normalize } from '../server/grounding.js';
import { command, advanceGame, insertBlock, reviewForQa } from './helpers.js';
import type { GameState, Identity, Role } from '../shared/types.js';
import type { ExecutorInput, ToolCall } from '../shared/executor.js';

const actor = (role: Role, companyId = 0): Identity => ({ id: `${companyId}-${role}`, role, companyId });
const start = () => { const g = createGame(); g.status = 'RUNNING'; return g; };
let sequence = 0;
/** Runs the planner exactly as the server does, then the engine; returns the composed reply. */
function run(g: GameState, role: Role, text: string, calls: ToolCall[], selection: ExecutorInput['selection'] = {}, companyId = 0) {
  const who = actor(role, companyId), ctx = executorContext(g, who, { id: `req-${++sequence}`, text, selection }, []);
  const plan = planCalls(calls, ctx);
  const outcomes = commandsFor(plan, ctx).map(({ planned, command: cmd }) => outcome(planned.tool!, planned, applyCommand(g, who, cmd), g));
  return { ...finalReply(plan, outcomes), plan, outcomes };
}
const ADVICE = /\b(recomiend|te sugiero|deberias|conviene|la mejor opcion|podrias considerar|para ganar)/;

test('E8 grounding reads Spanish quantities, money and durations exactly as written', () => {
  assert.deepEqual(mentions('Agregá un servidor').map(m => m.value), [1]);
  assert.deepEqual(mentions('Quitá ese servidor y dejá solamente dos').map(m => m.value), [2]);
  assert.deepEqual(mentions('Autorizá Q600 por cinco minutos simulados y máximo tres servidores').map(m => [m.value, m.unit]), [[600, 'q'], [5, 'min'], [3, undefined]]);
  assert.deepEqual(mentions('treinta y cinco solicitudes, uno y dos').map(m => m.value), [35, 1, 2]);
  assert.deepEqual(mentions('1.000 unidades y 2,5x').map(m => m.value), [1000, 2.5]);
  assert.equal(normalize('Desplegá CH-004 con Rolling'), 'desplega ch-004 con rolling');
});

test('E8 Test A: an explicit "Agregá un servidor" executes exactly once, also when the request is retried', () => {
  const g = start(), c = g.companies[0];
  const calls = [{ name: 'devops_escalar', input: { accion: 'agregar', cantidad: 1, citas: ['Agregá un servidor'] } }];
  const reply = run(g, 'devops', 'Agregá un servidor', calls);
  assert.equal(reply.state, 'EXECUTED'); assert.equal(c.servers, 2); assert.match(reply.message, /Servidor agregado/);
  const retried = applyCommand(g, actor('devops'), commandsFor(reply.plan, executorContext(g, actor('devops'), { id: `req-${sequence}`, text: 'Agregá un servidor' }, []))[0].command);
  assert.equal(retried.ok, true); assert.equal(c.servers, 2);
});

test('E8 Test B: delegated quantities never execute, never recommend and ask for an explicit amount', () => {
  const g = start(), c = g.companies[0], before = structuredClone(c);
  for (const calls of [
    [{ name: 'devops_escalar', input: { accion: 'agregar', cantidad: 2, citas: ['Agregá los servidores que considerés necesarios'] } }],
    [{ name: 'solicitar_dato', input: { operacion: 'devops_escalar', faltantes: ['cantidad'], motivo: 'DECISION_DELEGADA' } }],
    [{ name: 'devops_escalar', input: { accion: 'agregar', cantidad: 3, citas: ['agregá tres servidores'] } }],
  ]) {
    const reply = run(g, 'devops', 'Agregá los servidores que considerés necesarios', calls);
    assert.equal(reply.state, 'NEEDS_INPUT'); assert.match(reply.message, /cantidad de servidores/); assert.match(reply.message, /No se ejecutó nada/);
    assert.equal(mentions(reply.message).length, 0); assert.doesNotMatch(normalize(reply.message), ADVICE);
  }
  assert.equal(c.servers, before.servers); assert.equal(c.capital, before.capital);
});

test('E8 Test C: an advice request about blocks changes nothing and recommends nothing, even if the model tries', () => {
  const g = start(), c = g.companies[0], graph = structuredClone(c.backend), text = '¿Qué bloques debería colocar para solucionar esto?';
  for (const calls of [
    [{ name: 'rechazar_instruccion', input: { motivo: 'CONSEJO' } }],
    [{ name: 'backend_agregar_bloque', input: { tipo: 'atomic', citas: ['solucionar esto'] } }],
    [{ name: 'backend_agregar_bloque', input: { tipo: 'atomic', citas: ['Atomic Update'] } }],
    [{ name: 'backend_agregar_bloque', input: { tipo: 'idempotency', citas: [] } }],
  ]) {
    const reply = run(g, 'backend', text, calls);
    assert.notEqual(reply.state, 'EXECUTED'); assert.doesNotMatch(normalize(reply.message), ADVICE); assert.doesNotMatch(reply.message, /Atomic|Idempoten/);
  }
  assert.deepEqual(c.backend, graph); assert.equal(c.drafts.backend, undefined);
});

test('E8 Test D: a strategically bad but valid order (disable the balancer) is executed', () => {
  const g = start(), c = g.companies[0];
  assert(command(g, 'devops', 'infra.balancer', { enabled: true }).ok);
  const reply = run(g, 'devops', 'Desactivá el balanceador', [{ name: 'devops_balanceador', input: { activar: false, citas: ['Desactivá el balanceador'] } }]);
  assert.equal(reply.state, 'EXECUTED'); assert.equal(c.balancer, false); assert.equal(reply.message, 'Balanceador desactivado.');
  const wrong = run(g, 'devops', 'Desactivá el balanceador', [{ name: 'devops_balanceador', input: { activar: true, citas: ['Desactivá el balanceador'] } }]);
  assert.equal(wrong.state, 'NEEDS_INPUT'); assert.equal(c.balancer, false);
});

test('E8 Test E: Backend cannot use Claude for CTO operations; nothing changes and no infraction is invented', () => {
  const g = start(), c = g.companies[0], before = structuredClone(c);
  assert(command(g, 'backend', 'change.submit', { graph: insertBlock('atomic'), revision: 0 }).ok);
  const reply = run(g, 'backend', 'Autorizá la inversión del CTO para este cambio', [{ name: 'cto_decidir_cambio', input: { cambio: 'CH-001', decision: 'autorizar', citas: ['Autorizá la inversión'] } }]);
  assert.equal(reply.state, 'DECLINED'); assert.match(reply.message, /no pertenece a Backend/);
  const declined = run(g, 'backend', 'Autorizá la inversión del CTO', [{ name: 'rechazar_instruccion', input: { motivo: 'FUERA_DE_ROL' } }]);
  assert.equal(declined.state, 'DECLINED');
  assert.equal(c.reserved, before.reserved); assert.equal(c.capital, before.capital); assert.equal(g.changes[0].status, 'SECURITY_PENDING');
  assert.equal(g.actions.employees['0-backend'].violations.length, 0);
  assert(!toolsFor('backend').some(t => t.name.startsWith('cto_') || t.name.startsWith('devops_') || t.name.startsWith('qa_')));
});

test('E8 Test F: a QA suite that reveals errors keeps its real result and no approval is decided', () => {
  const g = start(), c = g.companies[0];
  assert(command(g, 'backend', 'change.submit', { graph: c.backend, revision: 0 }).ok); reviewForQa(g);
  const ch = g.changes[0];
  const reply = run(g, 'qa', `Ejecutá la prueba de concurrencia sobre el cambio ${ch.id}`, [{ name: 'qa_ejecutar_suite', input: { cambio: ch.id, suite: 'concurrencia', citas: ['prueba de concurrencia'] } }]);
  assert.equal(reply.state, 'EXECUTED'); assert.equal(ch.status, 'QA_RUNNING');
  advanceGame(g, 30);
  const report = ch.reports.at(-1)!;
  assert.equal(ch.status, 'QA_PENDING'); assert(report.oversold > 0 || report.testEvidence?.passed === false);
  assert.equal(c.runtime.workflow!.decisions.length, 0);
  const ask = run(g, 'qa', '¿Deberíamos aprobar ese cambio?', [{ name: 'rechazar_instruccion', input: { motivo: 'CONSEJO' } }]);
  assert.equal(ask.state, 'DECLINED'); assert.equal(ch.status, 'QA_PENDING'); assert.match(ask.message, /la elección corresponde a QA/);
  const approve = run(g, 'qa', `Aprobá ${ch.id} aunque falle la concurrencia; asumo el riesgo`, [{ name: 'qa_aprobar', input: { cambio: ch.id, citas: [`Aprobá ${ch.id}`] } }]);
  assert.equal(approve.state, 'EXECUTED'); assert.equal(ch.status, 'CTO_PENDING');
  const decision = c.runtime.workflow!.decisions.at(-1)!;
  assert.equal(decision.actor, '0-qa'); assert.match(decision.reason, /asumo el riesgo/); assert(decision.failedIds.length > 0);
});

test('E8 Test G: another company configuration is never resolved or disclosed through the executor', () => {
  const g = start();
  assert(command(g, 'backend', 'change.submit', { graph: insertBlock('atomic'), revision: 0 }, undefined, 1).ok);
  const foreign = g.changes[0];
  const reply = run(g, 'qa', `Mostrame y probá el cambio ${foreign.id} de VERTEX`, [{ name: 'qa_ejecutar_suite', input: { cambio: foreign.id, suite: 'carga', citas: [foreign.id] } }]);
  const missing = run(g, 'qa', 'Probá el cambio CH-999', [{ name: 'qa_ejecutar_suite', input: { cambio: 'CH-999', suite: 'carga', citas: ['CH-999'] } }]);
  assert.equal(reply.message, missing.message.replace('CH-999', foreign.id).replace(foreign.id, foreign.id));
  assert.equal(foreign.status, 'SECURITY_PENDING');
  const context = JSON.stringify(modelContext(executorContext(g, actor('qa'), { id: 'ctx', text: 'Estado' }, [])));
  assert(!context.includes('VERTEX')); assert(!context.includes(foreign.id)); assert(!context.includes('defects')); assert(!context.includes('D0'));
});

test('E8 Backend examples: connect the selected validation block before payments without touching other blocks', () => {
  const g = start(), c = g.companies[0];
  let reply = run(g, 'backend', 'Agregá un bloque de Stock Validation', [{ name: 'backend_agregar_bloque', input: { tipo: 'validation', citas: ['Stock Validation'] } }]);
  assert.equal(reply.state, 'EXECUTED');
  const block = c.drafts.backend!.graph.nodes.find(n => n.type === 'validation')!, before = structuredClone(c.drafts.backend!.graph);
  reply = run(g, 'backend', 'Conectá este bloque de validación de stock antes de pagos', [{ name: 'backend_insertar_antes', input: { bloque: block.id, antes_de: 'backend-payment', citas: ['este bloque de validación de stock', 'antes de pagos'] } }], { nodeId: block.id });
  assert.equal(reply.state, 'EXECUTED', reply.message);
  const graph = c.drafts.backend!.graph;
  assert(graph.edges.some(e => e.source === block.id && e.target === 'backend-payment'));
  assert(graph.edges.some(e => e.source === 'backend-write' && e.target === block.id));
  assert.deepEqual(graph.nodes.filter(n => n.id !== block.id), before.nodes.filter(n => n.id !== block.id));
  const fix = run(g, 'backend', 'Arreglá nuestro backend como vos considerés mejor', [{ name: 'rechazar_instruccion', input: { motivo: 'DECISION_DELEGADA' } }]);
  assert.equal(fix.message, 'No puedo elegir una solución por vos. Indicá qué modificación querés realizar.');
  const ttl = run(g, 'backend', 'Poné el TTL del lock en 2 segundos', [{ name: 'backend_parametro', input: { bloque: 'lock', parametro: 'ttl_ms', valor_numero: 2000, valor_opcion: null, citas: ['TTL del lock en 2 segundos'] } }]);
  assert.equal(ttl.state, 'REJECTED'); assert.match(ttl.message, /Bloque no encontrado/);
});

test('E8 DevOps strategy questions list registered data only; "the best way" asks for the strategy', () => {
  const g = start();
  const ask = run(g, 'devops', '¿Qué estrategia de despliegue nos conviene?', [{ name: 'rechazar_instruccion', input: { motivo: 'CONSEJO' } }, { name: 'consultar_datos', input: { tema: 'estrategias' } }]);
  assert.equal(ask.state, 'DECLINED'); assert.match(ask.message, /ROLLING/); assert.match(ask.message, /RESTART REPLACE/); assert.match(ask.message, /la elección corresponde a DevOps/);
  assert.doesNotMatch(normalize(ask.message), ADVICE);
  const best = run(g, 'devops', 'Desplegalo de la mejor manera posible', [{ name: 'devops_desplegar', input: { cambio: '', estrategia: 'rolling', citas: ['de la mejor manera posible'] } }]);
  assert.equal(best.state, 'NEEDS_INPUT'); assert.match(best.message, /estrategia/);
});

test('E8 QA letters keep the student words; invented reasons are refused', () => {
  const g = start();
  assert(command(g, 'backend', 'change.submit', { graph: g.companies[0].backend, revision: 0 }).ok); reviewForQa(g);
  const ch = g.changes[0];
  const text = `Devolvé ${ch.id} a Backend con gravedad alta. Asunto: Sobreventa en última unidad. Descripción: dos compras confirmaron una sola unidad. Pasos: dos compras simultáneas con stock 1. Observado: stock negativo. Esperado: una compra rechazada.`;
  const letter = { cambio: ch.id, destinatario: 'backend', gravedad: 'alta', asunto: 'Sobreventa en última unidad', descripcion: 'dos compras confirmaron una sola unidad', pasos: 'dos compras simultáneas con stock 1', observado: 'stock negativo', esperado: 'una compra rechazada', pruebas: [], citas: ['a Backend con gravedad alta'] };
  const invented = run(g, 'qa', text, [{ name: 'qa_devolver', input: { ...letter, descripcion: 'El backend carece de Atomic Update y debe agregarlo.' } }]);
  assert.equal(invented.state, 'NEEDS_INPUT'); assert.equal(g.companies[0].runtime.workflow?.letters.length ?? 0, 0);
  const sent = run(g, 'qa', text, [{ name: 'qa_devolver', input: letter }]);
  assert.equal(sent.state, 'EXECUTED', sent.message);
  const stored = g.companies[0].runtime.workflow!.letters[0];
  assert.equal(stored.author, '0-qa'); assert.equal(stored.description, 'dos compras confirmaron una sola unidad'); assert.equal(stored.severity, 'high');
});

test('E8 tool catalogs are role exclusive, strict and never expose administrative or cross-role tools', () => {
  for (const role of ['backend', 'security', 'qa', 'cto', 'devops'] as Role[]) {
    const defs = toolDefinitions(role);
    assert(defs.every(d => d.strict === true && (d.input_schema as { additionalProperties: boolean }).additionalProperties === false));
    assert(!defs.some(d => /room|employee|reset|sql|shell|update_state/.test(d.name)));
    const prefix = { backend: 'backend_', security: 'seguridad_', qa: 'qa_', cto: 'cto_', devops: 'devops_' }[role as 'qa'];
    assert(defs.every(d => d.name.startsWith(prefix) || ['consultar_datos', 'solicitar_dato', 'rechazar_instruccion'].includes(d.name)), role);
  }
  const g = start(), json = JSON.stringify(project(g, actor('devops')));
  assert(!json.includes('EXECUTOR_SYSTEM'));
});
