import type { Graph, Role, ServiceId, TerminalReason, TrafficRequest } from './types.js';

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
