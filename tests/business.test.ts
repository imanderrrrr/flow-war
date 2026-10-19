import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, initialGraph } from '../server/engine.js';
import { admitTraffic, generateTraffic } from '../server/traffic.js';
import { command, advanceGame } from './helpers.js';

const campaign = { percent: 15, audience: 'new', duration: 120, budget: 250, demandMultiplier: 4 };
test('4A T08/T38/T39 campaign requires CTO financing, changes real demand and cannot manufacture sales', () => {
  const g = createGame(); g.status = 'RUNNING'; const c = g.companies[0], control = g.companies[1];
  assert.equal(command(g, 'product', 'campaign.prepare', campaign).ok, true); const cam = c.runtime.campaigns[0];
  assert.equal(command(g, 'product', 'campaign.authorize', { campaignId: cam.id }).ok, false);
  assert.equal(command(g, 'product', 'campaign.activate', { campaignId: cam.id }).ok, false);
  const revenue = c.revenue, capital = c.capital;
  assert.equal(command(g, 'cto', 'campaign.authorize', { campaignId: cam.id }).ok, true); assert.equal(c.reserved, 250);
  assert.equal(command(g, 'product', 'campaign.activate', { campaignId: cam.id }).ok, true); assert.equal(c.capital, capital - 250); assert.equal(c.revenue, revenue); assert.equal(c.reserved, 0);
  generateTraffic(c, 100, 1, 1500); generateTraffic(control, 100, 1, 1500); assert.ok(c.traffic.legitimate.generated > control.traffic.legitimate.generated);
  assert.equal(c.revenue, 0); assert.equal(c.runtime.campaigns[0].status, 'ACTIVE');
});
test('4A T40 campaign load saturates insufficient capacity and prices only successful eligible purchases', () => {
  const g = createGame(); g.status = 'RUNNING'; const c = g.companies[0];
  command(g, 'product', 'campaign.prepare', campaign); const id = c.runtime.campaigns[0].id; command(g, 'cto', 'campaign.authorize', { campaignId: id }); command(g, 'product', 'campaign.activate', { campaignId: id });
  const r = admitTraffic(c, 0, 'purchase'); r.newCustomer = true; advanceGame(g, 4); assert.equal(r.result?.revenue, 38.25);
  g.tick = 110; generateTraffic(c, 110, 10, 1500); advanceGame(g, 4); assert.ok(c.queue > 0 || c.traffic.totals.rejected + c.traffic.totals.abandoned > 0);
  advanceGame(g, 10); assert.equal(c.runtime.campaigns[0].status, 'COMPLETED');
});
test('4A T41 CTO priority chooses a real limited staging worker without altering production', () => {
  const g = createGame(); g.status = 'RUNNING';
  command(g, 'backend', 'change.submit', { graph: initialGraph('backend'), revision: 0 }); const backend = g.changes[0];
  command(g, 'security', 'change.submit', { graph: initialGraph('security'), revision: 0 }); const security = g.changes[0];
  command(g, 'qa', 'qa.run', { suite: 'Carga' }, backend.id); command(g, 'qa', 'qa.run', { suite: 'Carga' }, security.id);
  command(g, 'cto', 'cto.prioritize', { incident: 'security' }); advanceGame(g, .1);
  assert.ok(security.qaLoad!.elapsed > 0); assert.equal(backend.qaLoad!.elapsed, 0); assert.equal(g.companies[0].version, 1);
});
test('4A campaign reservation expiration and product proposals remain separate from technical changes', () => {
  const g = createGame(); g.status = 'RUNNING';
  command(g, 'product', 'product.propose', { name: 'Cupones', description: 'Cupones para clientes nuevos' }); assert.equal(g.changes.length, 0); assert.equal(g.companies[0].runtime.proposals.length, 1);
  command(g, 'product', 'campaign.prepare', campaign); const id = g.companies[0].runtime.campaigns[0].id; command(g, 'cto', 'campaign.authorize', { campaignId: id }); advanceGame(g, 121);
  assert.equal(g.companies[0].reserved, 0); assert.equal(g.companies[0].runtime.campaigns[0].status, 'EXPIRED');
});
