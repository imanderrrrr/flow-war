import { releaseResources, pruneOperations } from './blocks.js';
import { admitSecurity } from './security.js';
import { settleReservation } from './module-execution.js';
import { initialOperations } from './artifacts.js';
import { executionFor } from './artifacts.js';
import { effectiveServers } from './infrastructure.js';
import { attachCustomer, customerColor, recordCustomerExperience, selectCustomer } from './market.js';
import type { MarketCustomer, ServiceQueue, Company, FlowParticle, InventoryState, RequestResult, ScenarioTotals, ServiceId, TrafficMetrics, TrafficReceipt, TrafficRequest, TrafficScenario, TrafficState, TrafficView } from '../shared/types.js';
import { evaluateSecurity, route } from './graphs.js';
import { executePurchaseOperation, finishRequest, moveRequest } from './requests.js';

export const SERVICE_IDS: ServiceId[] = ['security', 'web', 'checkout', 'inventory', 'payment'];
export const TRAFFIC_SCENARIO: TrafficScenario = {
  version: 'traffic-2.0', restockPerSecond: 24, quality: { healthyLatencyMs: 1000, latencyCeilingMs: 3000 }, patience: { browse: 4, query: 6, purchase: 10 },
  rates: { security: 120, web: 12, checkout: 12, inventory: 64, payment: 24 },
  queues: { security: 240, web: 40, checkout: 40, inventory: 40, payment: 40 },
  delays: { security: .1, web: .2, checkout: .1, inventory: .2, payment: .2 },
  window: 10, retention: 3,
};
export const emptyTotals = (): ScenarioTotals => ({ generated: 0, completed: 0, rejected: 0, abandoned: 0, failed: 0, committed: 0, oversold: 0, revenue: 0, lostRevenue: 0, capitalDelta: 0 });
const emptyMetrics = (): TrafficMetrics => ({ legitimateTerminated: 0, errors: 0, rejected: 0, abandoned: 0, failed: 0, latencyMs: null, errorRate: 0, utilization: 0, unavailable: 0, fraudRate: 0 });
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function initialTraffic(stock = 100, seed = 7357, namespace = 'g0', tick = 0, config = TRAFFIC_SCENARIO): TrafficState {
  return {
    namespace, seed, config: structuredClone(config), sequence: 0, initialIssued: false, initialDebt: 0, arrivalRemainder: 0, attackRemainder: 0, attackSequence: 0, lastTick: tick,
    inventory: { sku: 'REGULAR', initialStock: stock, stock, version: 0, committed: 0, oversold: 0, supplied: 0 },
    paths: {}, services: SERVICE_IDS.reduce((queues, id) => { queues[id] = { id, capacity: config.queues[id], waiting: [], processing: [], credit: 0, rate: 0, started: 0, offered: 0 }; return queues; }, {} as Record<ServiceId, ServiceQueue>),
    requests: {}, totals: emptyTotals(), legitimate: emptyTotals(), malicious: emptyTotals(), metrics: emptyMetrics(), observations: [], capacityWindow: [], outbox: [], unresolvedCount: 0,
  };
}

export function serviceRates(company: Company, deployment?: { strategy?: string }): Record<ServiceId, number> {
  const config = company.traffic.config;
  const paid = company.infraBudget > 0 && company.capital > 0 && !company.eliminated;
  let servers = effectiveServers(company);
  if (!paid || deployment?.strategy === 'restart') servers = 0;
  else if (deployment) servers *= company.servers === 1 ? .12 : (company.servers - 1) / company.servers;
  const available = servers > 0;
  const rates = { security: available ? config.rates.security : 0, web: config.rates.web * servers, checkout: config.rates.checkout * servers, inventory: available ? config.rates.inventory : 0, payment: available ? config.rates.payment : 0 };
  for (const service of company.infrastructure?.stoppedServices ?? []) rates[service] = 0;
  return rates;
}

function enqueue(company: Company, request: TrafficRequest, service: ServiceId, now: number) {
  const queue = company.traffic.services[service];
  for (const id of queue.waiting) { const waiting = company.traffic.requests[id]; if (!waiting.result && now >= waiting.deadline) terminate(waiting, 'ABANDONED', 'DEADLINE', now); }
  queue.waiting = queue.waiting.filter(id => !company.traffic.requests[id].result);
  request.service = service; request.stage = service;
  moveRequest(request, service, now);
  if (queue.waiting.length >= queue.capacity) { terminate(request, 'REJECTED', 'QUEUE_FULL', now); return; }
  request.status = 'QUEUED'; request.admittedAt ??= now; request.queueEnteredAt = now;
  request.waits.push({ service, enteredAt: now, position: queue.waiting.length });
  queue.waiting.push(request.id); queue.offered++;
}

