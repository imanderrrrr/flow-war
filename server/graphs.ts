import type { Graph } from '../shared/types.js';

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

export function evaluateSecurity(graph: Graph, kind: 'valid' | 'forged' | 'injection' | 'bot', ordinal = 0) {
  let authenticated = false;
  for (const n of route(graph)) {
    if (n.type === 'auth') { if (kind === 'forged') return false; authenticated = true; }
    if (n.type === 'role' && !authenticated) return false;
    if (n.type === 'waf' && kind === 'injection') return false;
    if (n.type === 'ip' && kind === 'bot' && ordinal % 2 === 0) return false;
    if (n.type === 'bot' && kind === 'bot' && ordinal % 100 < Number(n.data.value ?? 65)) return false;
    if (n.type === 'rate' && ordinal % 25 >= Number(n.data.value ?? 12)) return false;
  }
  return true;
}
