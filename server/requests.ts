import { hasDefect } from './defects.js';
import { executeBlock, releaseResources } from './blocks.js';
import { executeModule, settleReservation, activation } from './module-execution.js';
import { initialOperations } from './artifacts.js';
import type { OperationRuntime } from '../shared/simulation.js';
import { customerColor } from './market.js';
import { createHash } from 'node:crypto';
import type { Company, ConcurrencyRun, FlowParticle, PurchaseRequest, Report, RequestResult, RequestStage, ScenarioContext, InventoryState } from '../shared/types.js';
import { evaluateSecurity, route } from './graphs.js';

export const REQUEST_ENGINE_VERSION = 'requests-4a' as const;
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
        executor: 'requests-4a', execution: context.execution && structuredClone(context.execution), newCustomer: true, couponCount: 1, executionVersion: context.executionVersion, path: structuredClone(route(context.backend)),
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
  const legitimateUnits = commercial && request.paid && !request.duplicateBusiness ? request.committed - request.oversold : 0;
  const evidence:string[]=[];let defectLoss=0;
  if(request.effectCodes?.includes('D02')&&legitimateUnits>0){defectLoss+=Math.max(0,(request.contractPrice??request.price??45)-(request.price??45))*legitimateUnits;evidence.push('D02:contractual-price-minus-paid-price');}
  if(request.effectCodes?.includes('D03')&&(request.duplicates??0)>0){defectLoss+=(request.duplicates??0)*8;evidence.push('D03:duplicate-compensation');}
  if(request.effectCodes?.includes('D01')&&request.oversold>0){defectLoss+=request.oversold*8;evidence.push('D01:oversell-compensation');}
  request.status = status;
  request.result = {
    ...(evidence.length?{defectLoss:{amount:Math.round(defectLoss*100)/100,evidence}}:{}),
    status, reason, at,
    revenue: legitimateUnits * (request.price ?? 45),
    capitalDelta: legitimateUnits * ((request.price ?? 45) - 42) - request.oversold * 8 - (request.duplicates ?? 0) * 8,
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
    executePurchaseOperation(request, run.inventory, now, run.operationsState ??= initialOperations());
    run.operations.push({ requestId: request.id, nodeId: node.id, type: node.type, at: now, stock: inventory.stock, version: inventory.version });
    if (!request.waitOperation) request.cursor++;
    request.nextAt = roundTime(now + OPERATION_SECONDS);
  }
  for (const request of run.requests) { settleReservation(request, run.inventory); if (request.result && run.operationsState) releaseResources(request, run.operationsState); }
}

export function cancelConcurrency(run: ConcurrencyRun, at: number, reason: 'ROOM_FINISHED' | 'COMPANY_ELIMINATED') {
  for (const request of run.requests) { finishRequest(request, 'ABANDONED', reason, at); settleReservation(request, run.inventory); if (run.operationsState) releaseResources(request, run.operationsState); }
}

