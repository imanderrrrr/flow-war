import { executionFor } from './artifacts.js';
import { attachCustomer, recordCustomerExperience, selectCustomer } from './market.js';
import type { Company, ConcurrencyState, ScenarioContext } from '../shared/types.js';
import { advanceConcurrency, createConcurrencyRun, isRunFinished } from './requests.js';

export function initialConcurrency(duration: number, tick = -1): ConcurrencyState {
  const first = duration * .24;
  const nextAt = tick < first ? first : first + (Math.floor((tick - first) / 45) + 1) * 45;
  return { nextAt, sequence: 0, totals: { generated: 0, completed: 0, rejected: 0, abandoned: 0, failed: 0, committed: 0, oversold: 0, revenue: 0, lostRevenue: 0, capitalDelta: 0 } };
}

export function productionContext(company: Company): ScenarioContext {
  return { backend: company.backend, security: company.security, executionVersion: company.version, execution: executionFor(company) };
}

/** The only admission point for production's LAST-UNIT requests. */
export function startConcurrency(company: Company, at: number) {
  const state = company.concurrency;
  if (company.eliminated || (state.run && !isRunFinished(state.run))) return false;
  const customers = [selectCustomer(company), selectCustomer(company)];
  if (customers.some(customer => !customer)) return false;
  settleConcurrency(company);
  state.run = createConcurrencyRun(`C${company.id}-CC${++state.sequence}`, productionContext(company), at);
  state.run.requests.forEach((request, index) => attachCustomer(company, request, customers[index]!));
  state.totals.generated += state.run.requests.length;
  company.requests += state.run.requests.length;
  return true;
}

/** Persists the settlement flag together with counters and money in one snapshot. */
export function settleConcurrency(company: Company) {
  const state = company.concurrency;
  let newOversold = 0;
  for (const request of state.run?.requests ?? []) {
    if (!request.result || request.accounted) continue;
    const result = request.result;
    const key = { COMPLETED: 'completed', REJECTED: 'rejected', ABANDONED: 'abandoned', FAILED: 'failed' } as const;
    state.totals[key[result.status]]++;
    state.totals.committed += request.committed;
    state.totals.oversold += request.oversold;
    state.totals.revenue += result.revenue;
    state.totals.lostRevenue += result.lostRevenue;
    state.totals.capitalDelta += result.capitalDelta;
    company.successes += Number(result.status === 'COMPLETED');
    company.errors += Number(result.status !== 'COMPLETED');
    company.revenue += result.revenue;
    company.lostRevenue += result.lostRevenue;
    company.capital += result.capitalDelta;
    company.oversold += request.oversold;
    newOversold += request.oversold;
    recordCustomerExperience(company, request, 'purchase', (result.at - request.arrivalAt) * 1000);
    request.accounted = true;
  }
  return newOversold;
}

export function stepConcurrency(company: Company, at: number, available: boolean) {
  const state = company.concurrency;
  let started = false;
  if (at >= state.nextAt) {
    started = startConcurrency(company, at);
    state.nextAt += (Math.floor((at - state.nextAt) / 45) + 1) * 45;
  }
  if (state.run) advanceConcurrency(state.run, at, available);
  const oversold = settleConcurrency(company);
  const finished = state.run && isRunFinished(state.run) && state.reportedRunId !== state.run.id;
  if (finished) state.reportedRunId = state.run!.id;
  return { started, oversold, finished };
}
