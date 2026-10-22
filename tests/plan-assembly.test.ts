import test from 'node:test';
import assert from 'node:assert/strict';
import { completePlan, createGame } from '../server/engine.js';
import { admitTraffic, advanceTraffic } from '../server/traffic.js';
import type { Graph, MarketCustomer, TrafficRequest } from '../shared/types.js';
import { advanceGame, command, planWith, publishPlan } from './helpers.js';

/** A room that opens with this plan already placed. room.start does not step, so the montaje of a
 * sell-capable plan is still open until the first tick. */
const started = (plan?: Graph) => {
  const game = createGame();
  if (plan) for (const company of game.companies) company.plan = structuredClone(plan);
  command(game, 'operator', 'room.start');
  return game;
};
const customerOf = (game: ReturnType<typeof started>, request: TrafficRequest): MarketCustomer =>
  game.market.customers[request.customerId!];
/** Settles the request without step(), so neither the montaje nor the restock move. */
const settleOutsideStep = (game: ReturnType<typeof started>, request: TrafficRequest) => {
  for (let t = 1; t <= 200 && !request.accounted; t++) advanceTraffic(game.companies[request.companyId], t / 10);
  return request;
};

test('durante el montaje la compra no atendida no castiga al cliente', () => {
  const game = started(planWith('web', 'exit'));
  const company = game.companies[0];
  const request = admitTraffic(company, 0, 'purchase');
  const customer = customerOf(game, request);
  advanceGame(game, 1);
  assert.equal(company.assembly.active, true);
  assert.equal(request.result!.reason, 'NO_CHECKOUT');
  assert.ok(request.result!.lostRevenue > 0);
  assert.equal(customer.failedVisits, 0);
  assert.equal(customer.dissatisfaction, 0);
  assert.equal(customer.loyalty, 1, 'la lealtad arranca en 1 y no se toca');
  assert.equal(customer.consecutiveFailures, 0);
  assert.equal(customer.currentCompanyId, 0);
  assert.deepEqual(customer.experiences, {});
  // The storefront's own navigation still earns reputation; what must never happen is losing it
  // for a service nobody asked the team to build yet.
  assert.ok(company.reputation >= 80, `la reputación cayó a ${company.reputation}`);
  assert.equal(customer.activeRequests, 0);
});

test('durante el montaje el reclamo del cliente sí se publica en soporte-clientes', () => {
  const game = started(planWith('web', 'exit'));
  const request = admitTraffic(game.companies[0], 0, 'purchase');
  advanceGame(game, 1);
  assert.equal(request.result!.reason, 'NO_CHECKOUT');
  const complaints = game.slack.messages.filter(m => m.companyId === 0 && m.channel === 'soporte-clientes');
  assert.ok(complaints.length, 'el equipo tiene que ver el reclamo');
  // The customer never got in, so the complaint says that and not that something fell halfway.
  assert.ok(complaints.some(m => /no puedo terminar la compra|no hay dónde pagar/i.test(m.text)), complaints.map(m => m.text).join(' | '));
});

test('el montaje se cierra al quedar capaz de vender, una sola vez', () => {
  const game = started(planWith('web', 'checkout', 'inventory', 'payment', 'exit'));
  const company = game.companies[0];
  assert.equal(company.assembly.active, true);
  advanceGame(game, .1);
  assert.equal(company.assembly.active, false);
  assert.equal(typeof company.assembly.closedAt, 'number');
  assert.ok(game.events.some(e => e.companyId === 0 && e.category === 'PIPELINE' && /compra/i.test(e.text)));
  const closedAt = company.assembly.closedAt;
  // Quitar pagos después no reabre el montaje.
  publishPlan(company, planWith('web', 'checkout', 'inventory', 'exit'));
  advanceGame(game, 1);
  assert.equal(company.assembly.active, false);
  assert.equal(company.assembly.closedAt, closedAt);
});

test('una empresa que no puede vender sigue en montaje', () => {
  const game = started();
  advanceGame(game, 2);
  assert.ok(game.companies.every(c => c.assembly.active));
});

test('cerrado el montaje, la compra no atendida sí castiga', () => {
  const game = started(planWith('web', 'checkout', 'inventory', 'payment', 'exit'));
  const company = game.companies[0];
  advanceGame(game, .1);
  assert.equal(company.assembly.active, false);
  publishPlan(company, planWith('web', 'checkout', 'inventory', 'exit'));
  const request = admitTraffic(company, game.tick, 'purchase');
  const customer = customerOf(game, request);
  advanceGame(game, 1);
  assert.equal(request.result!.reason, 'NO_CHECKOUT');
  assert.equal(customer.failedVisits, 1);
  assert.ok(customer.dissatisfaction > 0);
});

test('el montaje no altera el castigo de los motivos de siempre', () => {
  const game = started(completePlan());
  const company = game.companies[0];
  company.traffic.inventory.stock = 0;
  const request = admitTraffic(company, 0, 'purchase');
  const customer = customerOf(game, request);
  settleOutsideStep(game, request);
  assert.equal(company.assembly.active, true, 'sin step el montaje sigue abierto');
  assert.equal(request.result!.reason, 'OUT_OF_STOCK');
  assert.equal(customer.failedVisits, 1);
  assert.ok(customer.dissatisfaction > 0);
});

test('el montaje no castiga a la empresa que dibujó mal sus caminos', () => {
  // La salida conectada directo a la entrada deja la tienda web fuera del recorrido.
  const game = started(planWith('exit'));
  const company = game.companies[0];
  company.plan.nodes.push({ id: 'plan-web', type: 'web', position: { x: 0, y: 0 }, data: { label: 'Tienda web' } });
  advanceGame(game, 95);
  assert.equal(company.assembly.active, true);
  assert.equal(company.eliminated, false, 'nadie pierde su empresa por no haber construido todavía');
  assert.equal(company.deadTicks, 0);
  assert.ok(company.reputation >= 80, `la reputación cayó a ${company.reputation}`);
});

test('cerrado el montaje, quedarse sin tienda web sí elimina', () => {
  const game = started(planWith('web', 'checkout', 'inventory', 'payment', 'exit'));
  const company = game.companies[0];
  advanceGame(game, .1);
  assert.equal(company.assembly.active, false);
  publishPlan(company, planWith('exit'));
  advanceGame(game, 95);
  assert.equal(company.eliminated, true);
});
