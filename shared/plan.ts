import type { Graph, Identity, Role, ServiceId, TerminalReason, TrafficRequest } from './types.js';

/**
 * The service plan: the layer that used to be wired into the engine (SERVICE_IDS, server/traffic.ts)
 * and that each team now builds itself. One piece per solar, except the server bay, which stacks.
 * Student-facing strings are Spanish on purpose: `text` is shown in the palette before the piece is
 * dragged and in the inspector afterwards, so placing a piece teaches what it is for.
 */
export type PlanPiece = 'entry' | 'security' | 'web' | 'checkout' | 'inventory' | 'payment' | 'exit' | 'server';

export const PLAN_PIECES: Record<PlanPiece, { label: string; service?: ServiceId; owner: Role | null; cost: number; text: string }> = {
  entry: { label: 'Entrada', owner: null, cost: 0, text: 'Ya está puesta: por acá entra todo el que llega a tu empresa.' },
  security: { label: 'Seguridad', service: 'security', owner: 'security', cost: 300, text: 'Filtra lo que entra. Sin esto cualquiera pasa como si fuera un cliente.' },
  web: { label: 'Tienda web', service: 'web', owner: 'backend', cost: 0, text: 'Es la vidriera. Sin esto nadie puede ver lo que vendés.' },
  checkout: { label: 'Checkout', service: 'checkout', owner: 'backend', cost: 150, text: 'Donde se arma la compra antes de cobrarla.' },
  inventory: { label: 'Inventario', service: 'inventory', owner: 'backend', cost: 200, text: 'Lleva la cuenta de lo que hay. Sin esto nadie sabe si queda stock.' },
  payment: { label: 'Pagos', service: 'payment', owner: 'backend', cost: 250, text: 'Cobra el pedido. Sin esto podés mostrar y reservar, pero no facturar.' },
  exit: { label: 'Salida', owner: 'backend', cost: 50, text: 'Sin salida el cliente nunca recibe respuesta: entra y se queda esperando.' },
  server: { label: 'Servidor de aplicación', owner: 'devops', cost: 0, text: 'Es la máquina donde corren la tienda web y el checkout. Más servidores, más gente atendida a la vez.' },
};

/**
 * The board's fixed solares, in the projector's own coordinates (src/trafficGeometry.ts SERVICES), so
 * the server and the classroom map read from one source. The server bay sits below the storefront.
 */
export const PLAN_SLOTS: Record<PlanPiece, { x: number; y: number }> = {
  entry: { x: 70, y: 295 }, security: { x: 240, y: 295 }, web: { x: 425, y: 295 }, checkout: { x: 635, y: 295 },
  inventory: { x: 825, y: 150 }, payment: { x: 825, y: 435 }, exit: { x: 1040, y: 295 }, server: { x: 425, y: 490 },
};

/** Services each request type needs on the route, in the order the first missing one is reported. */
export const PLAN_REQUIREMENTS: Record<TrafficRequest['type'], ServiceId[]> = {
  browse: ['web'],
  query: ['web', 'inventory'],
  purchase: ['web', 'checkout', 'inventory', 'payment'],
};

/** Terminal reasons only a half-built plan produces. While a company is still assembling these
 * spare the customer: nobody loses clients over a service nobody asked them to build yet. */
export const PLAN_TERMINAL_REASONS: readonly TerminalReason[] = ['NO_STOREFRONT', 'NO_INVENTORY', 'NO_CHECKOUT'];
export const isPlanReason = (reason: TerminalReason) => PLAN_TERMINAL_REASONS.includes(reason);

export const PLAN_PIECE_TYPES = Object.keys(PLAN_PIECES) as PlanPiece[];
export const isPlanPiece = (type: string): type is PlanPiece => Object.hasOwn(PLAN_PIECES, type);

/** Pieces on their solares, chained in the order given. Ids are stable so a draft can name them. */
export function planGraph(types: PlanPiece[]): Graph {
  return { nodes: types.map(type => ({ id: `plan-${type}`, type, position: { ...PLAN_SLOTS[type] }, data: { label: PLAN_PIECES[type].label } })),
    edges: types.slice(1).map((type, i) => ({ id: `plan-e${i}`, source: `plan-${types[i]}`, target: `plan-${type}` })) };
}
/** The chain server/traffic.ts used to walk by hand: what a migrated game and an assembled room run. */
export function completePlan(): Graph { return planGraph(['entry', 'security', 'web', 'checkout', 'inventory', 'payment', 'exit']); }

const tally = (graph: Graph) => graph.nodes.reduce((count, node) => { count[node.type] = (count[node.type] ?? 0) + 1; return count; }, {} as Record<string, number>);
/** Q100 per publication plus only the pieces it adds, so building in small steps is not punished.
 * The server charges with this and the editor previews with it, so the student sees one number. */
export const PLAN_PUBLICATION_FEE = 100;
export function planPublicationCost(previous: Graph, next: Graph) {
  const before = tally(previous), after = tally(next);
  return Object.entries(after).reduce((sum, [type, count]) =>
    sum + Math.max(0, count - (before[type] ?? 0)) * (isPlanPiece(type) ? PLAN_PIECES[type].cost : 0), PLAN_PUBLICATION_FEE);
}

/* Shared by the server, which enforces them, and the editor, which keeps a saved draft submittable. */
/** Roads named by the pieces they join, so a comparison does not depend on the ids a client sent. */
function planRoads(graph: Graph) {
  const type = new Map(graph.nodes.map(node => [node.id, node.type]));
  return new Set(graph.edges.map(edge => `${type.get(edge.source) ?? '?'}>${type.get(edge.target) ?? '?'}`));
}
/** True when the plan is untouched: same pieces on the same solares, joined by the same roads. */
export function samePlan(previous: Graph, next: Graph) {
  const before = tally(previous), after = tally(next), roads = planRoads(previous), nextRoads = planRoads(next);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].every(type => (before[type] ?? 0) === (after[type] ?? 0))
    && roads.size === nextRoads.size && [...roads].every(road => nextRoads.has(road));
}
/** Each role moves only its own pieces, and only the roads that leave them: the rest of the plan is
 * visible and not grabbable. The entrance belongs to nobody, so any of the three may connect it. */
export function assertPlanOwnership(previous: Graph, next: Graph, role: Identity['role']) {
  const before = tally(previous), after = tally(next);
  for (const type of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if ((before[type] ?? 0) === (after[type] ?? 0)) continue;
    if (!isPlanPiece(type)) throw new Error('Esa pieza no existe en el catálogo del plano.');
    const piece = PLAN_PIECES[type];
    if (piece.owner !== role) throw new Error(`${piece.label} no es una pieza de tu rol.`);
  }
  const roads = planRoads(previous), nextRoads = planRoads(next);
  for (const road of new Set([...roads, ...nextRoads])) {
    if (roads.has(road) === nextRoads.has(road)) continue;
    const source = road.split('>')[0];
    if (source === 'entry' || !isPlanPiece(source)) continue;
    if (PLAN_PIECES[source].owner !== role) throw new Error(`El camino que sale de ${PLAN_PIECES[source].label.toLowerCase()} lo dibuja su rol, no vos.`);
  }
  return after;
}
