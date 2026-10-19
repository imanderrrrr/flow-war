import { createHash } from 'node:crypto';
import type { Change, Company, ConcurrencyRun, Report } from '../shared/types.js';
import type { TestScenario } from '../shared/actions.js';
import type { TestJob, TestEvidence } from '../shared/simulation.js';
import { initialOperations, initialRuntime, releaseFor } from './artifacts.js';
import { createConcurrencyRun, advanceConcurrency, finishRequest } from './requests.js';
import { admitTraffic, advanceTraffic, initialTraffic } from './traffic.js';
import { admitSecurity } from './security.js';
import { settleReservation } from './module-execution.js';

export function createTestJob(c: Company, ch: Change, scenario: TestScenario): TestJob {
  const context = structuredClone(ch.context!), staging = structuredClone(c);
  staging.backend = context.backend; staging.security = context.security; staging.version = context.executionVersion;
  staging.capital = 10000; staging.infraBudget = 10000; staging.eliminated = false; staging.servers = 1; staging.balancer = false;
  staging.infrastructure = { instances: [{ id: 1, status: 'UP' }], stoppedServices: [] };
  staging.runtime = { ...initialRuntime(), modules: structuredClone(c.runtime.modules), releases: { [context.executionVersion]: context.execution ?? releaseFor(c, context.backend) } };
  staging.traffic = initialTraffic(scenario.stock, c.traffic.seed, `qa-${ch.id}-${ch.reports.length}`); staging.traffic.scope = 'qa';
  for (const key of ['requests','successes','errors','breaches','oversold','duplicates','revenue','lostRevenue'] as const) staging[key] = 0;
  const template = createConcurrencyRun(`qa-${ch.id}`, context, 0), spacing = Math.max(4, template.requests[0].path.length * .5 + 1);
  template.inventory.stock = template.inventory.initialStock = scenario.stock;
  template.requests = Array.from({ length: scenario.requests }, (_, index) => {
    const r = structuredClone(template.requests[0]), at = Math.floor(index / scenario.concurrency) * spacing;
    r.id = `qa-${ch.id}-${ch.reports.length}-R${index + 1}`; r.intentId = scenario.duplicateIntent ? 'qa-shared-payment' : `${r.id}-intent`;
    r.arrivalAt = at; r.nextAt = at + .5; r.deadline = at + 16; r.journey.at = at;
    r.newCustomer = scenario.newCustomer; r.couponCount = scenario.coupons; r.invalidInput = scenario.invalidInput;
    r.securityAllowed = admitSecurity(staging, r.execution ?? { modules: [] }, scenario.attack === 'none' ? 'valid' : scenario.attack, index, at, 'sim-1', `qa-${index}`, 'purchase');
    return r;
  });
  return { finished: [], scenario: structuredClone(scenario), staging, elapsed: 0, next: 0, requests: template.requests, run: template, reports: [] };
}
/** Ten 100ms rounds per room tick; pause freezes the entire persisted job. */
export function advanceTestJob(job: TestJob) {
  for (let round = 0; round < 10; round++) {
    job.elapsed = Math.round((job.elapsed + .1) * 10) / 10;
    if (job.scenario.suite === 'load') {
      const target = Math.min(job.scenario.requests, Math.floor(job.elapsed * job.scenario.concurrency));
      while (job.next < target) {
        const r = admitTraffic(job.staging, job.elapsed, 'purchase', job.scenario.attack === 'none' ? 'legitimate' : 'malicious', job.scenario.attack === 'none' ? undefined : job.scenario.attack);
        r.couponCount = job.scenario.coupons; r.newCustomer = job.scenario.newCustomer; r.invalidInput = job.scenario.invalidInput;
        if (job.scenario.duplicateIntent) r.intentId = 'qa-shared-payment';
        job.next++;
      }
      advanceTraffic(job.staging, job.elapsed);
      for (const receipt of job.staging.traffic.outbox) job.finished!.push(receipt);
      job.staging.traffic.outbox = [];
      if (job.next === job.scenario.requests && job.staging.traffic.totals.completed + job.staging.traffic.totals.rejected + job.staging.traffic.totals.abandoned + job.staging.traffic.totals.failed === job.scenario.requests) return true;
    } else {
      const run = job.run!; run.requests = job.requests;
      if (job.scenario.interrupt) for (const r of run.requests) if (!r.result && r.committed && !r.paid) { finishRequest(r, 'ABANDONED', 'DEADLINE', job.elapsed); settleReservation(r, run.inventory); }
      advanceConcurrency(run, job.elapsed);
      if (run.requests.every(r => r.result)) return true;
    }
  }
  return false;
}
function expectedPrice(job: TestJob) {
  let price = 45, applied = false;
  const modules = job.staging.runtime.releases[job.staging.version]?.modules ?? [];
  for (const m of modules) {
    const c = m.configuration;
    if ((c.kind === 'discount' || c.kind === 'coupon') && (c.audience === 'all' || job.scenario.newCustomer) && (c.kind !== 'coupon' || job.scenario.coupons > 0) && (!applied || c.stackable)) { price = Math.round(price * (1 - c.percent / 100) * 100) / 100; applied = true; }
  }
  return price;
}
export function testReport(job: TestJob, at: number): Report {
  const requests = job.scenario.suite === 'load' ? job.finished! : job.requests;
  if (requests.length !== job.scenario.requests || requests.some(r => !r.result)) throw new Error('Cantidad QA incompleta.');
  const sum = (fn: (r: typeof requests[number]) => number) => requests.reduce((total,r) => total + fn(r), 0);
  const paid = sum(r => Number(r.paid && !r.duplicates && r.committed > r.oversold));
  const observed = { revenue: Math.round(sum(r => r.result!.revenue) * 100) / 100, committed: sum(r => r.committed), accepted: paid, duplicates: sum(r => r.duplicates ?? 0), pendingReservations: sum(r => Number(r.committed > 0 && !r.paid)) };
  const expected = { revenue: Math.round(paid * expectedPrice(job) * 100) / 100, maxCommitted: Math.min(job.scenario.requests, job.scenario.stock), accepted: job.scenario.attack !== 'none' || job.scenario.invalidInput || job.scenario.interrupt ? 0 : paid };
  if (job.scenario.duplicateIntent) expected.maxCommitted = Math.min(1, job.scenario.stock);
  const passed = observed.revenue === expected.revenue && observed.committed <= expected.maxCommitted && observed.duplicates === 0 && observed.pendingReservations === 0 && observed.accepted === expected.accepted && (job.scenario.suite !== 'load' || requests.every(r => r.result?.status === 'COMPLETED'));
  const evidence: TestEvidence = { input: job.scenario, expected, observed, passed, outcomes: requests.map(r => ({ id: r.id, status: r.status, revenue: r.result!.revenue, committed: r.committed, price: r.price ?? 45, attempts: 1 + (r.retryCount ?? 0) })), graphHash: createHash('sha256').update(JSON.stringify([job.staging.backend, job.staging.security, job.staging.version])).digest('hex'), elapsed: job.elapsed };
  job.evidence = evidence;
  return { suite: job.scenario.suite, requests: requests.length, completed: sum(r => Number(r.status === 'COMPLETED')), rejected: sum(r => Number(r.status === 'REJECTED')), abandoned: sum(r => Number(r.status === 'ABANDONED')), failed: sum(r => Number(r.status === 'FAILED')), oversold: sum(r => r.oversold), duplicates: observed.duplicates, breaches: job.scenario.attack !== 'none' ? sum(r => Number(r.committed > 0)) : 0, latency: Math.round(sum(r => (r.result!.at - r.arrivalAt) * 1000) / requests.length), tick: at, testEvidence: evidence };
}
export function scenarioForSuite(suite: string): TestScenario {
  const base: TestScenario = { suite: 'unit', requests: 1, stock: 100, concurrency: 1, retries: 0, duplicateIntent: false, coupons: 1, newCustomer: true, invalidInput: false, attack: 'none', interrupt: false };
  if (suite === 'Concurrencia') return { ...base, suite: 'concurrency', requests: 200, stock: 1, concurrency: 200 };
  if (suite === 'Integración') return { ...base, suite: 'integration', coupons: 2 };
  if (suite === 'Seguridad') return { ...base, suite: 'security', requests: 30, concurrency: 30, attack: 'injection' };
  if (suite === 'Carga') return { ...base, suite: 'load', requests: 200, concurrency: 100 };
  if (suite === 'Regresión') return { ...base, suite: 'regression', requests: 50, concurrency: 50, duplicateIntent: true, coupons: 2 };
  return base;
}
