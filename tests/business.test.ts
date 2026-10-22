import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGraph } from '../server/engine.js';
import { admitTraffic, generateTraffic } from '../server/traffic.js';
import { advanceGame, assembledGame, command, publishPromotion } from './helpers.js';

const campaign = { catalogId: 'PROMO-02', percent: 15, duration: 120, budget: 250, demandMultiplier: 4 };
test('E8 promotions go Producto → QA → CTO → DevOps; direct campaign shortcuts are refused', () => {
  const g = assembledGame(); g.status = 'RUNNING'; g.productEnabled = true; const c = g.companies[0], control = g.companies[1];
  for (const [role, type, payload] of [['product', 'campaign.prepare', { percent: 15, audience: 'new', duration: 120, budget: 250, demandMultiplier: 4 }], ['product', 'campaign.activate', { campaignId: 'x' }]] as const) assert.equal(command(g, role, type, payload).ok, false);
  const draft = command(g, 'product', 'product.draft', campaign); assert.equal(draft.ok, true);
  assert.equal(c.runtime.campaigns.length, 0); assert.equal(g.changes.length, 0, 'a draft is not a change yet');
  assert.equal(command(g, 'product', 'product.submit', { draftId: draft.refs![0] }).ok, true);
  const ch = g.changes[0]; assert.equal(ch.domain, 'product'); assert.equal(ch.status, 'QA_PENDING'); assert.equal(ch.cost, 350);
  for (const type of ['qa.approve', 'cto.authorize', 'deploy.start'] as const) assert.equal(command(g, 'product', type, type === 'deploy.start' ? { strategy: 'rolling' } : {}, ch.id).ok, false);
  const capital = c.capital, revenue = c.revenue;
  assert.equal(command(g, 'qa', 'qa.run', { suite: 'Carga' }, ch.id).ok, true); advanceGame(g, 8);
  assert.equal(command(g, 'qa', 'qa.approve', {}, ch.id).ok, true);
  assert.equal(command(g, 'cto', 'cto.decide', { changeId: ch.id, decision: 'authorize', reason: 'Autorizo.', confirmed: true }).ok, true); assert.equal(c.reserved, 350);
  assert.equal(c.runtime.campaigns.length, 0, 'authorizing a cost does not publish');
  assert.equal(command(g, 'devops', 'deploy.start', { strategy: 'rolling' }, ch.id).ok, true); advanceGame(g, 6.5);
  assert.equal(ch.status, 'DEPLOYED'); assert.equal(c.runtime.campaigns[0].status, 'ACTIVE'); assert.equal(c.reserved, 0);
  assert(g.actions.audit.some(a => a.type === 'deploy.completed' && a.refs.includes(ch.id) && a.effects.includes('capital.delta:-350')), 'publication charges base plus budget once'); void capital;
  generateTraffic(c, 100, 1, 1500); generateTraffic(control, 100, 1, 1500); assert.ok(c.traffic.legitimate.generated > control.traffic.legitimate.generated);
  assert(c.revenue >= revenue); assert.equal(c.customers + control.customers <= 5000, true, 'no customers are created');
});
test('E8 a published promotion loads real capacity and prices only successful eligible purchases', () => {
  const g = assembledGame(); g.status = 'RUNNING'; const c = g.companies[0];
  publishPromotion(g, campaign); advanceGame(g, 6.5); assert.equal(c.runtime.campaigns[0].status, 'ACTIVE');
  const r = admitTraffic(c, g.tick, 'purchase'); r.newCustomer = true; advanceGame(g, 4); assert.equal(r.result?.revenue, 38.25);
  const end = c.runtime.campaigns[0].endsAt!; generateTraffic(c, g.tick, 10, 1500); advanceGame(g, 4); assert.ok(c.queue > 0 || c.traffic.totals.rejected + c.traffic.totals.abandoned > 0 || c.traffic.legitimate.generated > 0);
  advanceGame(g, end - g.tick + 1); assert.equal(c.runtime.campaigns[0].status, 'COMPLETED');
});
test('4A T41 CTO priority chooses a real limited staging worker without altering production', () => {
  const g = assembledGame(); g.status = 'RUNNING';
  command(g, 'backend', 'change.submit', { graph: initialGraph('backend'), revision: 0 }); const backend = g.changes[0]; command(g,'security','security.submit',{changeId:backend.id,revision:0});
  command(g, 'security', 'security.prepare', {auth:false,authorization:false,waf:false,botThreshold:0,blockedOrigins:[],rate:null}); const security = g.changes[0];
  command(g, 'qa', 'qa.run', { suite: 'Carga' }, backend.id); command(g, 'qa', 'qa.run', { suite: 'Carga' }, security.id);
  command(g, 'cto', 'cto.prioritize', { incident: 'security' }); advanceGame(g, .1);
  assert.ok(security.testJob!.elapsed > 0); assert.equal(backend.qaLoad!.elapsed, 0); assert.equal(g.companies[0].version, 1);
});
test('E8 an authorized promotion that expires releases its reservation; product notes stay separate from changes', () => {
  const g = assembledGame(); g.status = 'RUNNING'; g.productEnabled = true;
  command(g, 'product', 'product.propose', { name: 'Cupones', description: 'Cupones para clientes nuevos' }); assert.equal(g.changes.length, 0); assert.equal(g.companies[0].runtime.proposals.length, 1);
  const draft = command(g, 'product', 'product.draft', campaign); command(g, 'product', 'product.submit', { draftId: draft.refs![0] }); const ch = g.changes[0];
  command(g, 'qa', 'qa.run', { suite: 'Unitarias' }, ch.id); advanceGame(g, 2); command(g, 'qa', 'qa.approve', {}, ch.id);
  command(g, 'cto', 'cto.decide', { changeId: ch.id, decision: 'authorize', reason: 'Autorizo.', confirmed: true }); assert.equal(g.companies[0].reserved, 350);
  advanceGame(g, 61); assert.equal(ch.status, 'EXPIRED'); assert.equal(g.companies[0].reserved, 0); assert.equal(g.companies[0].runtime.campaigns.length, 0);
});
