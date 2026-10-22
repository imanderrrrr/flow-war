import { PLAN_PIECES, PLAN_REQUIREMENTS, isPlanPiece } from '../shared/plan.js';
import type { Graph, ServiceId, TrafficRequest } from '../shared/types.js';

export function route(graph: Graph): Graph['nodes'] {
  const start = graph.nodes.find(n => n.type === 'entry');
  const path: Graph['nodes'] = [];
  const visited = new Set<string>();
  let node = start;
  while (node && !visited.has(node.id)) {
    visited.add(node.id); path.push(node);
    if (node.type === 'exit') break;
    const edge = graph.edges.find(e => e.source === node!.id);
    node = graph.nodes.find(n => n.id === edge?.target);
  }
  return path;
}

export function evaluateSecurity(graph: Graph, kind: 'valid' | 'forged' | 'injection' | 'bot', ordinal = 0, context?: { now: number; origin: string; customerId?: string; type: string; buckets: Record<string, { start: number; count: number }>; release: number }) {
  let authenticated = false;
  for (const n of route(graph)) {
    if (n.type === 'auth') { if (kind === 'forged') return false; authenticated = true; }
    if (n.type === 'role' && !authenticated) return false;
    if (n.type === 'waf' && kind === 'injection') return false;
    if (n.type === 'ip' && kind === 'bot' && ordinal % 2 === 0) return false;
    if (n.type === 'bot' && kind === 'bot' && ordinal % 100 < Number(n.data.value ?? 65)) return false;
    if (n.type === 'rate') {
      if (!context) { if (ordinal % 25 >= Number(n.data.value ?? 12)) return false; }
      else {
        const key = `${context.release}:${n.id}:${context.origin}`, start = Math.floor(context.now);
        let bucket = context.buckets[key];
        if (!bucket || bucket.start !== start) bucket = context.buckets[key] = { start, count: 0 };
        if (++bucket.count > Number(n.data.value ?? 12)) return false;
      }
    }
  }
  return true;
}

/** Services the team's plan actually puts on the route, in the order it drew them, without repeats. */
export function planServices(plan: Graph): ServiceId[] {
  const services: ServiceId[] = [];
  for (const node of route(plan)) {
    const service = isPlanPiece(node.type) ? PLAN_PIECES[node.type].service : undefined;
    if (service && !services.includes(service)) services.push(service);
  }
  return services;
}

/** The first service this request type needs and the plan does not have, or `'exit'` when the route
 * never reaches the salida, or `null` when the company can serve it. */
export function missingFor(plan: Graph, type: TrafficRequest['type']): ServiceId | 'exit' | null {
  const services = planServices(plan);
  for (const service of PLAN_REQUIREMENTS[type]) if (!services.includes(service)) return service;
  return route(plan).at(-1)?.type === 'exit' ? null : 'exit';
}

/** A company accepts purchases — and so closes its montaje — exactly when nothing is missing for one. */
export function sellCapable(plan: Graph): boolean { return missingFor(plan, 'purchase') === null; }
