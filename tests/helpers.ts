import assert from 'node:assert/strict';
import type { GameState, Graph, Role } from '../shared/types.js';
import { applyCommand, initialGraph, step } from '../server/engine.js';

export function insertBlock(type: string, before = 'write', value = 1, graph = initialGraph('backend')): Graph {
  const copy = structuredClone(graph), target = copy.nodes.find(node => node.type === before)!;
  const edge = copy.edges.find(item => item.target === target.id)!;
  const id = `test-${type}`;
  copy.nodes.push({ id, type, position: { x: 100, y: 300 }, data: { label: type, value } });
  copy.edges = copy.edges.filter(item => item.id !== edge.id);
  copy.edges.push({ id: `${id}-in`, source: edge.source, target: id }, { id: `${id}-out`, source: id, target: target.id });
  return copy;
}

let commandSequence = 0;
export function command(game: GameState, role: Role | 'operator', type: string, payload: Record<string, unknown> = {}, changeId?: string, companyId = 0) {
  return applyCommand(game, { id: `${companyId}-${role}`, role, companyId: role === 'operator' ? null : companyId }, { id: `test-${++commandSequence}`, type, companyId, changeId, payload });
}

export function advanceGame(game: GameState, seconds: number) { for (let i = 0; i < Math.round(seconds * 10); i++) step(game); }

export function authorizeAtomic(game: GameState, strategy?: string) {
  assert.equal(command(game, 'backend', 'change.submit', { graph: insertBlock('atomic'), revision: 0 }).ok, true);
  const change = game.changes[0];
  assert.equal(command(game, 'qa', 'qa.run', { suite: 'Concurrencia' }, change.id).ok, true);
  advanceGame(game, 3.5);
  assert.equal(command(game, 'qa', 'qa.approve', {}, change.id).ok, true);
  assert.equal(command(game, 'cto', 'cto.authorize', {}, change.id).ok, true);
  if (strategy) assert.equal(command(game, 'devops', 'deploy.start', { strategy }, change.id).ok, true);
  return change;
}
