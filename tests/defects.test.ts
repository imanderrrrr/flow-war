import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, project } from '../server/engine.js';
import { command } from './helpers.js';
import { generateDefects } from '../server/defects.js';
import { advanceConcurrency, createConcurrencyRun } from '../server/requests.js';
import { recoverGame, serializeGame } from '../server/persistence.js';
import { admitSecurity } from '../server/security.js';

export function defectFixture(kind: 'coupon' | 'purchase' | 'concurrency' | 'inventory', code: string, present = true) {
  for (let seed = 1; seed <= 500; seed++) {
    const g = createGame(1500, seed); g.status = 'RUNNING';
    const configuration = kind === 'coupon' ? { kind, percent: 20, audience: 'new', stackable: false } : kind === 'purchase' ? { kind, idempotent: true } : kind === 'concurrency' ? { kind, strategy: 'atomic' } : { kind, minimum: 1 };
    command(g, 'backend', 'module.create', { name: kind, configuration, dependencies: [] });
    if (g.changes[0].context!.execution!.modules[0].defects.some(d => d.code === code) === present) return g;
  }
  throw new Error('No deterministic fixture found.');
}
test('4A T11/T12/T13 frozen generation permits zero and multiple defects and equivalent corporate draws', () => {
  const counts = new Set<number>();
  const g = defectFixture('purchase', 'D03'); const m = g.changes[0].context!.execution!.modules[0];
  for (let seed = 1; seed <= 100; seed++) counts.add(generateDefects(seed, m).length);
  assert.ok(counts.has(0)); assert.ok(counts.size > 2); assert.deepEqual(generateDefects(g.seed, m), m.defects);
  const other = { ...m, id: m.id.replace('C0', 'C4'), companyId: 4 };
  assert.deepEqual(generateDefects(g.seed, other).map(d => d.code), m.defects.map(d => d.code));
});
test('4A T15 double discount activates only with the combination and changes real price', () => {
  const g = defectFixture('coupon', 'D02'), context = g.changes[0].context!;
  const run = createConcurrencyRun('double', context, 0); run.requests.forEach(r => r.couponCount = 2);
  for (let i = 1; i <= 100; i++) advanceConcurrency(run, i / 10);
  assert.equal(run.requests[0].price, 28.8); assert.equal(run.requests[0].result?.revenue, 28.8);
  assert.equal(project(g, { id: 'qa', role: 'qa', companyId: 0 }).changes[0].context?.execution, undefined);
});
test('4A T16 duplicate business intentions create repeated effects only when protection is defective', () => {
  for (const defective of [false,true]) {
    const g = defectFixture('purchase', 'D03', defective), run = createConcurrencyRun('retry', g.changes[0].context!, 0, [0, 4]);
    run.inventory.stock = run.inventory.initialStock = 10; run.requests.forEach(r => r.intentId = 'same-payment');
    for (let i = 1; i <= 150; i++) advanceConcurrency(run, i / 10);
    assert.equal(run.inventory.committed, defective ? 2 : 1); assert.equal(run.requests.reduce((s,r) => s + (r.duplicates ?? 0), 0), defective ? 1 : 0);
  }
});
test('4A T17/T52 persistence retains hidden defects without exposing them in any snapshot', () => {
  const g = defectFixture('purchase', 'D03'); const restored = recoverGame(serializeGame(g));
  assert.deepEqual(restored.companies[0].runtime.modules, g.companies[0].runtime.modules);
  for (const role of ['backend','qa','operator'] as const) { const view = JSON.stringify(project(restored, { id: role, role, companyId: role === 'operator' ? null : 0 })); assert.ok(!view.includes('defects')); assert.ok(!view.includes('effectCodes')); }
});
test('4A D05/D08 security scenarios execute safe simulated attacks and effective controls', () => {
  for (const [code,kind] of [['D05','forged'],['D08','injection']] as const) {
    for (const vulnerable of [false,true]) {
      const g = defectFixture('purchase', code, vulnerable), c = g.companies[0], release = g.changes[0].context!.execution!;
      release.security = { auth: false, authorization: false, waf: false, botThreshold: 0, blockedOrigins: [], rate: null };
      assert.equal(admitSecurity(c, release, kind, 0, 0, 'sim-1', undefined, 'purchase'), vulnerable);
      release.security.waf = true; release.security.auth = true;
      assert.equal(admitSecurity(c, release, kind, 0, 0, 'sim-1', undefined, 'purchase'), false);
    }
  }
});
