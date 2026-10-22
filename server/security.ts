import type { RequestSecurityContext, ProtectionRule } from '../shared/collaboration.js';
import type { Company, TrafficRequest, Graph } from '../shared/types.js';
import type { ExecutionRelease } from '../shared/simulation.js';
import { evaluateSecurity } from './graphs.js';
import { hasDefect } from './defects.js';

/**
 * Optional note of which check stopped a request. Filling it never changes a decision: it only records the
 * branch that already returned `false` (used to explain auditor probes).
 */
export type SecurityVerdict = { scope?: 'module' | 'block' | 'release' | 'legacy'; rule?: ProtectionRule['kind']; nodeId?: string; moduleId?: string };

/** Synthetic origins only. Admission consumes real fixed-window counters. */
export function admitSecurity(c: Company, release: ExecutionRelease, kind: 'valid' | 'forged' | 'injection' | 'bot', ordinal: number, now: number, origin: string, customerId: string | undefined, type: TrafficRequest['type'], explicit?: RequestSecurityContext, verdict?: SecurityVerdict) {
  const protection = release.security;
  const purchase = type === 'purchase' ? release.modules.filter(m => m.configuration.kind === 'purchase') : [];
  const vulnerableRole = purchase.some(m => hasDefect(m, 'D05'));
  const vulnerableInjection = purchase.some(m => hasDefect(m, 'D08'));
  const stop = (note: SecurityVerdict) => { if (verdict) Object.assign(verdict, note); return false; };
  if (purchase.length && kind === 'forged' && !vulnerableRole) return stop({ scope: 'module', moduleId: purchase[0].id });
  if (purchase.length && kind === 'injection' && !vulnerableInjection) return stop({ scope: 'module', moduleId: purchase[0].id });
  if(release.blockPolicies) {
    const context:RequestSecurityContext=explicit??{authenticated:kind!=='forged'||ordinal%2===1,ownsPurchase:kind!=='forged',maliciousInput:kind==='injection',automated:kind==='bot',origin,customerId,type};
    if(!evaluateBlockPolicies(release,c.backend,context,now,c.runtime.rateBuckets,String(c.version),verdict))return false;
    if(!protection)return true;
  }
  if (!protection) return evaluateSecurity(c.security, kind, ordinal, { now, origin, customerId, type, buckets: c.runtime.rateBuckets, release: c.version }) || stop({ scope: 'legacy' });
  // Same checks and order as one combined condition: none of them has side effects.
  if (protection.auth && (explicit?!explicit.authenticated:kind==='forged')) return stop({ scope: 'release', rule: 'authenticated' });
  if (protection.authorization && (explicit?!explicit.ownsPurchase:kind==='forged') && !vulnerableRole) return stop({ scope: 'release', rule: 'owner' });
  if (protection.waf && (explicit?explicit.maliciousInput:kind==='injection')) return stop({ scope: 'release', rule: 'input' });
  if (protection.blockedOrigins.includes(origin)) return stop({ scope: 'release', rule: 'origin' });
  if ((explicit?explicit.automated:kind==='bot') && ordinal % 100 < protection.botThreshold) return stop({ scope: 'release', rule: 'bot' });
  const rate = protection.rate;
  if (rate && (rate.scope === 'all' || type === 'purchase')) {
    const group = rate.groupBy === 'origin' ? origin : customerId ?? origin;
    const key = `${c.version}:${group}`, start = Math.floor(now / rate.windowSeconds) * rate.windowSeconds;
    const bucket = c.runtime.rateBuckets[key];
    if (!bucket || bucket.start !== start) c.runtime.rateBuckets[key] = { start, count: 1 };
    else if (++bucket.count > rate.limit) return stop({ scope: 'release', rule: 'rate' });
  }
  return true;
}

export function evaluateProtection(rules:ProtectionRule[],request:RequestSecurityContext,now:number,buckets:Record<string,{start:number;count:number}>,namespace:string,verdict?:SecurityVerdict) {
  for(const rule of rules){
    if(rule.kind==='authenticated'&&!request.authenticated||rule.kind==='owner'&&!request.ownsPurchase||rule.kind==='input'&&request.maliciousInput||rule.kind==='bot'&&request.automated||rule.kind==='origin'&&request.origin===rule.origin){if(verdict)verdict.rule=rule.kind;return false;}
    if(rule.kind==='rate'){
      const group=rule.groupBy==='origin'?request.origin:request.customerId??request.origin;
      const key=`${namespace}:${rule.groupBy}:${group}`,start=Math.floor(now/rule.windowSeconds)*rule.windowSeconds;
      let bucket=buckets[key];if(!bucket||bucket.start!==start)bucket=buckets[key]={start,count:0};
      if(++bucket.count>rule.limit){if(verdict)verdict.rule='rate';return false;}
    }
  }
  return true;
}

export function evaluateBlockPolicies(release:ExecutionRelease,graph:Graph,context:RequestSecurityContext,now:number,buckets:Record<string,{start:number;count:number}>,version:string,verdict?:SecurityVerdict) {
  const visited=new Set(graph.nodes.filter(n=>context.type==='purchase'||context.type==='query'&&['entry','read','exit'].includes(n.type)||context.type==='browse'&&['entry','exit'].includes(n.type)).map(n=>n.id));
  for(const block of release.blockPolicies??[])if(visited.has(block.nodeId)&&!evaluateProtection(block.rules,context,now,buckets,`${release.bundleDigest??version}:${block.nodeId}`,verdict)){if(verdict){verdict.scope='block';verdict.nodeId=block.nodeId;}return false;}
  return true;
}
