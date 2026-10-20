import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, project } from '../server/engine.js';
import { advanceConcurrency, createConcurrencyRun, runConcurrencyFixture } from '../server/requests.js';
import { command, advanceGame , reviewForQa } from './helpers.js';

test('4A T01 modules prepare actual changes; eligible discounts alter price, revenue and contribution', () => {
  const g = createGame(); g.status = 'RUNNING';
  assert.equal(command(g, 'backend', 'module.create', { name: 'Nuevos', configuration: { kind: 'discount', percent: 20, audience: 'new', stackable: false }, dependencies: [] }).ok, true);
  const ch = g.changes[0]; assert.equal(ch.status, 'SECURITY_PENDING'); reviewForQa(g,ch.id); assert.equal(g.companies[0].version, 1);
  const run = runConcurrencyFixture(ch.context!);
  assert.equal(run.requests[0].price, 36); assert.equal(run.requests[0].result?.revenue, 36); assert.equal(run.requests[0].result?.capitalDelta, -6);
  const other = createConcurrencyRun('other', ch.context!, 0); other.requests.forEach(r => r.newCustomer = false);
  for (let i = 1; i <= 100; i++) advanceConcurrency(other, i / 10);
  assert.equal(other.requests[0].result?.revenue, 45);
  assert.equal(JSON.stringify(project(g, { id: 'qa', role: 'qa', companyId: 0 })).includes('defects'), false);
});

for (const configuration of [{ kind: 'coupon', percent: 20, audience: 'all', stackable: false }, { kind: 'inventory', minimum: 1 }, { kind: 'purchase', idempotent: true }, { kind: 'concurrency', strategy: 'atomic' }] as const) test(`4A artifact ${configuration.kind} survives QA, CTO and DevOps publication with immutable history`, () => {
  const g = createGame(); g.status = 'RUNNING';
  assert.equal(command(g, 'backend', 'module.create', { name: configuration.kind, configuration, dependencies: [] }).ok, true);
  const ch = g.changes[0], c = g.companies[0];
  reviewForQa(g,ch.id); command(g, 'qa', 'qa.run', { suite: 'Concurrencia' }, ch.id); advanceGame(g, 6);
  assert.equal(command(g, 'qa', 'qa.approve', {}, ch.id).ok, true);
  assert.equal(command(g, 'cto', 'cto.authorize', {}, ch.id).ok, true);
  assert.equal(command(g, 'devops', 'deploy.start', { strategy: 'rolling' }, ch.id).ok, true); advanceGame(g, 7);
  assert.equal(ch.status, 'DEPLOYED'); assert.equal(c.runtime.releases[c.version].modules[0].configuration.kind, configuration.kind);
  const previous = structuredClone(c.runtime.releases[c.version]);
  assert.equal(command(g, 'backend', 'module.revise', { moduleId: ch.artifactRefs![0].id, name: 'v2', configuration, dependencies: [] }).ok, true);
  assert.deepEqual(c.runtime.releases[c.version], previous); assert.equal(c.runtime.modules[ch.artifactRefs![0].id].length, 2);
});
