import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame } from '../server/engine.js';
import { recoverGame, serializeGame } from '../server/persistence.js';
import { dispatchCommand } from '../server/discipline.js';
import { command } from './helpers.js';

test('4A T42/T46/T47/T48/T49 five unique forbidden orders expel once; identical replay cannot add violations', () => {
  const g = createGame(); g.status = 'RUNNING'; const actor = { id: '0-backend', companyId: 0, role: 'backend' as const };
  for (let i = 1; i <= 5; i++) {
    const cmd = { id: `prohibited-${i}`, type: 'infra.restart_all', companyId: 0, payload: { duration: 10 } };
    assert.equal(applyCommand(g, actor, cmd).code, 'FORBIDDEN'); assert.equal(applyCommand(g, actor, cmd).code, 'FORBIDDEN');
    assert.equal(g.actions.employees[actor.id].violations.length, i);
  }
  assert.equal(g.actions.employees[actor.id].status, 'EXPELLED'); assert.equal(g.actions.audit.length, 5); assert.equal(g.companies[0].eliminated, false);
  assert.equal(command(g, 'backend', 'module.create', { name: 'x', configuration: { kind: 'inventory', minimum: 1 }, dependencies: [] }).code, 'EXPELLED');
  assert.equal(command(g, 'devops', 'infra.restart_all', { duration: 10 }).ok, true);
});
test('4A T43/T44/T45 malformed interpretation, unknown action, technical error and allowed bad decisions do not sanction', () => {
  const g = createGame(); g.status = 'RUNNING';
  command(g, 'devops', 'infra.restart_all', { duration: 60 });
  command(g, 'backend', 'not.implemented');
  command(g, 'backend', 'action.execute', { action: { version: 1, id: 'malformed', type: 'infra.restart_all', companyId: 0, source: 'agent', parameters: { duration: 'bad' } } });
  const result = dispatchCommand(g, { id: '0-backend', role: 'backend', companyId: 0 }, { id: 'technical', type: 'module.create', companyId: 0 }, () => { throw new Error('system fault'); });
  assert.equal(result.code, 'TECHNICAL'); assert.ok(Object.values(g.actions.employees).every(e => !e.violations.length));
});
test('4A T50/T51 expulsion survives restart; only justified teacher correction can reverse a confirmed violation', () => {
  const g = createGame(); g.status = 'RUNNING'; for (let i = 0; i < 5; i++) command(g, 'backend', 'cto.budget', { amount: 1000 });
  const restored = recoverGame(serializeGame(g)); assert.equal(restored.actions.employees['0-backend'].status, 'EXPELLED');
  assert.equal(command(restored, 'cto', 'employee.correct', { employeeId: '0-backend', justification: 'Error de interpretación confirmado.' }).ok, false);
  assert.equal(command(restored, 'operator', 'employee.correct', { employeeId: '0-backend', justification: '' }).ok, false);
  assert.equal(command(restored, 'operator', 'employee.correct', { employeeId: '0-backend', justification: 'Error de interpretación confirmado.' }).ok, true);
  assert.equal(restored.actions.employees['0-backend'].status, 'ACTIVE'); assert.equal(restored.actions.employees['0-backend'].violations.filter(v => !v.reversed).length, 4);
  assert.ok(restored.actions.audit.at(-1)?.effects.some(effect => effect.includes('justification:')));
});
test('4A T09/T10 shared dispatcher ignores claimed roles and isolates company state', () => {
  const g = createGame(); g.status = 'RUNNING';
  const identity = { id: '0-backend', role: 'backend' as const, companyId: 0 };
  assert.equal(applyCommand(g, identity, { id: 'forged', type: 'infra.restart_all', companyId: 0, payload: { role: 'devops', duration: 10 } }).code, 'FORBIDDEN');
  const before = structuredClone(g.companies[1]); assert.equal(applyCommand(g, identity, { id: 'foreign', type: 'module.create', companyId: 1, payload: { name: 'x', configuration: { kind: 'inventory', minimum: 1 }, dependencies: [] } }).code, 'FORBIDDEN'); assert.deepEqual(g.companies[1], before);
});
test('4A T54 successful structured actions, costs and violations are idempotent through snapshots and ID conflicts fail closed', () => {
  const g = createGame(); g.status = 'RUNNING'; const actor = { id: '0-cto', role: 'cto' as const, companyId: 0 };
  const cmd = { id: 'one-cost', type: 'cto.budget', companyId: 0, payload: { amount: 1000 } }; assert.equal(applyCommand(g, actor, cmd).ok, true);
  const restored = recoverGame(serializeGame(g)), budget = restored.companies[0].infraBudget; assert.equal(applyCommand(restored, actor, cmd).ok, true); assert.equal(restored.companies[0].infraBudget, budget);
  assert.equal(applyCommand(restored, actor, { ...cmd, payload: { amount: 500 } }).code, 'ID_CONFLICT'); assert.equal(restored.actions.employees['0-cto'].violations.length, 0);
});
