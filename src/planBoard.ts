import { PLAN_PIECES, PLAN_PIECE_TYPES, PLAN_SLOTS, assertPlanOwnership, isPlanPiece, type PlanPiece } from '../shared/plan';
import type { Graph, Role } from '../shared/types';

/** Width of a piece on the editor board, in board units. The pieces render at exactly this width. */
export const PLAN_NODE_WIDTH = 124;
/**
 * The editor spreads the projector's columns apart. On PLAN_SLOTS themselves, at the zoom that fits
 * the whole board, Entrada's exit point and Seguridad's entry point sat two units apart. Rows and
 * order stay the projector's, so the board still reads as the map the class sees.
 */
export const BOARD_STRETCH = 1.15;
/** Where a solar's piece is centred on the editor board (the editor uses a centred node origin). */
export function boardPoint(piece: PlanPiece): { x: number; y: number } {
  return { x: Math.round(PLAN_SLOTS[piece].x * BOARD_STRETCH), y: PLAN_SLOTS[piece].y };
}

export type BoardSlot = {
  piece: PlanPiece; position: { x: number; y: number }; placed: boolean; mine: boolean;
  text: string;
  /** Only on an empty solar: what the company loses without this piece, so the board says what is
   * missing without saying what to do. */
  reason?: string;
};

/**
 * The board the three roles share: one entry per solar, at its point on the editor board. Pure on
 * purpose — the React components stay thin and this is what node:test can exercise, like src/notices.ts.
 * The server bay reads `placed` off the plan like any other solar; the DevOps console overlays the
 * real server count, which lives in company.servers and not in the graph.
 */
export function boardSlots(plan: Graph, role: Role): BoardSlot[] {
  return PLAN_PIECE_TYPES.map(piece => {
    const definition = PLAN_PIECES[piece], placed = plan.nodes.some(node => node.type === piece);
    return {
      piece, position: boardPoint(piece), placed, mine: definition.owner === role,
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

/**
 * The board a role edits: its saved draft, unless production moved on under it. A draft drawn on an
 * older plan would undo another role's published work, and the server refuses that, leaving the role
 * stuck. So such a draft keeps the role's own pieces and the roads that leave them, and takes every
 * other piece and road — the entrance's included — from production.
 */
export function editableBoard(production: Graph, draft: Graph | undefined, role: Role): Graph {
  if (!draft) return production;
  try { assertPlanOwnership(production, draft, role); return draft; } catch { /* drawn on an older plan */ }
  const owned = (type: string | undefined) => !!type && isPlanPiece(type) && PLAN_PIECES[type].owner === role;
  const kept = new Map(production.nodes.map(node => [node.id, node.type])), drafted = new Map(draft.nodes.map(node => [node.id, node.type]));
  const nodes = [...production.nodes.filter(node => !owned(node.type)), ...draft.nodes.filter(node => owned(node.type))];
  const ids = new Set(nodes.map(node => node.id));
  const edges = [...production.edges.filter(edge => !owned(kept.get(edge.source))), ...draft.edges.filter(edge => owned(drafted.get(edge.source)))]
    .filter(edge => ids.has(edge.source) && ids.has(edge.target));
  return structuredClone({ nodes, edges });
}
