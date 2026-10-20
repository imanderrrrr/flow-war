import type { RequestSecurityContext, ProtectionRule } from '../shared/collaboration.js';
import type { Company, TrafficRequest, Graph } from '../shared/types.js';
import type { ExecutionRelease } from '../shared/simulation.js';
import { evaluateSecurity } from './graphs.js';
import { hasDefect } from './defects.js';

/** Synthetic origins only. Admission consumes real fixed-window counters. */
export function admitSecurity(c: Company, release: ExecutionRelease, kind: 'valid' | 'forged' | 'injection' | 'bot', ordinal: number, now: number, origin: string, customerId: string | undefined, type: TrafficRequest['type'], explicit?: RequestSecurityContext) {
  const protection = release.security;
  const purchase = type === 'purchase' ? release.modules.filter(m => m.configuration.kind === 'purchase') : [];
  const vulnerableRole = purchase.some(m => hasDefect(m, 'D05'));
  const vulnerableInjection = purchase.some(m => hasDefect(m, 'D08'));
  if (purchase.length && kind === 'forged' && !vulnerableRole) return false;
  if (purchase.length && kind === 'injection' && !vulnerableInjection) return false;
  if(release.blockPolicies) {
    const context:RequestSecurityContext=explicit??{authenticated:kind!=='forged'||ordinal%2===1,ownsPurchase:kind!=='forged',maliciousInput:kind==='injection',automated:kind==='bot',origin,customerId,type};
    if(!evaluateBlockPolicies(release,c.backend,context,now,c.runtime.rateBuckets,String(c.version)))return false;
    if(!protection)return true;
  }
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

export function evaluateProtection(rules:ProtectionRule[],request:RequestSecurityContext,now:number,buckets:Record<string,{start:number;count:number}>,namespace:string) {
  for(const rule of rules){
    if(rule.kind==='authenticated'&&!request.authenticated||rule.kind==='owner'&&!request.ownsPurchase||rule.kind==='input'&&request.maliciousInput||rule.kind==='bot'&&request.automated||rule.kind==='origin'&&request.origin===rule.origin)return false;
    if(rule.kind==='rate'){
      const group=rule.groupBy==='origin'?request.origin:request.customerId??request.origin;
      const key=`${namespace}:${rule.groupBy}:${group}`,start=Math.floor(now/rule.windowSeconds)*rule.windowSeconds;
      let bucket=buckets[key];if(!bucket||bucket.start!==start)bucket=buckets[key]={start,count:0};
      if(++bucket.count>rule.limit)return false;
    }
  }
  return true;
}

export function evaluateBlockPolicies(release:ExecutionRelease,graph:Graph,context:RequestSecurityContext,now:number,buckets:Record<string,{start:number;count:number}>,version:string) {
  const visited=new Set(graph.nodes.filter(n=>context.type==='purchase'||context.type==='query'&&['entry','read','exit'].includes(n.type)||context.type==='browse'&&['entry','exit'].includes(n.type)).map(n=>n.id));
  for(const block of release.blockPolicies??[])if(visited.has(block.nodeId)&&!evaluateProtection(block.rules,context,now,buckets,`${release.bundleDigest??version}:${block.nodeId}`))return false;
  return true;
}
