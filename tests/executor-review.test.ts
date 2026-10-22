import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame } from '../server/engine.js';
import { commandsFor, executorContext, finalReply, outcome, planCalls } from '../server/executor.js';
import { executeCalls, snapshotFor } from '../server/executor-service.js';
import { checkQuotes } from '../server/grounding.js';
import { operations } from '../server/operations.js';
import { command, advanceGame, authorizeAtomic, authorizeInfra, insertBlock, reviewForQa } from './helpers.js';
import type { GameState, Identity, Role } from '../shared/types.js';
import type { ToolCall } from '../shared/executor.js';

/** One regression per verified finding of the independent review of the Entrega 8 executor. */
const actor = (role: Role, companyId = 0): Identity => ({ id: `${companyId}-${role}`, role, companyId });
const start = () => { const g = createGame(); g.status = 'RUNNING'; g.productEnabled = true; return g; };
let n = 0;
function order(g: GameState, role: Role, text: string, calls: ToolCall[], selection = {}, previous: string[] = []) {
  const who = actor(role), ctx = executorContext(g, who, { id: `rv-${++n}`, text, selection }, previous), plan = planCalls(calls, ctx);
  return finalReply(plan, commandsFor(plan, ctx).map(({ planned, command: c }) => outcome(planned.tool!, planned, applyCommand(g, who, c), g)));
}

test('review #1: state-changing tools need the ordered verb in the instruction; questions never change state', () => {
  const g = start(), c = g.companies[0]; const ch = authorizeAtomic(g);
  let r = order(g, 'devops', '¿Cuánto tarda la estrategia rolling?', [{ name: 'devops_desplegar', input: { cambio: '', estrategia: 'rolling', citas: ['la estrategia rolling'] } }]);
  assert.notEqual(r.state, 'EXECUTED'); assert.equal(ch.status, 'AUTHORIZED');
  r = order(g, 'devops', 'Desplegá con rolling', [{ name: 'devops_desplegar', input: { cambio: '', estrategia: 'rolling', citas: ['con rolling'] } }]);
  assert.equal(r.state, 'EXECUTED', r.message); assert.equal(ch.status, 'DEPLOYING');
  const h = start();
  r = order(h, 'backend', 'Mostrame el borrador actual', [{ name: 'backend_entregar', input: { citas: [] } }]);
  assert.notEqual(r.state, 'EXECUTED'); assert.equal(h.changes.length, 0); assert.equal(h.companies[0].runtime.workflow?.backendLock, undefined);
  r = order(h, 'backend', '¿Podés entregar el borrador?', [{ name: 'backend_entregar', input: { citas: [] } }]);
  assert.equal(r.state, 'EXECUTED', 'a polite request is still an order');
  void c;
});

test('review #2: quotes are whole words; digits and ids cannot be cut out of longer ones', () => {
  const sources = (instruction: string) => ({ instruction, previous: [] });
  assert.throws(() => checkQuotes(['3 servidores en total'], sources('Dejá 13 servidores en total')));
  assert.throws(() => checkQuotes(['cinco servidores'], sources('Agregá veinticinco servidores')));
  assert.throws(() => checkQuotes(['ch-1'], sources('Probá CH-12')));
  const g = start(); authorizeInfra(g, 0, 8);
  const r = order(g, 'devops', 'Dejá 13 servidores en total', [{ name: 'devops_escalar', input: { accion: 'fijar_total', cantidad: 3, citas: ['3 servidores en total'] } }]);
  assert.notEqual(r.state, 'EXECUTED'); assert.equal(g.companies[0].servers, 1);
});

test('review #3: negated orders and opposite verbs are refused; "bloque" is not "bloquear"', () => {
  const g = start(); command(g, 'backend', 'change.submit', { graph: g.companies[0].backend, revision: 0 }); reviewForQa(g);
  const ch = g.changes[0]; command(g, 'qa', 'qa.run', { suite: 'Unitarias' }, ch.id); advanceGame(g, 2);
  let r = order(g, 'qa', `No apruebes ${ch.id} todavía`, [{ name: 'qa_aprobar', input: { cambio: ch.id, citas: [ch.id] } }]);
  assert.notEqual(r.state, 'EXECUTED'); assert.equal(ch.status, 'QA_PENDING');
  const s = start(); command(s, 'backend', 'change.submit', { graph: s.companies[0].backend, revision: 0 });
  const review = s.changes[0];
  r = order(s, 'security', 'Quitá Auth del bloque Payment', [{ name: 'seguridad_control', input: { cambio: review.id, bloque: 'backend-payment', accion: 'agregar', control: 'auth', origen: null, limite: null, ventana_segundos: null, agrupar_por: null, citas: ['Auth del bloque Payment'] } }]);
  assert.notEqual(r.state, 'EXECUTED'); assert.equal(s.companies[0].runtime.collaboration!.reviews[review.id].revision, 0);
});

