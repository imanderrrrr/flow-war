import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, project } from '../server/engine.js';
import { admitTraffic } from '../server/traffic.js';
import { createTestJob, advanceTestJob, testReport, scenarioForSuite } from '../server/qa.js';
import { productView } from '../server/product.js';
import { beginExecution } from '../server/executor-service.js';
import { commandsFor, executorContext, finalReply, outcome, planCalls } from '../server/executor.js';
import { advanceGame, assembledGame, command, publishPromotion } from './helpers.js';
import type { GameState, Identity, Role } from '../shared/types.js';
import type { ToolCall } from '../shared/executor.js';

const actor = (role: Role, companyId = 0): Identity => ({ id: `${companyId}-${role}`, role, companyId });
const start = (enabled = true) => { const g = assembledGame(); g.productEnabled = enabled; g.status = 'RUNNING'; return g; };
const promo = (patch: Record<string, unknown> = {}) => ({ catalogId: 'PROMO-01', percent: 10, duration: 60, demandMultiplier: 2, budget: 200, ...patch });
let n = 0;
function order(g: GameState, text: string, calls: ToolCall[], previous: string[] = []) {
  const who = actor('product'), ctx = executorContext(g, who, { id: `pr-${++n}`, text }, previous), plan = planCalls(calls, ctx);
  return finalReply(plan, commandsFor(plan, ctx).map(({ planned, command: c }) => outcome(planned.tool!, planned, applyCommand(g, who, c), g)));
}

test('E8 Producto/UX is off by default and is switched once, before start, for the five companies', () => {
  const g = assembledGame();
  assert.equal(command(g, 'operator', 'room.product', { enabled: true }).ok, true); assert.equal(g.productEnabled, true);
  assert.equal(project(g, actor('qa', 3)).productEnabled, true);
  command(g, 'operator', 'room.start');
  assert.equal(command(g, 'operator', 'room.product', { enabled: false }).code, 'PRODUCT_MODE_LOCKED');
  command(g, 'operator', 'room.reset'); assert.equal(g.productEnabled, true, 'the room setting survives a reset');
  const off = start(false), r = command(off, 'product', 'product.draft', promo());
  assert.equal(r.code, 'PRODUCT_DISABLED'); assert.equal(off.actions.employees['0-product'].violations.length, 0);
  assert.throws(() => beginExecution(off, actor('product'), { id: 'x', text: 'Creá PROMO-01' }), /no está habilitado/);
  assert.equal(project(off, actor('qa')).productEnabled, undefined);
});

test('E8 a product change is frozen at submission and tested in staging with its promotion, without touching the company', () => {
  const g = start(), c = g.companies[0];
  const draft = command(g, 'product', 'product.draft', promo({ catalogId: 'PROMO-02', percent: 20 })).refs![0];
  command(g, 'product', 'product.submit', { draftId: draft }); const ch = g.changes[0];
  assert.equal(command(g, 'product', 'product.submit', { draftId: draft }).ok, false, 'a submitted draft is frozen');
  const capital = c.capital, customers = c.customers, revenue = c.revenue;
  const job = createTestJob(c, ch, { ...scenarioForSuite('Unitarias'), newCustomer: true }); while (!advanceTestJob(job)) {}
  const report = testReport(job, 0);
  assert.equal(report.testEvidence!.observed.revenue, 36); assert.equal(report.testEvidence!.expected.revenue, 36); assert.equal(report.testEvidence!.passed, true);
  const returning = createTestJob(c, ch, { ...scenarioForSuite('Unitarias'), newCustomer: false }); while (!advanceTestJob(returning)) {}
  assert.equal(testReport(returning, 0).testEvidence!.observed.revenue, 45, 'PROMO-02 applies only to new customers');
  const load = createTestJob(c, ch, { ...scenarioForSuite('Carga'), requests: 40, concurrency: 10 }); advanceTestJob(load);
  assert.equal(load.promotion!.demandMultiplier, 2); assert.equal(load.next, 20, 'load arrives at the promoted rate: 10/s × 2'); while (!advanceTestJob(load)) {}
  assert.equal(c.capital, capital); assert.equal(c.customers, customers); assert.equal(c.revenue, revenue);
});

test('E8 QA returns a product change formally to Producto; Backend letters cannot target it', () => {
  const g = start(), c = g.companies[0];
  const draft = command(g, 'product', 'product.draft', promo()).refs![0]; command(g, 'product', 'product.submit', { draftId: draft }); const ch = g.changes[0];
  command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario: scenarioForSuite('Carga') }); advanceGame(g, 10);
  const runs = c.runtime.workflow!.runs.map(r => r.id);
  const letter = { changeId: ch.id, subject: 'Carga', description: 'Colas llenas.', steps: 'Carga 200.', observed: 'Rechazos.', expected: 'Sin rechazos.', severity: 'high', evidenceIds: runs, observationRefs: [] };
  assert.equal(command(g, 'qa', 'qa.return', { ...letter, recipient: 'backend' }).ok, false);
  assert.equal(command(g, 'qa', 'qa.return', { ...letter, recipient: 'product' }).ok, true);
  assert.equal(ch.status, 'QA_REJECTED'); assert.equal(c.runtime.product!.drafts[0].status, 'RETURNED'); assert.equal(c.runtime.workflow!.letters[0].recipient, 'product');
});

