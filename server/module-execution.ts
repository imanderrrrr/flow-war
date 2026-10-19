import type { InventoryState, PurchaseRequest } from '../shared/types.js';
import type { ModuleVersion, OperationRuntime, DefectCode } from '../shared/simulation.js';
import { executeBlock } from './blocks.js';
import { hasDefect } from './defects.js';

export function activation(r: PurchaseRequest, code: DefectCode) { if (!r.effectCodes?.includes(code)) (r.effectCodes ??= []).push(code); }
export function executeModule(r: PurchaseRequest, m: ModuleVersion, inventory: InventoryState, now: number, ops: OperationRuntime): 'OK' | 'INVALID' | 'STOCK' | 'DUPLICATE' {
  const c = m.configuration;
  if (hasDefect(m, 'D06') && (r.loadDepth ?? 0) >= 32 && !r.delayedNodes?.includes(m.id)) {
    (r.delayedNodes ??= []).push(m.id); r.deferUntil = now + 1.5; activation(r, 'D06');
  }
  if (r.deferUntil && now < r.deferUntil) { r.waitOperation = true; return 'OK'; }
  if ((c.kind === 'discount' || c.kind === 'coupon') && (c.audience === 'all' || r.newCustomer) && (c.kind !== 'coupon' || (r.couponCount ?? 1) > 0)) {
    const applications = hasDefect(m, 'D02') && (r.couponCount ?? 1) >= 2 ? 2 : 1;
    if (applications === 2) activation(r, 'D02');
    const eligible = c.stackable || !r.discountApplied;
    if (eligible) { r.price = Math.round((r.price ?? 45) * (1 - c.percent / 100) ** applications * 100) / 100; r.discountApplied = true; }
  }
  if (c.kind === 'inventory') {
    if (r.invalidInput) { if (!hasDefect(m, 'D04')) return 'INVALID'; activation(r, 'D04'); }
    if ((r.read?.stock ?? inventory.stock) < c.minimum) return 'STOCK';
    r.releaseOnInterrupt = !hasDefect(m, 'D07');
  }
  if (c.kind === 'concurrency' && c.strategy === 'atomic' && !r.committed) {
    if (!hasDefect(m, 'D01')) r.atomic = true; else activation(r, 'D01');
  }
  if (c.kind === 'concurrency' && c.strategy === 'lock' && !r.committed) {
    if (hasDefect(m, 'D01')) activation(r, 'D01');
    else executeBlock(r, { id: m.id, type: 'lock', position: { x: 0, y: 0 }, data: { label: 'Lock', value: 5000 } }, inventory, now, ops);
  }
  if (c.kind === 'purchase') {
    r.releaseOnInterrupt = !hasDefect(m, 'D07');
    if (c.idempotent) {
      if (hasDefect(m, 'D03')) activation(r, 'D03');
      else {
        const key = `purchase:${r.intentId ?? r.id}`, seen = ops.intents[key];
        if (seen && seen.until > now && seen.owner !== r.id) return 'DUPLICATE';
        ops.intents[key] = { until: now + 300, owner: r.id }; r.idempotentUntil = now + 300;
      }
    }
  }
  return 'OK';
}
export function settleReservation(r: PurchaseRequest, inventory: InventoryState) {
  if (!r.result || r.paid || !r.committed || r.reservationSettled) return;
  r.reservationSettled = true;
  if (r.releaseOnInterrupt) {
    const units = r.committed - r.oversold; inventory.stock += units; inventory.committed -= r.committed; inventory.oversold -= r.oversold; inventory.version++;
    r.committed = 0; r.oversold = 0;
  } else if (r.execution?.modules.some(m => hasDefect(m, 'D07'))) activation(r, 'D07');
}