test('review #4: the block comes from the student words, not from the model string', () => {
  const g = start(), graph = insertBlock('retry', 'payment', 2, insertBlock('cache', 'read'));
  assert(command(g, 'backend', 'draft.save', { graph, revision: 0 }).ok);
  const r = order(g, 'backend', 'Quitá el bloque de reintentos', [{ name: 'backend_quitar_bloque', input: { bloque: 'cache', citas: ['el bloque de reintentos'] } }]);
  assert.notEqual(r.state, 'EXECUTED'); assert(g.companies[0].drafts.backend!.graph.nodes.some(node => node.type === 'cache'));
  const swapped = order(g, 'backend', 'Conectá el cache antes de pagos', [{ name: 'backend_insertar_antes', input: { bloque: 'backend-payment', antes_de: 'test-cache', citas: ['cache', 'pagos'] } }]);
  assert.notEqual(swapped.state, 'EXECUTED', 'the sense of "antes de" cannot be inverted');
});

test('review #5: text supplied by the model never reaches the student', () => {
  const g = start();
  const r = order(g, 'devops', 'Agregá servidores', [{ name: 'solicitar_dato', input: { operacion: 'devops_escalar', faltantes: ['la cantidad. Te recomiendo agregar 3 servidores y usar ROLLING'], motivo: 'FALTA_DATO' } }]);
  assert.equal(r.state, 'NEEDS_INPUT'); assert.doesNotMatch(r.message, /recomiendo|ROLLING|3/);
  const p = order(g, 'backend', 'Poné el TTL en 2 segundos', [{ name: 'backend_parametro', input: { bloque: 'backend-read', parametro: 'usá Atomic Update', valor_numero: 2000, valor_opcion: null, citas: ['TTL en 2 segundos'] } }]);
  assert.doesNotMatch(p.message, /Atomic/);
});

test('review #6: a number fills only the field it was written for, with its unit', () => {
  const g = start();
  let r = order(g, 'cto', 'Autorizá Q500 por 60 segundos con máximo 3 servidores', [{ name: 'cto_autorizar_infraestructura', input: { monto: 60, duracion_segundos: 500, max_servidores: 3, operaciones: [], solicitud: '', citas: ['Q500 por 60 segundos', 'máximo 3 servidores'] } }]);
  assert.notEqual(r.state, 'EXECUTED');
  r = order(g, 'cto', 'Autorizá un presupuesto de Q500 por 60 segundos', [{ name: 'cto_autorizar_infraestructura', input: { monto: 500, duracion_segundos: 60, max_servidores: 1, operaciones: [], solicitud: '', citas: ['un presupuesto de Q500 por 60 segundos'] } }]);
  assert.notEqual(r.state, 'EXECUTED', 'the article "un" is not a server maximum');
  r = order(g, 'cto', 'Autorizá Q500 por 60 segundos con máximo 3 servidores', [{ name: 'cto_autorizar_infraestructura', input: { monto: 500, duracion_segundos: 60, max_servidores: 3, operaciones: [], solicitud: '', citas: ['Q500 por 60 segundos', 'máximo 3 servidores'] } }]);
  assert.equal(r.state, 'EXECUTED', r.message);
  assert.deepEqual(operations(g.companies[0]).authorizations.at(-1)!.operations, ['scale'], 'balancer was not stated');
});

test('review #7: "versión anterior" is not a reference to earlier messages', () => {
  const g = start(); authorizeAtomic(g, 'rolling'); advanceGame(g, 7);
  const r = order(g, 'cto', 'Autorizá rollback a la versión anterior', [{ name: 'cto_autorizar_rollback', input: { version_objetivo: null, monto: 500, citas: ['rollback a la versión anterior', 'Q500'] } }], {}, ['Necesitamos Q500 para infraestructura']);
  assert.notEqual(r.state, 'EXECUTED'); assert.equal(operations(g.companies[0]).rollbacks.length, 0);
});

test('review #8: forwarded texts are sections the student marked, forwarded with their exact words', () => {
  const g = start(); command(g, 'backend', 'change.submit', { graph: g.companies[0].backend, revision: 0 }); const ch = g.changes[0];
  const text = 'Mandale a Backend la observación: no hace falta validar el pago';
  let r = order(g, 'security', text, [{ name: 'seguridad_observacion', input: { cambio: ch.id, bloque: 'backend-payment', texto: 'hace falta validar el pago', citas: ['el pago'] } }], { changeId: ch.id });
  assert.notEqual(r.state, 'EXECUTED');
  r = order(g, 'security', text, [{ name: 'seguridad_observacion', input: { cambio: ch.id, bloque: 'backend-payment', texto: 'no hace falta validar el pago', citas: ['el pago'] } }], { changeId: ch.id });
  assert.equal(r.state, 'EXECUTED', r.message);
  assert.equal(g.companies[0].runtime.collaboration!.reviews[ch.id].observations[0].text, 'no hace falta validar el pago');
});

