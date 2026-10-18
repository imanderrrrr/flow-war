import type { Change, Company, Report, ScenarioContext } from '../shared/types.js';
import { admitTraffic, advanceTraffic, initialTraffic } from './traffic.js';

export function createLoadRun(company: Company, context: ScenarioContext, at: number): NonNullable<Change['qaLoad']> {
  const staging = { ...structuredClone(company), backend: structuredClone(context.backend), security: structuredClone(context.security), version: context.executionVersion,
    id: company.id, capital: 10000, infraBudget: 750, servers: 1, balancer: false, eliminated: false,
    requests: 0, successes: 0, errors: 0, breaches: 0, oversold: 0, duplicates: 0, revenue: 0, lostRevenue: 0,
    stock: 100, traffic: initialTraffic(100, 7357, 'qa-load') };
  staging.traffic.scope = 'qa';
  // Versioned fixture deliberately offers more waiting room than the baseline:
  // some requests hit their individual patience before the buffer rejects all excess.
  staging.traffic.config.queues.web = 80;
  staging.traffic.services.web.capacity = 80;
  return { company: staging, startedAt: at, elapsed: 0, maxQueue: 0, latencySum: 0, terminated: 0 };
}

/** Fixed staging: 40 arrivals/s for 8 s, then drain/expire through second 24.
 * One simulated QA tick executes 1 s of this isolated fixture, in 100ms steps.
 */
export function advanceLoadRun(run: NonNullable<Change['qaLoad']>) {
  for (let step = 0; step < 10 && run.elapsed < 24; step++) {
    run.elapsed = Math.round((run.elapsed + .1) * 10) / 10;
    if (run.elapsed <= 8) for (let index = 0; index < 4; index++) admitTraffic(run.company, run.elapsed, run.company.traffic.sequence % 10 < 7 ? 'browse' : 'purchase');
    advanceTraffic(run.company, run.elapsed);
    run.maxQueue = Math.max(run.maxQueue, run.company.queue);
    for (const receipt of run.company.traffic.outbox) { run.latencySum += receipt.latencyMs!; run.terminated++; }
    run.company.traffic.outbox = [];
  }
  return run.elapsed >= 24;
}

export function loadReport(run: NonNullable<Change['qaLoad']>, tick: number): Report {
  const totals = run.company.traffic.totals;
  return { suite: 'Carga', requests: totals.generated, completed: totals.completed, rejected: totals.rejected, abandoned: totals.abandoned, failed: totals.failed,
    oversold: totals.oversold, breaches: run.company.breaches, duplicates: 0, latency: run.terminated ? Math.round(run.latencySum / run.terminated) : 0, tick,
    loadEvidence: { engineVersion: run.company.traffic.config.version, fixture: 'load-fifo-1', seed: 7357, maxQueue: run.maxQueue,
      pending: totals.generated - totals.completed - totals.rejected - totals.abandoned - totals.failed } };
}

export function runLoadFixture(company: Company, context: ScenarioContext, tick: number) {
  const run = createLoadRun(company, context, tick);
  while (!advanceLoadRun(run)) { /* bounded fixture */ }
  return loadReport(run, tick);
}
