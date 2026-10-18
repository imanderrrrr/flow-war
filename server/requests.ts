import { customerColor } from './market.js';
import { createHash } from 'node:crypto';
import type { Company, ConcurrencyRun, FlowParticle, PurchaseRequest, Report, RequestResult, RequestStage, ScenarioContext, InventoryState } from '../shared/types.js';
import { evaluateSecurity, route } from './graphs.js';

export const REQUEST_ENGINE_VERSION = 'requests-1' as const;
export const OPERATION_SECONDS = .5;
const roundTime = (time: number) => Math.round(time * 1000) / 1000;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** One SKU, two distinct purchase intentions. Graphs are frozen at admission. */
export function createConcurrencyRun(id: string, context: ScenarioContext, at: number, offsets: [number, number] = [0, 0]): ConcurrencyRun {
  return {
    id, engineVersion: REQUEST_ENGINE_VERSION, fixture: 'last-unit-1', startedAt: at,
    backendHash: hash(context.backend), securityHash: hash(context.security),
    inventory: { sku: 'LAST-UNIT', initialStock: 1, stock: 1, version: 0, committed: 0, oversold: 0 },
    operations: [],
    requests: offsets.map((offset, index) => {
      const arrivalAt = roundTime(at + offset);
      return {
        id: `${id}-R${index + 1}`, intentId: `${id}-purchase-${index + 1}`,
        executionVersion: context.executionVersion, path: structuredClone(route(context.backend)),
        securityAllowed: evaluateSecurity(context.security, 'valid', index),
        arrivalAt, nextAt: roundTime(arrivalAt + OPERATION_SECONDS), deadline: roundTime(arrivalAt + 16),
        cursor: 0, status: 'PENDING', atomic: false, quantity: 1, committed: 0, oversold: 0,
        paid: false, accounted: false,
        journey: { from: 'entry', to: 'entry', at: arrivalAt, duration: OPERATION_SECONDS },
      };
    }),
  };
}

export function isRunFinished(run: ConcurrencyRun) { return run.requests.every(request => request.result !== undefined); }

export function moveRequest(request: PurchaseRequest, stage: RequestStage, at: number) {
  if (request.journey.to === stage) return;
  request.journey = { from: request.journey.to, to: stage, at, duration: OPERATION_SECONDS };
}

export function finishRequest(request: PurchaseRequest, status: RequestResult['status'], reason: RequestResult['reason'], at: number) {
  if (request.result) return;
  const commercial = request.commercial !== false;
  const legitimateUnits = commercial && request.paid ? request.committed - request.oversold : 0;
  request.status = status;
  request.result = {
    status, reason, at,
    revenue: legitimateUnits * 45,
    capitalDelta: legitimateUnits * 3 - request.oversold * 8,
    lostRevenue: !commercial || request.paid ? 0 : request.quantity * 45,
  };
}

/** Each round executes at most one node per request, in stable admission order.
 * Both reads therefore happen before either write, without precomputing outcomes.
 * Repeating the same timestamp cannot repeat a node or terminal effect.
 */
export function advanceConcurrency(run: ConcurrencyRun, now: number, available = true) {
  for (const request of run.requests) {
    if (request.result || now < request.arrivalAt) continue;
    if (now >= request.deadline) { finishRequest(request, 'ABANDONED', 'DEADLINE', now); continue; }
    if (!available || now < request.nextAt) continue;
    request.status = 'RUNNING';
    const node = request.path[request.cursor];
    if (!node) { finishRequest(request, 'FAILED', 'INVALID_FLOW', now); continue; }
    const inventory = run.inventory;
    executePurchaseOperation(request, run.inventory, now);
    run.operations.push({ requestId: request.id, nodeId: node.id, type: node.type, at: now, stock: inventory.stock, version: inventory.version });
    request.cursor++;
    request.nextAt = roundTime(now + OPERATION_SECONDS);
  }
}

export function cancelConcurrency(run: ConcurrencyRun, at: number, reason: 'ROOM_FINISHED' | 'COMPANY_ELIMINATED') {
  for (const request of run.requests) finishRequest(request, 'ABANDONED', reason, at);
}

