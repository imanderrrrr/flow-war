import type { GraphNode, InventoryState, PurchaseRequest } from '../shared/types.js';
import type { BlockConfiguration } from '../shared/blocks.js';
import type { OperationRuntime } from '../shared/simulation.js';
import { object, keys, integer, oneOf, bool } from './action-validation.js';

export function blockConfiguration(node: GraphNode): BlockConfiguration | undefined {
  const value = Number(node.data.value ?? 1);
  const defaults: Record<string, BlockConfiguration> = {
    lock: { kind: 'lock', resource: 'stock', ttlMs: value, acquisitionMs: 0 }, queue: { kind: 'queue', capacity: value, resource: 'stock' },
    retry: { kind: 'retry', maxAttempts: value, delayMs: 500, condition: 'payment_timeout' }, idempotency: { kind: 'idempotency', ttlSeconds: value, scope: 'purchase' },
    cache: { kind: 'cache', ttlSeconds: value, capacity: 16, invalidateOnWrite: false }, validation: { kind: 'validation', minimum: value, rejectInvalidInput: true },
  };
  if (!defaults[node.type]) return undefined;
  const p = object(node.data.config ?? defaults[node.type]);
  if (p.kind !== node.type) throw new Error('Configuración incompatible con la pieza.');
  switch (p.kind) {
    case 'lock': keys(p, ['kind','resource','ttlMs','acquisitionMs']); return { kind: 'lock', resource: oneOf(p.resource, ['stock','payment']), ttlMs: integer(p.ttlMs, 100, 30000), acquisitionMs: integer(p.acquisitionMs, 0, 5000) };
    case 'queue': keys(p, ['kind','resource','capacity']); return { kind: 'queue', resource: oneOf(p.resource, ['stock']), capacity: integer(p.capacity, 1, 500) };
    case 'retry': keys(p, ['kind','maxAttempts','delayMs','condition']); return { kind: 'retry', maxAttempts: integer(p.maxAttempts, 1, 6), delayMs: integer(p.delayMs, 100, 5000), condition: oneOf(p.condition, ['payment_timeout']) };
    case 'idempotency': keys(p, ['kind','ttlSeconds','scope']); return { kind: 'idempotency', ttlSeconds: integer(p.ttlSeconds, 1, 300), scope: oneOf(p.scope, ['purchase']) };
    case 'cache': keys(p, ['kind','ttlSeconds','capacity','invalidateOnWrite']); return { kind: 'cache', ttlSeconds: integer(p.ttlSeconds, 1, 300), capacity: integer(p.capacity, 1, 64), invalidateOnWrite: bool(p.invalidateOnWrite) };
    case 'validation': keys(p, ['kind','minimum','rejectInvalidInput']); return { kind: 'validation', minimum: integer(p.minimum, 1, 120), rejectInvalidInput: bool(p.rejectInvalidInput) };
  }
}
export function executeBlock(r: PurchaseRequest, node: GraphNode, inventory: InventoryState, now: number, ops: OperationRuntime): 'OK' | 'STOCK' | 'INVALID' | 'FULL' | 'DUPLICATE' {
  const c = blockConfiguration(node); if (!c) return 'INVALID';
  if (c.kind === 'lock') {
    const key = c.resource, lock = ops.locks[key];
    if (lock && lock.owner !== r.id && lock.until > now) { r.waitOperation = true; ops.counters.lockWaits++; return 'OK'; }
    r.acquireAt ??= now + c.acquisitionMs / 1000;
    if (now < r.acquireAt) { r.waitOperation = true; return 'OK'; }
    ops.locks[key] = { owner: r.id, until: now + c.ttlMs / 1000 }; (r.lockKeys ??= []).push(key); delete r.acquireAt;
  }
  if (c.kind === 'queue') {
    const key = `queue:${node.id}`, queue = ops.queues[key] ??= [];
    if (!queue.includes(r.id)) { if (queue.length >= c.capacity) return 'FULL'; queue.push(r.id); (r.queueKeys ??= []).push(key); }
    if (queue[0] !== r.id) r.waitOperation = true;
  }
  if (c.kind === 'retry') r.retryPolicy = { maxAttempts: c.maxAttempts, delayMs: c.delayMs };
  if (c.kind === 'idempotency') {
    const key = `${node.id}:${r.intentId ?? r.id}`, seen = ops.intents[key];
    if (seen && seen.owner !== r.id && seen.until > now) return 'DUPLICATE';
    ops.intents[key] = { owner: r.id, until: now + c.ttlSeconds }; r.idempotentUntil = now + c.ttlSeconds;
  }
  if (c.kind === 'cache') {
    const key = `cache:${node.id}`, cached = ops.cache[key];
    if (cached && cached.until > now) { ops.counters.cacheHits++; r.cachedRead = { stock: cached.stock, version: cached.version }; }
    else {
      ops.counters.cacheMisses++; const entries = Object.keys(ops.cache);
      if (entries.length >= c.capacity) delete ops.cache[entries.sort((a,b) => ops.cache[a].until - ops.cache[b].until)[0]];
      ops.cache[key] = { until: now + c.ttlSeconds, stock: inventory.stock, version: inventory.version };
      r.cachedRead = { stock: inventory.stock, version: inventory.version };
    }
    if (c.invalidateOnWrite) r.invalidateCache = true;
  }
  if (c.kind === 'validation') {
    if (c.rejectInvalidInput && r.invalidInput) return 'INVALID';
    if (inventory.stock < c.minimum) return 'STOCK';
  }
  return 'OK';
}
export function releaseResources(r: PurchaseRequest, ops: OperationRuntime, resource?: 'stock' | 'payment') {
  for (const key of r.lockKeys ?? []) if ((!resource || key === resource) && ops.locks[key]?.owner === r.id) delete ops.locks[key];
  if (!resource || resource === 'stock') for (const key of r.queueKeys ?? []) ops.queues[key] = ops.queues[key]?.filter(id => id !== r.id) ?? [];
}
export function pruneOperations(ops: OperationRuntime, now: number) {
  for (const map of [ops.intents, ops.payments, ops.locks, ops.cache]) for (const [key,value] of Object.entries(map)) if (value.until <= now) delete map[key];
}