export function admitTraffic(company: Company, now: number, type: TrafficRequest['type'] = 'browse', trafficClass: TrafficRequest['trafficClass'] = 'legitimate', attackKind?: TrafficRequest['attackKind'], selected?: MarketCustomer): TrafficRequest {
  if (company.eliminated) throw new Error('Empresa eliminada.');
  const customer = trafficClass === 'legitimate' && company.traffic.scope !== 'qa' ? selected ?? selectCustomer(company) : undefined;
  if (trafficClass === 'legitimate' && company.traffic.scope !== 'qa' && !customer) throw new Error('No hay cliente admisible.');
  const state = company.traffic, ordinal = ++state.sequence;
  const id = `${state.namespace}-C${company.id}-O${ordinal}`;
  const executionPath = state.paths[company.version] ??= structuredClone(route(company.backend));
  const path = type === 'query' ? executionPath.filter(node => ['entry', 'read', 'exit'].includes(node.type)) : executionPath;
  const request: TrafficRequest = {
    id, ...(type === 'purchase' ? { intentId: `${id}-intent` } : {}), companyId: company.id,
    ...(trafficClass === 'legitimate' && state.scope === 'qa' ? { customerId: `qa-${company.id}-${ordinal}`, customerSource: 'qa' as const } : {}),
    type, trafficClass, ...(attackKind ? { attackKind } : {}), attempt: 0, commercial: type === 'purchase' && trafficClass === 'legitimate',
    loadDepth: state.services.web.waiting.length + state.services.checkout.waiting.length, execution: executionFor(company), newCustomer: customer ? customer.successfulVisits === 0 : true, couponCount: 1, executionVersion: company.version, path, securityAllowed: admitSecurity(company, executionFor(company), trafficClass === 'legitimate' ? 'valid' : attackKind ?? 'bot', ordinal - 1, now, `sim-${trafficClass === 'malicious' ? 64 + ordinal % 16 : customer ? customer.cohort % 64 : ordinal % 64}`, customer?.id, type),
    arrivalAt: now, nextAt: now, deadline: round(now + state.config.patience[type]), cursor: 1,
    status: 'PENDING', atomic: false, quantity: 1, committed: 0, oversold: 0, paid: false, accounted: false,
    service: 'security', stage: 'entry', phase: 'security', transaction: 'NONE', breach: false, waits: [], trace: [],
    journey: { from: 'entry', to: 'entry', at: now, duration: .2 },
  };
  if (customer) attachCustomer(company, request, customer);
  state.requests[id] = request;
  state.totals.generated++; state[trafficClass].generated++; company.requests++;
  enqueue(company, request, 'security', now);
  return request;
}

export function issueInitialTraffic(company: Company, at: number) {
  if (company.traffic.initialIssued || company.eliminated) return;
  company.traffic.initialIssued = true; company.traffic.initialDebt = 1;
  const customer = selectCustomer(company);
  if (customer) admitTraffic(company, at, 'browse', 'legitimate', undefined, customer);
}

function terminate(request: TrafficRequest, status: RequestResult['status'], reason: RequestResult['reason'], now: number) {
  if (request.finishedAt !== undefined) return;
  if (!request.result) finishRequest(request, status, reason, now);
  request.stage = request.journey.to;
  request.finishedAt = now; request.latencyMs = Math.round((now - request.arrivalAt) * 1000);
  request.result!.service = request.service;
  request.result!.operation = request.phase === 'backend' ? request.path[request.cursor]?.type : request.phase;
  const visit = request.waits.at(-1);
  if (visit && visit.exitedAt === undefined) { visit.exitedAt = now; visit.exit = reason === 'DEADLINE' ? 'DEADLINE' : 'CANCELLED'; request.queueExitedAt = now; }
  request.transaction = request.oversold || (request.committed && !request.paid) ? 'PENDING_RESOLUTION' : request.paid ? 'CONFIRMED' : 'NONE';
}

function backendService(request: TrafficRequest): ServiceId {
  const type = request.path[request.cursor]?.type;
  return type === 'read' && request.cachedRead ? 'checkout' : type === 'payment' ? 'payment' : ['read', 'write', 'atomic', 'validation', 'lock'].includes(type) ? 'inventory' : 'checkout';
}

