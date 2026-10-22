import { PLAN_PIECES, PLAN_PIECE_TYPES, PLAN_SLOTS, type PlanPiece } from '../shared/plan';
import type { Graph, Role } from '../shared/types';

export type BoardSlot = {
  piece: PlanPiece; position: { x: number; y: number }; placed: boolean; mine: boolean;
  text: string;
  /** Only on an empty solar: what the company loses without this piece, so the board says what is
   * missing without saying what to do. */
  reason?: string;
};

/**
 * The board the three roles share: one entry per solar, in the projector's own coordinates. Pure on
 * purpose — the React components stay thin and this is what node:test can exercise, like src/notices.ts.
 * The server bay reads `placed` off the plan like any other solar; the DevOps console overlays the
 * real server count, which lives in company.servers and not in the graph.
 */
export function boardSlots(plan: Graph, role: Role): BoardSlot[] {
  return PLAN_PIECE_TYPES.map(piece => {
    const definition = PLAN_PIECES[piece], placed = plan.nodes.some(node => node.type === piece);
    return {
      piece, position: { ...PLAN_SLOTS[piece] }, placed, mine: definition.owner === role,
      text: definition.text, ...(placed ? {} : { reason: definition.text }),
    };
  });
}

/** Puts a piece on its solar. A solar already taken is left alone; only the server bay stacks. */
export function addPiece(plan: Graph, piece: PlanPiece): Graph {
  const existing = plan.nodes.filter(node => node.type === piece);
  if (existing.length && piece !== 'server') return plan;
  const id = existing.length ? `plan-${piece}-${existing.length + 1}` : `plan-${piece}`;
  return { nodes: [...plan.nodes, { id, type: piece, position: { ...PLAN_SLOTS[piece] }, data: { label: PLAN_PIECES[piece].label } }], edges: [...plan.edges] };
}

/** Draws a road. One exit per piece, so a new road replaces that piece's previous one. */
export function connect(plan: Graph, source: string, target: string): Graph {
  return { nodes: [...plan.nodes], edges: [...plan.edges.filter(edge => edge.source !== source), { id: `${source}->${target}`, source, target }] };
}

/** Takes a piece off its solar, with the roads that touched it. */
export function removePiece(plan: Graph, nodeId: string): Graph {
  return { nodes: plan.nodes.filter(node => node.id !== nodeId), edges: plan.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId) };
}
