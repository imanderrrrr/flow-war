import type { Company, TrafficRequest } from '../shared/types.js';
import type { ExecutionRelease } from '../shared/simulation.js';
import { evaluateSecurity } from './graphs.js';
import { hasDefect } from './defects.js';

/** Synthetic origins only. Admission consumes real fixed-window counters. */
export function admitSecurity(c: Company, release: ExecutionRelease, kind: 'valid' | 'forged' | 'injection' | 'bot', ordinal: number, now: number, origin: string, customerId: string | undefined, type: TrafficRequest['type']) {
  const protection = release.security;
  const purchase = type === 'purchase' ? release.modules.filter(m => m.configuration.kind === 'purchase') : [];
  const vulnerableRole = purchase.some(m => hasDefect(m, 'D05'));
  const vulnerableInjection = purchase.some(m => hasDefect(m, 'D08'));
  if (purchase.length && kind === 'forged' && !vulnerableRole) return false;
  if (purchase.length && kind === 'injection' && !vulnerableInjection) return false;
  if (!protection) return evaluateSecurity(c.security, kind, ordinal, { now, origin, customerId, type, buckets: c.runtime.rateBuckets, release: c.version });
  if ((protection.auth && kind === 'forged') || (protection.authorization && kind === 'forged' && !vulnerableRole) || (protection.waf && kind === 'injection')) return false;
  if (protection.blockedOrigins.includes(origin)) return false;
  if (kind === 'bot' && ordinal % 100 < protection.botThreshold) return false;
  const rate = protection.rate;
  if (rate && (rate.scope === 'all' || type === 'purchase')) {
    const group = rate.groupBy === 'origin' ? origin : customerId ?? origin;
    const key = `${c.version}:${group}`, start = Math.floor(now / rate.windowSeconds) * rate.windowSeconds;
    const bucket = c.runtime.rateBuckets[key];
    if (!bucket || bucket.start !== start) c.runtime.rateBuckets[key] = { start, count: 1 };
    else if (++bucket.count > rate.limit) return false;
  }
  return true;
}
