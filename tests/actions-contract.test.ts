import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_CATALOG, allowedAction } from '../shared/actions.js';
import { parseAction, testScenario } from '../server/action-validation.js';

test('4A contracts: one explicit permission catalog for every role and both inputs', () => {
  for (const [type, entry] of Object.entries(ACTION_CATALOG)) {
    for (const role of ['backend','security','qa','cto','devops','product','operator'] as const) assert.equal(allowedAction(type, role), entry.roles.includes(role));
  }
  assert.equal(allowedAction('__proto__', 'backend'), false);
  assert.equal(allowedAction('state.patch', 'operator'), false);
});
test('4A contracts reject forged identity, unknown parameters, unsupported modules and resource abuse', () => {
  const action = { version: 1, id: 'one', companyId: 0, source: 'fixture', type: 'infra.restart_all', parameters: { duration: 10 } };
  assert.deepEqual(parseAction(action), action);
  assert.throws(() => parseAction({ ...action, role: 'devops' }));
  assert.throws(() => parseAction({ ...action, parameters: { duration: 10, capital: 9999 } }));
  assert.throws(() => parseAction({ ...action, version: 2 }));
  assert.throws(() => parseAction({ ...action, type: 'state.patch' }));
  assert.throws(() => testScenario({ requests: 20000 }));
});

test('4A campaign multipliers reject nonfinite values before any mutation', () => {
  for (const demandMultiplier of [NaN,Infinity,-Infinity]) assert.throws(() => parseAction({ version: 1, id: 'campaign', companyId: 0, source: 'fixture', type: 'campaign.prepare', parameters: { percent: 15, audience: 'new', duration: 120, budget: 250, demandMultiplier } }));
});
