import { BLOCKS, type Graph } from '../shared/types';

/**
 * The purchase-flow blocks the plan offers on its Inventario and Pagos pieces, so Backend can put one
 * in a single tap instead of rewiring the inner graph by hand. Pure on purpose, like src/planBoard.ts.
 * Each block lands right before the operation the engine reads it against (server/engine.ts
 * inventoryBatch, server/requests.ts, server/blocks.ts). `text` says what the block does, never when to
 * use it: choosing one is still the student's diagnosis. Student-facing strings are Spanish on purpose.
 */
export type LogicPiece = 'inventory' | 'payment';
export type LogicBlock = { type: string; anchor: 'read' | 'write' | 'payment'; text: string };
export const LOGIC_BLOCKS: Record<LogicPiece, LogicBlock[]> = {
  inventory: [
    { type: 'atomic', anchor: 'write', text: 'Lee y descuenta el stock en una sola operación.' },
    { type: 'lock', anchor: 'read', text: 'Bloquea el stock mientras una compra lo usa; las demás esperan su turno.' },
    { type: 'queue', anchor: 'read', text: 'Pone las compras en fila para usar el stock de a una; si la fila se llena, rechaza.' },
    { type: 'validation', anchor: 'write', text: 'Rechaza la compra si no queda el mínimo de stock o si llega con datos inválidos.' },
    { type: 'cache', anchor: 'read', text: 'Guarda la lectura del stock unos segundos para responder más rápido.' },
  ],
  payment: [
    { type: 'idempotency', anchor: 'payment', text: 'Reconoce un mismo pago repetido y lo cobra una sola vez.' },
    { type: 'retry', anchor: 'payment', text: 'Si el pago no responde, lo vuelve a intentar.' },
  ],
};
const anchorOf = (type: string) => [...LOGIC_BLOCKS.inventory, ...LOGIC_BLOCKS.payment].find(b => b.type === type)?.anchor;

export const hasBlock = (graph: Graph, type: string) => graph.nodes.some(node => node.type === type);

/** Puts a block right before its operation, taking over the road that used to reach it. */
export function insertBlock(graph: Graph, type: string): Graph {
  const block = BLOCKS.backend.find(b => b.type === type), anchorType = anchorOf(type);
  const anchor = graph.nodes.find(node => node.type === anchorType);
  if (!block || !anchor || hasBlock(graph, type)) return graph;
  const ids = new Set(graph.nodes.map(node => node.id));
  let n = 1; while (ids.has(`logic-${type}-${n}`)) n++;
  const id = `logic-${type}-${n}`, incoming = graph.edges.find(edge => edge.target === anchor.id);
  // Blocks put in one tap fan out under their operation, so the inner canvas never stacks two on one spot.
  const placed = graph.nodes.filter(node => node.id.startsWith('logic-')).length;
  const nodes = [...structuredClone(graph.nodes), { id, type, position: { x: anchor.position.x - 95 + placed * 40, y: anchor.position.y + 140 + placed * 70 }, data: { label: block.label, value: block.value } }];
  const edges = [...structuredClone(graph.edges.filter(edge => edge !== incoming)),
    ...(incoming ? [{ id: `${incoming.source}->${id}`, source: incoming.source, target: id }] : []), { id: `${id}->${anchor.id}`, source: id, target: anchor.id }];
  return { nodes, edges };
}

/** Takes every block of that type out, joining what came before it to what came after. */
export function removeBlock(graph: Graph, type: string): Graph {
  let next = structuredClone(graph);
  for (const node of graph.nodes.filter(n => n.type === type)) {
    const incoming = next.edges.find(edge => edge.target === node.id), outgoing = next.edges.find(edge => edge.source === node.id);
    const edges = next.edges.filter(edge => edge.source !== node.id && edge.target !== node.id);
    if (incoming && outgoing) edges.push({ id: `${incoming.source}->${outgoing.target}`, source: incoming.source, target: outgoing.target });
    next = { nodes: next.nodes.filter(n => n.id !== node.id), edges };
  }
  return next;
}

/** The labels a purchase walks through, from the entrance along the drawn roads. */
export function logicPath(graph: Graph): string[] {
  const labels: string[] = [], seen = new Set<string>();
  let node = graph.nodes.find(n => n.type === 'entry');
  while (node && !seen.has(node.id)) {
    seen.add(node.id); labels.push(String(node.data.label));
    const edge = graph.edges.find(e => e.source === node!.id);
    node = graph.nodes.find(n => n.id === edge?.target);
  }
  return labels;
}

/** Same logic: the same blocks in the same order with the same parameters, whatever their ids or positions. */
export function sameLogic(a: Graph, b: Graph) {
  const walk = (graph: Graph) => { const out: unknown[] = [], seen = new Set<string>(); let node = graph.nodes.find(n => n.type === 'entry');
    while (node && !seen.has(node.id)) { seen.add(node.id); out.push([node.type, node.data.value ?? null, node.data.config ?? null, node.data.module ?? null]); const edge = graph.edges.find(e => e.source === node!.id); node = graph.nodes.find(n => n.id === edge?.target); }
    return JSON.stringify([out, graph.nodes.length]); };
  return walk(a) === walk(b);
}

/** What change.submit charges (server/engine.ts): Q100 plus each block on the graph. */
export const submissionCost = (nodes: { type?: string }[]) => 100 + nodes.reduce((sum, n) => sum + (BLOCKS.backend.find(b => b.type === n.type)?.cost ?? 0), 0);