export function concurrencyReport(run: ConcurrencyRun, tick: number): Report {
  if (!isRunFinished(run)) throw new Error('La ejecución aún no ha terminado.');
  const count = (status: PurchaseRequest['status']) => run.requests.filter(request => request.status === status).length;
  return {
    suite: 'Concurrencia', requests: run.requests.length, completed: count('COMPLETED'), rejected: count('REJECTED'),
    abandoned: count('ABANDONED'), failed: count('FAILED'), oversold: run.inventory.oversold, breaches: 0, duplicates: 0,
    latency: Math.round(run.requests.reduce((sum, request) => sum + (request.result!.at - request.arrivalAt) * 1000, 0) / run.requests.length), tick,
    evidence: {
      engineVersion: run.engineVersion, fixture: run.fixture, backendHash: run.backendHash, securityHash: run.securityHash,
      executionVersion: run.requests[0].executionVersion, seed: 0, inventory: { ...run.inventory },
      outcomes: run.requests.map(request => ({ requestId: request.id, status: request.status, reason: request.result!.reason, read: request.read && { ...request.read }, committed: request.committed, oversold: request.oversold })),
    },
  };
}

export function runConcurrencyFixture(context: ScenarioContext): ConcurrencyRun {
  const run = createConcurrencyRun('fixture', context, 0);
  for (let tick = 1; !isRunFinished(run) && tick <= 200; tick++) advanceConcurrency(run, tick / 10);
  return run;
}

export function concurrencyParticles(run: ConcurrencyRun | undefined, color: string, tick: number, company?: Company): FlowParticle[] {
  if (!run) return [];
  return run.requests.filter(request => tick >= request.arrivalAt && (!request.result || tick - request.result.at < 5)).map((request, index) => ({
    id: request.id, requestId: request.id, executionVersion: request.executionVersion, status: request.status, reason: request.result?.reason,
    born: request.arrivalAt, duration: 21, route: 'purchase', seed: index ? .9 : .1,
    customerId: request.customerSource === 'market' ? request.customerId : undefined,
    color: company ? customerColor(company, request) : request.customerColor ?? color,
    kind: request.result && (request.status !== 'COMPLETED' || request.oversold > 0) ? 'error' : 'success',
    journey: structuredClone(request.journey),
  }));
}

/** Shared inventory/payment interpreter used by both individual traffic cohorts. */
export function executePurchaseOperation(request: PurchaseRequest, inventory: InventoryState, now: number) {
  const node = request.path[request.cursor];
  if (!node) { finishRequest(request, 'FAILED', 'INVALID_FLOW', now); return; }
  switch (node.type) {
      case 'entry':
        moveRequest(request, 'security', now);
        if (!request.securityAllowed) finishRequest(request, 'REJECTED', 'SECURITY_REJECTED', now);
        break;
      case 'read':
        moveRequest(request, 'inventory', now);
        request.read = { stock: inventory.stock, version: inventory.version };
        break;
      case 'atomic':
        // A late Atomic node cannot undo an already committed write.
        if (!request.committed) {
          request.atomic = true;
          request.quantity = Number(node.data.value ?? 1);
          if (!Number.isInteger(request.quantity) || request.quantity < 1 || request.quantity > 120) finishRequest(request, 'FAILED', 'INVALID_FLOW', now);
        }
        break;
      case 'write': {
        moveRequest(request, 'inventory', now);
        if (!request.read || request.committed) { finishRequest(request, 'FAILED', 'INVALID_FLOW', now); break; }
        const stock = request.atomic ? inventory.stock : request.read.stock;
        if (stock < request.quantity) { finishRequest(request, 'REJECTED', 'OUT_OF_STOCK', now); break; }
        const excess = Math.max(0, request.quantity - inventory.stock);
        // Unsafe write uses the value actually read by this request. Atomic checks
        // and updates the current stock/version in this same indivisible operation.
        // An older preliminary read is not a conflict when current stock suffices.
        inventory.stock = Math.max(0, inventory.stock - request.quantity);
        inventory.version++;
        inventory.committed += request.quantity;
        inventory.oversold += excess;
        request.committed = request.quantity;
        request.oversold = excess;
        break;
      }
      case 'payment':
        moveRequest(request, 'payment', now);
        if (!request.committed || request.paid) finishRequest(request, 'FAILED', 'INVALID_FLOW', now);
        else request.paid = true;
        break;
      case 'exit':
        moveRequest(request, 'exit', now);
        finishRequest(request, request.paid ? 'COMPLETED' : 'FAILED', request.paid ? 'OK' : 'INVALID_FLOW', now);
        break;
      default:
        // Unimplemented blocks never confer a protection we have not executed.
        moveRequest(request, request.read ? 'inventory' : 'checkout', now);
        finishRequest(request, 'REJECTED', 'UNSUPPORTED_BLOCK', now);
    }
}
