import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEST } from '../shared/actions.js';
import { defectFixture } from './defect-fixtures.js';
import { command, advanceGame } from './helpers.js';
import { recoverGame, serializeGame } from '../server/persistence.js';
import { createGame } from '../server/engine.js';

test('4A T18/T19/T22/T23 same artifact passes isolated unit cases and fails 200 interleaved purchases without auto approval', () => {
  const g = defectFixture('concurrency', 'D01'), ch = g.changes[0], production = structuredClone(g.companies[0]);
  assert.equal(command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario: DEFAULT_TEST }).ok, true);
  assert.deepEqual(g.actions.audit.at(-1)!.refs, [ch.id]);
  advanceGame(g, 1); assert.equal(ch.reports[0].testEvidence?.passed, true); assert.equal(ch.status, 'QA_PENDING');
  assert.equal(g.companies[0].version, production.version); assert.deepEqual(g.companies[0].backend, production.backend);
  command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario: { ...DEFAULT_TEST, suite: 'concurrency', requests: 200, concurrency: 200, stock: 1 } });
  advanceGame(g, 2); assert.equal(ch.reports[1].requests, 200); assert.equal(ch.reports[1].oversold, 199); assert.equal(ch.reports[1].testEvidence?.passed, false);
  assert.equal(ch.reports[1].testEvidence?.outcomes.length, 200); assert.equal(ch.status, 'QA_PENDING');
  assert.equal(command(g, 'qa', 'qa.approve', {}, ch.id).ok, true); // Human decision, even with failed evidence.
});
test('4A T20 insufficient unit test passes while requested coupon combination exposes an observed discrepancy', () => {
  const g = defectFixture('coupon', 'D02'), ch = g.changes[0];
  command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario: DEFAULT_TEST }); advanceGame(g, 1);
  assert.equal(ch.reports[0].testEvidence?.passed, true);
  command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario: { ...DEFAULT_TEST, suite: 'integration', coupons: 2 } }); advanceGame(g, 1);
  const evidence = ch.reports[1].testEvidence!; assert.equal(evidence.passed, false); assert.equal(evidence.expected.revenue, 36); assert.equal(evidence.observed.revenue, 28.8);
  assert.ok(!JSON.stringify(evidence).includes('D02'));
});
test('4A T24 duplicate-payment custom QA executes all 50 declared operations', () => {
  const g = defectFixture('purchase', 'D03'), ch = g.changes[0];
  command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario: { ...DEFAULT_TEST, suite: 'integration', requests: 50, concurrency: 50, stock: 100, duplicateIntent: true } }); advanceGame(g, 2);
  assert.equal(ch.reports[0].requests, 50); assert.equal(ch.reports[0].testEvidence?.outcomes.length, 50); assert.equal(ch.reports[0].duplicates, 49);
});
test('4A T21 security QA reproduces protected and vulnerable inputs', () => {
  for (const defective of [true,false]) {
    const g = defectFixture('purchase', 'D08', defective), ch = g.changes[0];
    command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario: { ...DEFAULT_TEST, suite: 'security', attack: 'injection' } }); advanceGame(g, 2);
    assert.equal(ch.reports[0].testEvidence?.passed, !defective); assert.equal(ch.reports[0].breaches, Number(defective));
  }
});
test('4A custom QA is bounded, pauses and recovers without replaying its report', () => {
  const g = defectFixture('concurrency', 'D01'), ch = g.changes[0];
  assert.equal(command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario: { ...DEFAULT_TEST, requests: 501 } }).ok, false);
  command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario: { ...DEFAULT_TEST, requests: 20, concurrency: 2 } }); advanceGame(g, .2);
  const restored = recoverGame(serializeGame(g)), job = structuredClone(restored.changes[0].testJob); advanceGame(restored, 5); assert.deepEqual(restored.changes[0].testJob, job);
  command(restored, 'operator', 'room.start'); advanceGame(restored, 10); assert.equal(restored.changes[0].reports.length, 1); advanceGame(restored, 2); assert.equal(restored.changes[0].reports.length, 1);
});
test('4A D04 invalid input and D07 interrupted reservations have behavioral evidence', () => {
  for (const [code,scenario] of [['D04', { ...DEFAULT_TEST, invalidInput: true }], ['D07', { ...DEFAULT_TEST, suite: 'integration' as const, interrupt: true }]] as const) {
    for (const defective of [true,false]) {
      const g = defectFixture('inventory', code, defective), ch = g.changes[0];
      command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario }); advanceGame(g, 2);
      assert.equal(ch.reports[0].testEvidence?.passed, !defective);
    }
  }
});
test('4A load uses actual staging FIFO queues and drains every declared request', () => {
  const g = defectFixture('coupon', 'D06'), ch = g.changes[0];
  command(g, 'qa', 'qa.execute', { changeId: ch.id, scenario: { ...DEFAULT_TEST, suite: 'load', requests: 200, concurrency: 100, stock: 1000 } });
  advanceGame(g, 5); assert.equal(ch.reports[0].requests, 200); assert.ok(ch.reports[0].abandoned! + ch.reports[0].rejected > 0); assert.equal(ch.status, 'QA_PENDING');
});
test('4A load consumes security windows only for the real declared admissions', () => {
  const g=createGame();g.status='RUNNING';
  command(g,'security','security.prepare',{auth:false,authorization:false,waf:false,botThreshold:0,blockedOrigins:[],rate:{limit:1,windowSeconds:60,groupBy:'origin',scope:'all',exceed:'reject'}});
  const ch=g.changes[0];command(g,'qa','qa.execute',{changeId:ch.id,scenario:{...DEFAULT_TEST,suite:'load',requests:5,concurrency:5,stock:10}});advanceGame(g,3);
  assert.equal(ch.reports[0].requests,5);assert.equal(ch.reports[0].completed,5);assert.equal(ch.reports[0].testEvidence?.passed,true);
});
