import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitsCto, strategyFor } from '../src/consoleState.js';
import type { ChangeStatus } from '../shared/types.js';

test('la decisión del CTO queda a la vista mientras el cambio la espera', () => {
  for (const status of ['CTO_PENDING', 'EXPIRED'] as ChangeStatus[]) assert.equal(awaitsCto({ status }), true, status);
  for (const status of ['SECURITY_PENDING', 'QA_PENDING', 'QA_RUNNING', 'AUTHORIZED', 'DEPLOYING', 'DEPLOYED', 'STALE'] as ChangeStatus[]) assert.equal(awaitsCto({ status }), false, status);
  assert.equal(awaitsCto(undefined), false);
});

test('la estrategia de deploy elegida para un cambio no pasa al siguiente', () => {
  const chosen = { changeId: 'CH-001', strategy: 'restart' as const };
  assert.equal(strategyFor(chosen, 'CH-001'), 'restart');
  assert.equal(strategyFor(chosen, 'CH-002'), '', 'un cambio nuevo arranca sin estrategia elegida');
  assert.equal(strategyFor(null, 'CH-002'), '');
  assert.equal(strategyFor(chosen, undefined), '');
});