function completeOperation(company: Company, request: TrafficRequest, now: number) {
  const state = company.traffic;
  request.trace.push({ type: request.phase === 'backend' ? request.path[request.cursor]?.type ?? 'invalid' : request.phase, at: now });
  if (request.phase === 'security') {
    if (!request.securityAllowed) terminate(request, 'REJECTED', 'SECURITY_REJECTED', now);
    else { request.phase = 'web'; enqueue(company, request, 'web', now); }
  } else if (request.phase === 'web') {
    if (request.type === 'browse') { moveRequest(request, 'exit', now); terminate(request, 'COMPLETED', 'OK', now); }
    else { request.phase = 'checkout'; enqueue(company, request, 'checkout', now); }
  } else if (request.phase === 'checkout') {
    request.phase = 'backend'; enqueue(company, request, backendService(request), now);
  } else {
    if (request.type === 'query') {
      request.read = { stock: state.inventory.stock, version: state.inventory.version };
      moveRequest(request, 'exit', now); terminate(request, 'COMPLETED', 'OK', now);
      return;
    }
    const type = request.path[request.cursor]?.type;
    executePurchaseOperation(request, state.inventory, now, state.operations ??= initialOperations());
    const trace = request.trace.at(-1)!; trace.stock = state.inventory.stock; trace.version = state.inventory.version;
    if (type === 'write' && request.committed && request.trafficClass === 'malicious' && request.attackKind !== 'bot') request.breach = true;
    request.transaction = request.oversold ? 'PENDING_RESOLUTION' : request.paid ? 'CONFIRMED' : request.committed ? 'RESERVED' : 'NONE';
    if (request.result) {
      // The shared interpreter finalizes the result; add queue/transport metadata.
      const result = request.result;
      terminate(request, result.status, result.reason, now);
    } else { if (!request.waitOperation) request.cursor++; enqueue(company, request, backendService(request), now); }
  }
}

export function trafficReceipt(request: TrafficRequest): TrafficReceipt {
  const { execution, effectCodes, ...visible } = request;
  return { ...structuredClone(visible), path: request.path.map(node => ({ id: node.id, type: node.type, ...(node.data.value !== undefined ? { value: node.data.value } : {}) })) };
}

export function settleTraffic(company: Company, now: number) {
  const state = company.traffic;
  for (const request of Object.values(state.requests)) {
    if (!request.result || request.accounted) continue;
    settleReservation(request, state.inventory);
    if (state.operations) releaseResources(request, state.operations);
    const result = request.result;
    company.duplicates += request.duplicates ?? 0;
    for (const code of request.effectCodes ?? []) { const counters = (state.operations ??= initialOperations()).counters; counters.activations[code] = (counters.activations[code] ?? 0) + 1; }
    const key = { COMPLETED: 'completed', REJECTED: 'rejected', ABANDONED: 'abandoned', FAILED: 'failed' } as const;
    for (const totals of [state.totals, state[request.trafficClass]]) {
      totals[key[result.status]]++; totals.committed += request.committed; totals.oversold += request.oversold;
      totals.revenue += result.revenue; totals.lostRevenue += result.lostRevenue; totals.capitalDelta += result.capitalDelta;
    }
    company.successes += Number(result.status === 'COMPLETED'); company.errors += Number(result.status !== 'COMPLETED');
    company.revenue += result.revenue; company.lostRevenue += result.lostRevenue; company.capital += result.capitalDelta;
    company.oversold += request.oversold; company.breaches += Number(request.breach);
    if (request.trafficClass === 'legitimate') recordCustomerExperience(company, request, request.type, request.latencyMs!);
    request.accounted = true;
    if (request.transaction === 'PENDING_RESOLUTION') state.unresolvedCount++;
    state.observations.push({ at: now, legitimate: request.trafficClass === 'legitimate', status: result.status, latency: request.latencyMs!, breach: request.breach, oversold: request.oversold });
    state.outbox.push(trafficReceipt(request));
  }
}

