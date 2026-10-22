import test from 'node:test';
import assert from 'node:assert/strict';
import { completePlan, createGame } from '../server/engine.js';
import { planServices } from '../server/graphs.js';
import { admitTraffic } from '../server/traffic.js';
import { TERMINAL_LABELS, type Graph, type TrafficRequest } from '../shared/types.js';
import { advanceGame, command, planWith, publishPlan } from './helpers.js';

/** A room that opens with this plan already on the five companies, the way room.assembled will. */
const started = (plan?: Graph) => {
  const game = createGame();
  if (plan) for (const company of game.companies) company.plan = structuredClone(plan);
  command(game, 'operator', 'room.start');
  return game;
};
const settle = (game: ReturnType<typeof started>, request: TrafficRequest, seconds = 12) => {
  for (let i = 0; i < Math.round(seconds * 10) && !request.result; i++) advanceGame(game, .1);
  return request;
};

test('una empresa sin salida no responde nada y lo dice en español', () => {
  const game = started();
  const c = game.companies[0];
  for (let i = 0; i < 10; i++) admitTraffic(c, 0, i % 2 ? 'purchase' : 'browse');
  advanceGame(game, 1);
  const reasons = new Set(Object.values(c.traffic.requests).map(r => r.result?.reason));
  assert.deepEqual([...reasons], ['NO_STOREFRONT']);
  assert.equal(TERMINAL_LABELS.NO_STOREFRONT, 'La tienda no responde');
});

test('con tienda y salida se navega y la compra dice que todavía no se puede comprar', () => {
  const game = started(planWith('web', 'exit'));
  const c = game.companies[0];
  const browse = admitTraffic(c, 0, 'browse'), purchase = admitTraffic(c, 0, 'purchase');
  settle(game, browse); settle(game, purchase);
  assert.equal(browse.result!.reason, 'OK');
  assert.equal(purchase.result!.reason, 'NO_CHECKOUT');
  assert.equal(TERMINAL_LABELS.NO_CHECKOUT, 'Todavía no se puede comprar acá');
  // The lost sale is still recorded; only the customer is spared, which Task 5 covers.
  assert.ok(purchase.result!.lostRevenue > 0);
});

test('sin inventario la consulta de stock dice que no se puede consultar', () => {
  const game = started(planWith('web', 'checkout', 'exit'));
  const c = game.companies[0];
  const query = admitTraffic(c, 0, 'query');
  assert.equal(settle(game, query).result!.reason, 'NO_INVENTORY');
  assert.equal(TERMINAL_LABELS.NO_INVENTORY, 'No se puede consultar el stock');
});

test('con el plano completo el recorrido es el de siempre', () => {
  const game = started(completePlan());
  const c = game.companies[0];
  assert.deepEqual(planServices(c.plan), ['security', 'web', 'checkout', 'inventory', 'payment']);
  const purchase = admitTraffic(c, 0, 'purchase');
  assert.equal(settle(game, purchase).result!.reason, 'OK');
  assert.deepEqual(purchase.waits.map(w => w.service), ['security', 'web', 'checkout', 'inventory', 'inventory', 'payment', 'checkout']);
});

test('una solicitud en vuelo termina con el plano de su versión', () => {
  const game = started(completePlan());
  const c = game.companies[0];
  const inFlight = admitTraffic(c, 0, 'purchase');
  for (let i = 0; i < 120 && !inFlight.paid; i++) advanceGame(game, .1);
  assert.equal(inFlight.paid, true, 'la compra en vuelo tiene que haber pasado por pagos');
  // Pagos sale del plano publicado mientras la solicitud sigue caminando el suyo.
  publishPlan(c, planWith('security', 'web', 'checkout', 'inventory', 'exit'));
  const afterPublish = admitTraffic(c, game.tick, 'purchase');
  settle(game, inFlight); settle(game, afterPublish);
  assert.equal(inFlight.result!.reason, 'OK');
  assert.equal(afterPublish.result!.reason, 'NO_CHECKOUT');
});

test('un plano nuevo no desvía a la solicitud que ya iba caminando el anterior', () => {
  const game = started(planWith('web', 'checkout', 'inventory', 'payment', 'exit'));
  const c = game.companies[0];
  const inFlight = admitTraffic(c, 0, 'purchase');
  assert.equal(inFlight.phase, 'web', 'sin perímetro la primera parada es la tienda');
  publishPlan(c, completePlan());
  assert.equal(settle(game, inFlight).result!.reason, 'OK');
  assert.equal(inFlight.trace.some(t => t.type === 'security'), false);
  assert.equal(admitTraffic(c, game.tick, 'purchase').phase, 'security');
});