export function concurrencyReport(run: ConcurrencyRun, tick: number): Report {
  if (!isRunFinished(run)) throw new Error('La ejecución aún no ha terminado.');
  const count = (status: PurchaseRequest['status']) => run.requests.filter(request => request.status === status).length;
  return {
    suite: 'Concurrencia', requests: run.requests.length, completed: count('COMPLETED'), rejected: count('REJECTED'),
    abandoned: count('ABANDONED'), failed: count('FAILED'), oversold: run.inventory.oversold, breaches: 0, duplicates: run.requests.reduce((sum,r)=>sum+(r.duplicates??0),0),
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
export function executePurchaseOperation(request: PurchaseRequest, inventory: InventoryState, now: number, ops: OperationRuntime = initialOperations()) {
  request.waitOperation = false;
  const node = request.path[request.cursor];
  if (!node) { finishRequest(request, 'FAILED', 'INVALID_FLOW', now); return; }
  if (request.executor === 'requests-1' && ['lock','queue','retry','idempotency','cache','validation','module'].includes(node.type)) { finishRequest(request, 'REJECTED', 'UNSUPPORTED_BLOCK', now); return; }
  switch (node.type) {
      case 'entry':
        moveRequest(request, 'security', now);
        if (!request.securityAllowed) finishRequest(request, 'REJECTED', 'SECURITY_REJECTED', now);
        break;
      case 'read':
        moveRequest(request, 'inventory', now);
        request.read = request.cachedRead ?? { stock: inventory.stock, version: inventory.version };
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
        if (excess && request.execution?.modules.some(m=>hasDefect(m,'D01'))) activation(request,'D01');
        releaseResources(request, ops, 'stock');
        if (request.invalidateCache) ops.cache = {};
        break;
      }
      case 'module': {
        const module = request.execution?.modules.find(m => m.id === node.data.module?.id && m.version === node.data.module?.version);
        if (!module) { finishRequest(request, 'FAILED', 'INVALID_FLOW', now); break; }
        const result = executeModule(request, module, inventory, now, ops);
        if (result === 'INVALID') finishRequest(request, 'REJECTED', 'INVALID_FLOW', now);
        if (result === 'STOCK') finishRequest(request, 'REJECTED', 'OUT_OF_STOCK', now);
        if (result === 'DUPLICATE') finishRequest(request, 'COMPLETED', 'OK', now);
        break;
      }
      case 'lock': case 'queue': case 'retry': case 'idempotency': case 'cache': case 'validation': {
        const result = executeBlock(request, node, inventory, now, ops);
        if (result === 'INVALID') finishRequest(request, 'REJECTED', 'INVALID_FLOW', now);
        if (result === 'STOCK') finishRequest(request, 'REJECTED', 'OUT_OF_STOCK', now);
        if (result === 'FULL') finishRequest(request, 'REJECTED', 'QUEUE_FULL', now);
        if (result === 'DUPLICATE') finishRequest(request, 'COMPLETED', 'OK', now);
        break;
      }
      case 'payment': {
        moveRequest(request, 'payment', now);
        if (request.deferUntil && now < request.deferUntil) { request.waitOperation = true; break; }
        if (!request.committed || (request.paid && !request.retryingPayment)) { finishRequest(request, 'FAILED', 'INVALID_FLOW', now); break; }
        if (request.promotion && !request.promotionApplied && (request.promotion.audience === 'all' || request.newCustomer)) { request.price = Math.round((request.price ?? 45) * (1 - request.promotion.percent / 100) * 100) / 100; request.contractPrice = Math.round((request.contractPrice ?? 45) * (1 - request.promotion.percent / 100) * 100) / 100; request.promotionApplied = true; }
        const trackPayment = Boolean(request.retryPolicy || request.idempotentUntil || request.execution?.modules.some(m => m.configuration.kind === 'purchase') || (request.intentId && request.intentId !== `${request.id}-intent`));
        const key = `payment:${request.intentId ?? request.id}`, seen = trackPayment ? ops.payments[key] : undefined;
        if (!(seen && seen.until > now && (request.idempotentUntil ?? 0) > now)) {
          if (seen && seen.until > now) { if (seen.owner !== request.id) request.duplicateBusiness = true; request.duplicates = (request.duplicates ?? 0) + 1; ops.counters.duplicates++; if (request.execution?.modules.some(m=>hasDefect(m,'D03'))) activation(request,'D03'); }
          if (trackPayment) ops.payments[key] = { until: now + 300, owner: request.id };
        }
        request.paid = true;
        if ((request.transportFailures ?? 0) > 0) {
          request.transportFailures!--;
          const policy = request.retryPolicy, count = request.retryCount ?? 0;
          if (policy && count + 1 < policy.maxAttempts && now + policy.delayMs / 1000 < request.deadline) {
            request.retryCount = count + 1; ops.counters.retries++; request.retryingPayment = true;
            request.deferUntil = now + policy.delayMs / 1000; request.waitOperation = true;
          } else finishRequest(request, 'FAILED', 'DEADLINE', now);
        } else { request.retryingPayment = false; releaseResources(request, ops, 'payment'); }
        break;
      }
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