export function advanceTraffic(company: Company, now: number, rates = serviceRates(company)) {
  const state = company.traffic;
  if (now <= state.lastTick) { settleTraffic(company, now); return; }
  const dt = round(now - state.lastTick); const prune = Math.floor(now) !== Math.floor(state.lastTick); state.lastTick = now;
  if (prune && state.operations) pruneOperations(state.operations, now);
  for (const request of Object.values(state.requests)) if (!request.result && now >= request.deadline) terminate(request, 'ABANDONED', 'DEADLINE', now);
  // Complete the prior tick's operations first. New work never executes in this tick.
  const completed = SERVICE_IDS.flatMap(id => rates[id] > 0 ? state.services[id].processing.filter(key => state.requests[key].nextAt <= now) : []);
  for (const key of completed) { const request = state.requests[key]; if (!request.result) completeOperation(company, request, now); }
  for (const id of SERVICE_IDS) {
    const queue = state.services[id], rate = rates[id];
    queue.processing = queue.processing.filter(key => state.requests[key].status === 'PROCESSING' && state.requests[key].service === id && !completed.includes(key));
    queue.waiting = queue.waiting.filter(key => !state.requests[key].result && state.requests[key].status === 'QUEUED' && state.requests[key].service === id);
    queue.rate = rate;
    queue.capacity = state.config.queues[id] * (id === 'web' || id === 'checkout' ? company.balancer ? company.servers : 1 : 1);
    queue.credit = rate > 0 ? Math.min(Math.max(1, rate * dt) + 1, round(queue.credit + rate * dt)) : 0;
    while (queue.credit >= 1 && queue.waiting.length) {
      const key = queue.waiting.shift()!, request = state.requests[key];
      request.status = 'PROCESSING'; request.startedAt ??= now; request.queueExitedAt = now;
      const visit = request.waits.at(-1)!; visit.exitedAt = now; visit.exit = 'SERVICE';
      request.nextAt = round(now + state.config.delays[id]); queue.processing.push(key); queue.started++; queue.credit = round(queue.credit - 1);
    }
  }
  settleTraffic(company, now);
  for (const [key, request] of Object.entries(state.requests)) if (request.accounted && now - request.result!.at > state.config.retention) delete state.requests[key];
  const versions = new Set(Object.values(state.requests).map(request => request.executionVersion));
  for (const version of Object.keys(state.paths)) if (!versions.has(Number(version))) delete state.paths[Number(version)];
  updateTrafficMetrics(company, now, dt, rates);
  company.stock = state.inventory.stock;
}

function updateTrafficMetrics(company: Company, now: number, dt: number, rates: Record<ServiceId, number>) {
  const state = company.traffic;
  const saturated = Math.max(...SERVICE_IDS.map(id => {
    const queue = state.services[id];
    return queue.waiting.length ? rates[id] > 0 ? 1 + Math.min(2, queue.waiting.length / Math.max(1, queue.capacity)) : 3 : queue.processing.length / Math.max(1, rates[id] * state.config.delays[id]);
  }));
  if (dt > 0) state.capacityWindow.push({ at: now, dt, utilization: saturated, unavailable: rates.web === 0 ? 1 : 0 });
  state.capacityWindow = state.capacityWindow.filter(sample => sample.at > now - state.config.window);
  state.observations = state.observations.filter(sample => sample.at > now - state.config.window);
  const legit = state.observations.filter(sample => sample.legitimate), totalTime = state.capacityWindow.reduce((sum, sample) => sum + sample.dt, 0);
  const avg = (key: 'utilization' | 'unavailable') => totalTime ? state.capacityWindow.reduce((sum, sample) => sum + sample[key] * sample.dt, 0) / totalTime : 0;
  const errors = legit.filter(sample => sample.status !== 'COMPLETED').length;
  state.metrics = { legitimateTerminated: legit.length, errors, rejected: legit.filter(sample => sample.status === 'REJECTED').length, abandoned: legit.filter(sample => sample.status === 'ABANDONED').length, failed: legit.filter(sample => sample.status === 'FAILED').length,
    latencyMs: legit.length ? Math.round(legit.reduce((sum, sample) => sum + sample.latency, 0) / legit.length) : null,
    errorRate: legit.length ? errors / legit.length : 0, utilization: avg('utilization'), unavailable: avg('unavailable'),
    fraudRate: state.observations.length ? state.observations.filter(sample => sample.breach || sample.oversold).length / state.observations.length : 0 };
  company.queue = SERVICE_IDS.reduce((sum, id) => sum + state.services[id].waiting.length, 0);
  company.latency = state.metrics.latencyMs ?? 0; company.utilization = state.metrics.utilization;
  company.active = new Set(Object.values(state.requests).filter(request => !request.result && request.customerId).map(request => request.customerId)).size;
}