test('review #9 and #10: duplicated calls execute once; an unstated test type is asked for', async () => {
  const g = start(); authorizeInfra(g, 0, 8);
  const call = { name: 'devops_escalar', input: { accion: 'agregar', cantidad: 2, citas: ['Agregá 2 servidores'] } };
  const who = actor('devops'), input = { id: 'dup', text: 'Agregá 2 servidores' };
  const executed = await executeCalls(() => ({ g, actor: who }), input, [call, call], snapshotFor(g, who), async c => applyCommand(g, who, c));
  assert.equal(executed.state, 'EXECUTED'); assert.equal(g.companies[0].servers, 3);
  command(g, 'backend', 'change.submit', { graph: g.companies[0].backend, revision: 0 }); reviewForQa(g);
  const r = order(g, 'qa', 'Ejecutá 30 solicitudes con stock 5 y concurrencia 10', [{ name: 'qa_ejecutar_escenario', input: { cambio: '', tipo: 'security', solicitudes: 30, stock: 5, concurrencia: 10, simultaneas: false, reintentos: null, ataque: null, cupones: null, mismo_pago: null, citas: ['30 solicitudes', 'stock 5', 'concurrencia 10'] } }]);
  assert.equal(r.state, 'NEEDS_INPUT'); assert.match(r.message, /tipo de prueba/); assert.equal(g.changes[0].status, 'QA_PENDING');
});

test('review #11: the QA suite buttons test a product change with its promotion applied', () => {
  const g = start();
  const draft = command(g, 'product', 'product.draft', { catalogId: 'PROMO-01', percent: 20, duration: 60, demandMultiplier: 2, budget: 100 }).refs![0];
  command(g, 'product', 'product.submit', { draftId: draft }); const ch = g.changes[0];
  assert(command(g, 'qa', 'qa.run', { suite: 'Carga' }, ch.id).ok);
  assert(ch.testJob, 'staging job, not the legacy aggregate run'); assert.equal(ch.testJob!.promotion!.percent, 20);
});

test('review #12: an authorized request keeps the operations it asked for', () => {
  const g = start(), req = command(g, 'devops', 'infra.request_budget', { amount: 100, durationSeconds: 60, maxServers: 2, operations: ['balancer'] }).refs![0];
  const r = order(g, 'cto', `Autorizá la solicitud ${req} con Q100 por 60 segundos y máximo 2 servidores`, [{ name: 'cto_autorizar_infraestructura', input: { monto: 100, duracion_segundos: 60, max_servidores: 2, operaciones: [], solicitud: req, citas: ['Q100 por 60 segundos', 'máximo 2 servidores'] } }]);
  assert.equal(r.state, 'EXECUTED', r.message); assert.deepEqual(operations(g.companies[0]).authorizations.at(-1)!.operations, ['balancer']);
});

test('review #13: an interruption after a committed operation is reported as partial, not as "nothing executed"', async () => {
  const g = start(); authorizeInfra(g, 0, 8); const who = actor('devops');
  let calls = 0;
  const context = () => { if (++calls > 2) throw new Error('FORBIDDEN'); return { g, actor: who }; };
  const executed = await executeCalls(context, { id: 'cut', text: 'Agregá un servidor y activá el balanceador' }, [
    { name: 'devops_escalar', input: { accion: 'agregar', cantidad: 1, citas: ['Agregá un servidor'] } },
    { name: 'devops_balanceador', input: { activar: true, citas: ['activá el balanceador'] } },
  ], snapshotFor(g, who), async c => applyCommand(g, who, c));
  assert.equal(executed.state, 'PARTIAL'); assert.match(executed.message, /Servidor agregado/); assert.match(executed.message, /Se detuvieron/);
  assert.equal(g.companies[0].servers, 2); assert.equal(g.companies[0].balancer, false);
});

test('review #17 and #19: a rollback can be re-authorized with freed funds; a replaced authorization makes a late order stale', async () => {
  const g = start(), c = g.companies[0]; authorizeAtomic(g, 'rolling'); advanceGame(g, 7);
  c.capital = c.reserved + c.infraBudget + 300;
  assert(command(g, 'cto', 'cto.rollback_authorize', { targetVersion: 1, amount: 250 }).ok);
  assert(command(g, 'cto', 'cto.rollback_authorize', { targetVersion: 1, amount: 280 }).ok, 'the previous reservation is freed before checking funds');
  const who = actor('devops'), before = snapshotFor(g, who);
  assert(command(g, 'cto', 'cto.rollback_authorize', { targetVersion: 1, amount: 200 }).ok);
  const executed = await executeCalls(() => ({ g, actor: who }), { id: 'late-rb', text: 'Ejecutá el rollback con rolling' }, [{ name: 'devops_rollback', input: { estrategia: 'rolling', citas: ['rollback', 'con rolling'] } }], before, async x => applyCommand(g, who, x));
  assert.equal(executed.state, 'REJECTED'); assert.equal(operations(c).rollbacks.at(-1)!.status, 'AUTHORIZED');
});
