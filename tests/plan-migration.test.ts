import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step } from '../server/engine.js';
import { planServices, sellCapable } from '../server/graphs.js';
import { recoverGame, serializeGame } from '../server/persistence.js';
import { admitTraffic } from '../server/traffic.js';
import { advanceGame, assembledGame, command } from './helpers.js';
import type { RequestResult } from '../shared/types.js';

/** A save written before this entrega: the service layer was wired into the engine, so no company
 * carried a plan or a montaje of its own. */
function schema6(game: ReturnType<typeof createGame>) {
  const saved = JSON.parse(serializeGame(game));
  saved.schema = 6;
  for (const company of saved.companies) { delete company.plan; delete company.assembly; delete company.traffic.planPaths; }
  return JSON.stringify(saved);
}

test('una partida de esquema 6 recupera con el plano completo y el montaje cerrado', () => {
  const game = assembledGame(); assert.equal(command(game, 'operator', 'room.start').ok, true); advanceGame(game, 1);
  const recovered = recoverGame(schema6(game));
  assert.equal(recovered.schema, 7);
  for (const c of recovered.companies) {
    assert.deepEqual(planServices(c.plan), ['security', 'web', 'checkout', 'inventory', 'payment']);
    assert.equal(c.assembly.active, false);
    assert.equal(typeof c.assembly.closedAt, 'number');
  }
});

test('una solicitud en vuelo de esquema 6 sigue su recorrido tras recuperar', () => {
  const game = assembledGame(); assert.equal(command(game, 'operator', 'room.start').ok, true);
  const company = game.companies[0];
  const id = admitTraffic(company, 0, 'purchase').id;
  advanceGame(game, .5);
  assert.equal(company.traffic.requests[id].result, undefined, 'la compra tiene que estar a mitad de camino');
  const recovered = recoverGame(schema6(game));
  assert.equal(recovered.companies[0].traffic.requests[id].result, undefined);
  recovered.status = 'RUNNING';
  // Captured as it settles: a finished request leaves the map once its retention window passes.
  let settled: RequestResult | undefined;
  for (let i = 0; i < 100 && !settled; i++) { advanceGame(recovered, .1); settled = recovered.companies[0].traffic.requests[id]?.result; }
  assert.equal(settled!.reason, 'OK');
});

test('una fixtura de QA guardada también recupera con su plano', () => {
  const game = assembledGame(); assert.equal(command(game, 'operator', 'room.start').ok, true);
  assert.equal(command(game, 'backend', 'change.submit', { graph: game.companies[0].backend, revision: 0 }).ok, true);
  const change = game.changes[0];
  assert.equal(command(game, 'security', 'security.submit', { changeId: change.id, revision: game.companies[0].runtime.collaboration!.reviews[change.id].revision }).ok, true);
  assert.equal(command(game, 'qa', 'qa.run', { suite: 'Carga' }, change.id).ok, true);
  advanceGame(game, .5);
  const recovered = recoverGame(schema6(game));
  const staging = recovered.changes.find(ch => ch.id === change.id)!.qaLoad!.company;
  assert.ok(staging.plan, 'la empresa de la fixtura tiene que traer plano o el motor no sabe por dónde pasa');
  recovered.status = 'RUNNING';
  advanceGame(recovered, 2);
});

test('room.assembled arranca las cinco empresas vendiendo', () => {
  const game = createGame();
  assert.equal(command(game, 'operator', 'room.assembled', { enabled: true }).ok, true);
  assert.ok(game.companies.every(c => sellCapable(c.plan) && !c.assembly.active));
});

test('room.assembled se puede apagar y deja a las empresas por construir', () => {
  const game = createGame();
  assert.equal(command(game, 'operator', 'room.assembled', { enabled: true }).ok, true);
  assert.equal(command(game, 'operator', 'room.assembled', { enabled: false }).ok, true);
  assert.ok(game.companies.every(c => !sellCapable(c.plan) && c.assembly.active));
});

test('room.assembled se rechaza con la partida en curso', () => {
  const game = createGame();
  assert.equal(command(game, 'operator', 'room.start').ok, true);
  assert.equal(command(game, 'operator', 'room.assembled', { enabled: true }).ok, false);
});

test('una partida de esquema 7 recupera sin tocar el plano que tenía', () => {
  const game = createGame(); assert.equal(command(game, 'operator', 'room.start').ok, true);
  const recovered = recoverGame(serializeGame(game));
  assert.equal(recovered.schema, 7);
  assert.ok(recovered.companies.every(c => c.assembly.active), 'una sala a medio construir no se recupera armada');
  assert.deepEqual(recovered.companies[0].plan.nodes.map(n => n.type).sort(), ['entry', 'web']);
});

test('una versión futura sigue fallando cerrada', () => {
  assert.throws(() => recoverGame(JSON.stringify({ ...createGame(), schema: 999 })), /no soportada/);
});
