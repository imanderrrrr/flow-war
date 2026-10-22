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

const commandSequences = new WeakMap<GameState, number>();
export function command(game: GameState, role: Role | 'operator', type: string, payload: Record<string, unknown> = {}, changeId?: string, companyId = 0) {
  const prior = Math.max(0, ...Object.keys(game.actions.receipts).map(key => Number(key.match(/:test-(\d+)$/)?.[1] ?? 0)));
  const sequence = Math.max(commandSequences.get(game) ?? 0, prior) + 1; commandSequences.set(game, sequence);
  return applyCommand(game, { id: `${companyId}-${role}`, role, companyId: role === 'operator' ? null : companyId }, { id: `test-${sequence}`, type, companyId, changeId, payload });
}

export function advanceGame(game: GameState, seconds: number) { for (let i = 0; i < Math.round(seconds * 10); i++) step(game); }

export function authorizeAtomic(game: GameState, strategy?: string) {
  assert.equal(command(game, 'backend', 'change.submit', { graph: insertBlock('atomic'), revision: 0 }).ok, true);
  const change = game.changes[0];
  reviewForQa(game,change.id);
  assert.equal(command(game, 'qa', 'qa.run', { suite: 'Concurrencia' }, change.id).ok, true);
  advanceGame(game, 3.5);
  assert.equal(command(game, 'qa', 'qa.approve', {}, change.id).ok, true);
  assert.equal(command(game, 'cto', 'cto.authorize', {}, change.id).ok, true);
  if (strategy) assert.equal(command(game, 'devops', 'deploy.start', { strategy }, change.id).ok, true);
  return change;
}

/** Explicit empty review preserves historical test scenarios without adding protections. */
export function reviewForQa(game:GameState,changeId=game.changes[0].id){
 const ch=game.changes.find(c=>c.id===changeId)!;
 if(ch.status==='SECURITY_PENDING')assert.equal(command(game,'security','security.submit',{changeId,revision:game.companies[ch.companyId].runtime.collaboration!.reviews[changeId].revision},undefined,ch.companyId).ok,true);
}

/** CTO scope for DevOps without moving money: scaling and balancer up to the given servers. */
export function authorizeInfra(game: GameState, companyId = 0, maxServers = 8, seconds = 600) {
  assert.equal(command(game, 'cto', 'cto.infra_authorize', { amount: 0, durationSeconds: seconds, maxServers, operations: ['scale', 'balancer'] }, undefined, companyId).ok, true);
}

/** Producto → QA → CTO → DevOps for one catalog promotion; returns the published change. */
export function publishPromotion(game: GameState, configuration: { catalogId: string; percent: number; duration: number; demandMultiplier: number; budget: number }, strategy = 'rolling', companyId = 0) {
  game.productEnabled = true;
  const draft = command(game, 'product', 'product.draft', configuration, undefined, companyId); assert.equal(draft.ok, true, draft.error);
  const submitted = command(game, 'product', 'product.submit', { draftId: draft.refs![0] }, undefined, companyId); assert.equal(submitted.ok, true, submitted.error);
  const change = game.changes.find(ch => ch.id === submitted.refs![0])!;
  assert.equal(command(game, 'qa', 'qa.run', { suite: 'Carga' }, change.id, companyId).ok, true); advanceGame(game, 8);
  assert.equal(command(game, 'qa', 'qa.approve', {}, change.id, companyId).ok, true);
  const decision = command(game, 'cto', 'cto.decide', { changeId: change.id, decision: 'authorize', reason: 'Autorizo la promoción.', confirmed: true }, undefined, companyId); assert.equal(decision.ok, true, decision.error);
  assert.equal(command(game, 'devops', 'deploy.start', { strategy }, change.id, companyId).ok, true);
  return change;
}
