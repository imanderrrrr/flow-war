import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleGame, createGame } from '../server/engine.js';
import { syncInfrastructure } from '../server/infrastructure.js';
import { advanceTraffic, serviceRates } from '../server/traffic.js';
import type { Company, Graph } from '../shared/types.js';
import { planWith } from './helpers.js';

const newCompany = (): Company => createGame().companies[0];
const onPlan = (company: Company, plan: Graph) => { company.plan = plan; return company; };
/** The same plan with pagos added and nothing else, so only that service may change. */
const withPaymentOnPlan = (company: Company) => onPlan(company, planWith('web', 'payment', 'exit'));
const withoutPaymentOnPlan = (company: Company) => onPlan(company, planWith('web', 'exit'));
const completeCompany = (servers: number): Company => {
  const game = createGame(); assembleGame(game);
  const company = game.companies[0];
  company.servers = servers; company.balancer = true; syncInfrastructure(company);
  return company;
};

test('un servicio fuera del plano no tiene capacidad', () => {
  const c = newCompany();
  const rates = serviceRates(c);
  assert.equal(rates.web > 0, true);
  assert.deepEqual([rates.security, rates.checkout, rates.inventory, rates.payment], [0, 0, 0, 0]);
});

test('colocar pagos le da capacidad y no toca a los demás', () => {
  const before = serviceRates(withoutPaymentOnPlan(newCompany())), after = serviceRates(withPaymentOnPlan(newCompany()));
  assert.equal(before.payment, 0);
  assert.ok(after.payment > 0);
  assert.deepEqual([after.web, after.inventory], [before.web, before.inventory]);
});

test('el servicio detenido por DevOps sigue en cero aunque esté en el plano', () => {
  const c = withPaymentOnPlan(newCompany());
  c.infrastructure.stoppedServices = ['payment'];
  assert.equal(serviceRates(c).payment, 0);
});

test('solo tienda web y checkout escalan con los servidores', () => {
  const one = serviceRates(completeCompany(1)), four = serviceRates(completeCompany(4));
  assert.equal(four.web, one.web * 4);
  assert.equal(four.checkout, one.checkout * 4);
  assert.deepEqual([four.security, four.inventory, four.payment], [one.security, one.inventory, one.payment]);
});

test('la cola de un servicio fuera del plano no admite a nadie', () => {
  const c = createGame().companies[0];
  assert.equal(c.traffic.services.payment.capacity > 0, true, 'la capacidad arranca con la configuración');
  advanceTraffic(c, 1);
  assert.equal(c.traffic.services.payment.capacity, 0);
  assert.ok(c.traffic.services.web.capacity > 0);
});

test('una fixtura de QA no queda limitada por el plano a medio construir de su empresa', () => {
  const c = newCompany();
  c.traffic.scope = 'qa';
  const rates = serviceRates(c);
  assert.deepEqual([rates.security > 0, rates.checkout > 0, rates.inventory > 0, rates.payment > 0], [true, true, true, true]);
});
