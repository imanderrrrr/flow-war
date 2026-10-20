import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame } from '../server/engine.js';
import { executeInterpretation, runLocalAgent } from '../server/agents.js';
import type { Identity } from '../shared/types.js';

test('4A local interpreter uses the shared dispatcher for creation, denied operations and operational facts', () => {
  const g = createGame(); g.status = 'RUNNING'; const backend: Identity = { id: '0-backend', role: 'backend', companyId: 0 }, devops: Identity = { id: '0-devops', role: 'devops', companyId: 0 };
  const run = (identity: Identity, id: string, fixture: string) => runLocalAgent(g, identity, { version: 1, id, fixture }, cmd => applyCommand(g, identity, cmd));
  assert.equal(run(backend, 'create', 'coupon20').status, 'SENT_TO_SECURITY'); assert.equal(g.changes[0].status, 'SECURITY_PENDING'); assert.equal(g.companies[0].version, 1);
  assert.equal(run(backend, 'denied', 'restart_all').status, 'OUT_OF_ROLE'); assert.equal(g.actions.employees[backend.id].violations.length, 1);
  const restarted = run(devops, 'restart', 'restart_all'); assert.equal(restarted.status, 'EXECUTED'); assert.equal(restarted.message, 'Reinicio iniciado.'); assert.equal(g.companies[0].infrastructure.instances[0].status, 'RESTARTING');
});
test('4A provider classifications and malformed output cannot sanction or mutate state', () => {
  const g = createGame(); g.status = 'RUNNING'; const identity: Identity = { id: '0-backend', role: 'backend', companyId: 0 }, execute = (cmd: Parameters<typeof applyCommand>[2]) => applyCommand(g, identity, cmd);
  for (const intent of ['AMBIGUOUS','UNSUPPORTED','OUT_OF_SCOPE','OUT_OF_ROLE']) executeInterpretation(g, identity, { version: 1, id: intent, rawText: 'Configura inventario' }, { version: 1, intent }, execute);
  executeInterpretation(g, identity, { version: 1, id: 'malformed' }, { version: 1, intent: 'EXECUTE_ACTION', action: { type: 'state.patch' } }, execute);
  assert.equal(g.actions.employees[identity.id].violations.length, 0); assert.equal(g.changes.length, 0);
});
test('4A a verified out-of-game command has an explicit idempotent server policy; a bare model verdict does not', () => {
  const g = createGame(); g.status = 'RUNNING'; const identity: Identity = { id: '0-backend', role: 'backend', companyId: 0 };
  const input = { version: 1 as const, id: 'poem', rawText: 'Escribe un poema', fixture: 'poem' };
  for (let i = 0; i < 2; i++) runLocalAgent(g, identity, input, cmd => applyCommand(g, identity, cmd));
  assert.equal(g.actions.employees[identity.id].violations.length, 1); assert.equal(g.actions.audit.length, 1);
});
test('4A no interpreter assertion can report a deployment success rejected by the engine', () => {
  const g = createGame(); g.status = 'RUNNING'; const identity: Identity = { id: '0-devops', role: 'devops', companyId: 0 };
  const result = executeInterpretation(g, identity, { version: 1, id: 'deploy' }, { version: 1, intent: 'EXECUTE_ACTION', action: { version: 1, id: 'deploy', source: 'agent', companyId: 0, type: 'deploy.start', changeId: 'missing', parameters: { strategy: 'rolling' } } }, cmd => applyCommand(g, identity, cmd));
  assert.equal(result.ok, false); assert.equal(result.status, 'TECHNICAL_ERROR'); assert.equal(g.companies[0].deployments, 0);
});