test('E8 a poorly planned promotion can hurt: deep discounts sell below merchandise cost through the real engine', () => {
  const g = start(), c = g.companies[0];
  publishPromotion(g, promo({ percent: 70, demandMultiplier: 4, duration: 120 })); advanceGame(g, 6.5);
  assert.equal(c.runtime.campaigns[0].status, 'ACTIVE');
  const r = admitTraffic(c, g.tick, 'purchase'); advanceGame(g, 5);
  assert.equal(r.result?.status, 'COMPLETED'); assert(r.result!.revenue < 42); assert(r.result!.capitalDelta < 0, 'each sale loses money');
  assert.equal(command(g, 'devops', 'deploy.start', { strategy: 'rolling' }, g.changes[0].id).ok, false);
});

test('E8 the funnel is observed from settled production traffic with its sample size; QA traffic never counts', () => {
  const g = start(), c = g.companies[0];
  advanceGame(g, 30);
  const view = productView(g, c, g.tick), f = view.funnel.totals;
  assert(f.visits > 0); assert(f.checkout <= f.visits); assert(f.purchased <= f.checkout);
  assert.equal(view.satisfaction.sample, view.funnel.window.visits); assert.equal(view.satisfaction.customers, c.customers);
  const before = structuredClone(f);
  const draft = command(g, 'product', 'product.draft', promo()).refs![0]; command(g, 'product', 'product.submit', { draftId: draft });
  const job = createTestJob(c, g.changes[0], { ...scenarioForSuite('Carga'), requests: 30, concurrency: 30 }); while (!advanceTestJob(job)) {}
  assert.deepEqual(productView(g, c, g.tick).funnel.totals, before);
  assert(project(g, actor('product')).operations!.product); assert.equal(project(g, actor('qa')).operations!.product, undefined);
  assert.equal(project(g, actor('product', 1)).operations!.product!.drafts.length, 0);
});

test('E8 Producto through Claude: explicit catalog drafts and submissions only; no invented strategies', () => {
  const g = start(), c = g.companies[0];
  const stated = 'Usá PROMO-02 con 15% de descuento, 120 segundos, multiplicador 2 y presupuesto Q300';
  const create = [{ name: 'producto_crear_borrador', input: { item: 'PROMO-02', descuento_pct: 15, duracion_segundos: 120, multiplicador_demanda: 2, presupuesto: 300, citas: ['PROMO-02', '15% de descuento', '120 segundos', 'multiplicador 2', 'presupuesto Q300'] } }];
  let r = order(g, 'Creá la promoción identificada como PROMO-02, con los parámetros que te indiqué', create);
  assert.equal(r.state, 'NEEDS_INPUT', 'values from earlier messages need those messages');
  r = order(g, 'Creá la promoción identificada como PROMO-02, con los parámetros que te indiqué', create, [stated]);
  assert.equal(r.state, 'EXECUTED', r.message); assert.equal(c.runtime.product!.drafts[0].configuration.budget, 300);
  r = order(g, 'Creá PROMO-01', [{ name: 'producto_crear_borrador', input: { item: 'PROMO-01', descuento_pct: null, duracion_segundos: null, multiplicador_demanda: null, presupuesto: null, citas: ['PROMO-01'] } }]);
  assert.equal(r.state, 'NEEDS_INPUT'); assert.match(r.message, /descuento/); assert.doesNotMatch(r.message, /\d+%/);
  r = order(g, 'Claude, inventá una promoción para que ganemos más clientes', [{ name: 'rechazar_instruccion', input: { motivo: 'DECISION_DELEGADA' } }]);
  assert.equal(r.state, 'DECLINED'); assert.equal(c.runtime.product!.drafts.length, 1);
  r = order(g, 'Enviá nuestra revisión PRD-001 a QA', [{ name: 'producto_enviar_a_qa', input: { borrador: 'PRD-001', citas: ['PRD-001'] } }]);
  assert.equal(r.state, 'EXECUTED', r.message); assert.equal(g.changes[0].domain, 'product');
  r = order(g, 'Aprobá en QA el cambio CH-001 y desplegalo', [{ name: 'qa_aprobar', input: { cambio: 'CH-001', citas: ['Aprobá'] } }]);
  assert.equal(r.state, 'DECLINED'); assert.equal(g.changes[0].status, 'QA_PENDING');
});