/** Arrival streams depend on seed/ordinal, never on visual sampling or other companies. */
export function generateTraffic(company: Company, at: number, dt: number, duration: number) {
  if (company.eliminated) return;
  const state = company.traffic;
  const demand = (5 + 295 * (at / duration) ** 1.25) * company.customers / 5000;
  state.arrivalRemainder = round(state.arrivalRemainder + demand * dt);
  while (state.arrivalRemainder >= 1) {
    state.arrivalRemainder = round(state.arrivalRemainder - 1);
    if (state.initialDebt) { state.initialDebt--; continue; }
    const ordinal = state.legitimate.generated;
    const offset = state.seed % 10;
    const customer = selectCustomer(company);
    if (customer) admitTraffic(company, at, (ordinal + offset) % 10 < 7 ? 'browse' : 'purchase', 'legitimate', undefined, customer);
  }
  if (at >= duration * .12) {
    state.attackRemainder = round(state.attackRemainder + (2 + 18 * at / duration) * dt);
    while (state.attackRemainder >= 1) {
      state.attackRemainder = round(state.attackRemainder - 1);
      admitTraffic(company, at, 'purchase', 'malicious', (['forged', 'injection', 'bot'] as const)[state.attackSequence++ % 3]);
    }
  }
}

export function restockTraffic(company: Company, amount = company.traffic.config.restockPerSecond) {
  const inventory = company.traffic.inventory;
  const added = Math.max(0, Math.min(amount, 200 - inventory.stock));
  if (added) { inventory.stock += added; inventory.supplied = (inventory.supplied ?? 0) + added; inventory.version++; }
  company.stock = inventory.stock;
}

export function cancelTraffic(company: Company, at: number, reason: 'ROOM_FINISHED' | 'COMPANY_ELIMINATED') {
  for (const request of Object.values(company.traffic.requests)) if (!request.result) terminate(request, 'ABANDONED', reason, at);
  for (const queue of Object.values(company.traffic.services)) { queue.waiting = []; queue.processing = []; }
  settleTraffic(company, at); updateTrafficMetrics(company, at, 0, serviceRates(company)); company.queue = 0; company.active = 0;
}

export function trafficView(state: TrafficState): TrafficView {
  return { scenario: state.config.version, totals: { ...state.totals }, legitimate: { ...state.legitimate }, malicious: { ...state.malicious }, metrics: { ...state.metrics }, inventory: { ...state.inventory },
    queues: SERVICE_IDS.map(id => ({ id, capacity: state.services[id].capacity, depth: state.services[id].waiting.length, processing: state.services[id].processing.length, rate: state.services[id].rate })), pendingResolution: state.unresolvedCount };
}

export function trafficParticles(company: Company, now: number, limit = 48): FlowParticle[] {
  const positions = new Map<string, { service: ServiceId; position: number; enteredAt: number; depth: number }>();
  const queueSample = new Set<string>();
  for (const id of SERVICE_IDS) {
    const waiting = company.traffic.services[id].waiting;
    waiting.forEach((key, position) => positions.set(key, { service: id, position, enteredAt: company.traffic.requests[key].queueEnteredAt!, depth: waiting.length }));
    const count = Math.min(12, waiting.length);
    for (let index = 0; index < count; index++) queueSample.add(waiting[Math.floor(index * (waiting.length - 1) / Math.max(1, count - 1))]);
  }
  const requests = Object.values(company.traffic.requests).filter(request => (request.status !== 'QUEUED' || queueSample.has(request.id)) && (!request.result || now - request.result.at < 3));
  // Stable admission-order sample, with queue heads represented before terminal tails.
  requests.sort((a, b) => Number(!!a.result) - Number(!!b.result) || a.arrivalAt - b.arrivalAt || a.id.localeCompare(b.id));
  return requests.slice(0, limit).map(request => ({ id: request.id, requestId: request.id, companyId: company.id, born: request.arrivalAt, duration: company.traffic.config.patience[request.type] + 3,
    customerId: request.customerSource === 'market' ? request.customerId : undefined, executionVersion: request.executionVersion, status: request.status, reason: request.result?.reason, finishedAt: request.finishedAt,
    route: request.type, seed: (request.id.length + request.arrivalAt * 10) % 10 / 10, color: request.trafficClass === 'malicious' ? company.color : customerColor(company, request),
    kind: request.trafficClass === 'malicious' ? 'attack' : request.result && (request.status !== 'COMPLETED' || request.oversold) ? 'error' : 'success',
    journey: { ...request.journey }, queue: positions.get(request.id),
  }));
}
