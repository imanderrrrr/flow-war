import test from 'node:test';
import assert from 'node:assert/strict';

import { serviceRates } from '../server/traffic.js';
import { advanceGame, assembledGame, command } from './helpers.js';
import { recoverGame, serializeGame } from '../server/persistence.js';

test('4A T25/T26 individual and total restart remove actual capacity and recover in simulation time', () => {
  const g = assembledGame(); g.status = 'RUNNING'; const c = g.companies[0]; c.servers = 4; c.balancer = true;
  assert.equal(serviceRates(c).web, 48);
  assert.equal(command(g, 'devops', 'infra.restart', { serverId: 2, duration: 5 }).ok, true);
  assert.equal(serviceRates(c).web, 36); advanceGame(g, 5); assert.equal(serviceRates(c).web, 48);
  assert.equal(command(g, 'devops', 'infra.restart_all', { duration: 15 }).ok, true);
  assert.equal(serviceRates(c).web, 0); advanceGame(g, 15); assert.equal(serviceRates(c).web, 48);
});
test('4A T27/T28/T43/T53 restart produces real deadlines, preserves commitments and resumes after recovery', () => {
  const g = assembledGame(); g.status = 'RUNNING'; advanceGame(g, 10); const c = g.companies[0], inventory = c.traffic.inventory.committed, revenue = c.revenue;
  command(g, 'devops', 'infra.restart_all', { duration: 20 }); advanceGame(g, 10);
  assert.ok(c.traffic.totals.abandoned > 0); assert.ok(c.traffic.inventory.committed >= inventory); assert.ok(c.revenue >= revenue);
  const restored = recoverGame(serializeGame(g)); assert.equal(restored.status, 'PAUSED');
  advanceGame(restored, 10); assert.equal(serviceRates(restored.companies[0]).web, 0);
  command(restored, 'operator', 'room.start'); advanceGame(restored, 10); assert.ok(serviceRates(restored.companies[0]).web > 0);
});
test('4A service stop applies to the selected queue and role checks precede operations', () => {
  const g = assembledGame(); g.status = 'RUNNING';
  assert.equal(command(g, 'backend', 'infra.restart_all', { duration: 10 }).ok, false);
  command(g, 'devops', 'infra.stop', { service: 'payment' }); assert.equal(serviceRates(g.companies[0]).payment, 0); assert.ok(serviceRates(g.companies[0]).web > 0);
  command(g, 'devops', 'infra.recover', { service: 'payment' }); assert.ok(serviceRates(g.companies[0]).payment > 0);
});
