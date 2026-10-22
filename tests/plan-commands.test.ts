import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, project } from '../server/engine.js';
import { planServices } from '../server/graphs.js';
import { advanceGame, command, planWith } from './helpers.js';

const started = () => { const game = createGame(); command(game, 'operator', 'room.start'); return game; };
/** Opens the room and closes company 0's montaje by publishing a plan that can sell. */
const selling = () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.publish', { graph: planWith('web', 'checkout', 'inventory', 'payment', 'exit'), revision: 0 }).ok, true);
  advanceGame(game, .1);
  assert.equal(game.companies[0].assembly.active, false);
  return game;
};

test('Backend coloca la salida y publica directo durante el montaje', () => {
  const game = started();
  const r = command(game, 'backend', 'plan.publish', { graph: planWith('web', 'exit'), revision: 0 });
  assert.equal(r.ok, true, r.error);
  assert.equal(game.companies[0].capital, 10000 - 100 - 50);
  assert.deepEqual(game.companies[0].plan.nodes.map(n => n.type).sort(), ['entry', 'exit', 'web']);
});

test('Backend no puede colocar el perímetro de seguridad', () => {
  const game = started();
  const r = command(game, 'backend', 'plan.publish', { graph: planWith('security', 'web', 'exit'), revision: 0 });
  assert.equal(r.ok, false);
  assert.match(r.error!, /Seguridad/);
  assert.equal(game.companies[0].capital, 10000);
});

test('Seguridad sí puede colocar el perímetro', () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.publish', { graph: planWith('web', 'exit'), revision: 0 }).ok, true);
  const r = command(game, 'security', 'plan.publish', { graph: planWith('security', 'web', 'exit'), revision: 1 });
  assert.equal(r.ok, true, r.error);
  assert.ok(planServices(game.companies[0].plan).includes('security'));
  assert.equal(game.companies[0].capital, 10000 - 100 - 50 - 100 - 300);
});

test('nadie puede quitar la entrada', () => {
  const game = started();
  const graph = planWith('web', 'exit');
  graph.nodes = graph.nodes.filter(n => n.type !== 'entry');
  graph.edges = [];
  assert.equal(command(game, 'backend', 'plan.publish', { graph, revision: 0 }).ok, false);
});

test('solo se cobran las piezas nuevas de esa publicación', () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.publish', { graph: planWith('web', 'exit'), revision: 0 }).ok, true);
  const second = command(game, 'backend', 'plan.publish', { graph: planWith('web', 'inventory', 'exit'), revision: 1 });
  assert.equal(second.ok, true, second.error);
  assert.equal(game.companies[0].capital, 10000 - 100 - 50 - 100 - 200);
});

test('cerrado el montaje, publicar el plano directo se rechaza', () => {
  const game = selling();
  const r = command(game, 'backend', 'plan.publish', { graph: planWith('web', 'checkout', 'inventory', 'payment', 'exit'), revision: 1 });
  assert.equal(r.code, 'PIPELINE_REQUIRED');
});

test('sin capital suficiente la publicación se rechaza y no cambia el plano', () => {
  const game = started();
  game.companies[0].capital = 60;
  const before = structuredClone(game.companies[0].plan);
  const r = command(game, 'backend', 'plan.publish', { graph: planWith('web', 'exit'), revision: 0 });
  assert.equal(r.ok, false);
  assert.deepEqual(game.companies[0].plan, before);
  assert.equal(game.companies[0].capital, 60);
  assert.equal(game.companies[0].drafts.plan, undefined, 'una publicación rechazada no avanza el borrador');
});

test('guardar el borrador del plano no cobra ni publica', () => {
  const game = started();
  const r = command(game, 'backend', 'plan.save', { graph: planWith('web', 'exit'), revision: 0 });
  assert.equal(r.ok, true, r.error);
  assert.equal(game.companies[0].capital, 10000);
  assert.equal(game.companies[0].drafts.plan!.revision, 1);
  assert.deepEqual(game.companies[0].plan.nodes.map(n => n.type).sort(), ['entry', 'web']);
});

test('publicar el plano le da una versión nueva, así el recorrido no se mezcla', () => {
  const game = started();
  const before = game.companies[0].version;
  assert.equal(command(game, 'backend', 'plan.publish', { graph: planWith('web', 'exit'), revision: 0 }).ok, true);
  assert.equal(game.companies[0].version, before + 1);
});

test('QA y el CTO no publican el plano', () => {
  const game = started();
  for (const role of ['qa', 'cto'] as const) {
    const r = command(game, role, 'plan.publish', { graph: planWith('web', 'exit'), revision: 0 });
    assert.equal(r.code, 'FORBIDDEN', `${role} no debería poder publicar el plano`);
  }
});

test('el borrador del plano llega a los tres roles que tienen piezas, y a QA no', () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.save', { graph: planWith('web', 'exit'), revision: 0 }).ok, true);
  for (const role of ['backend', 'security', 'devops'] as const) {
    const view = project(game, { id: `0-${role}`, role, companyId: 0 });
    assert.ok(view.privateCompany!.drafts.plan, `${role} tiene que ver el borrador del plano`);
  }
  const qa = project(game, { id: '0-qa', role: 'qa', companyId: 0 });
  assert.equal(qa.privateCompany!.drafts.plan, undefined);
});

test('el plano de cada empresa es público: el proyector lo necesita', () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.publish', { graph: planWith('web', 'exit'), revision: 0 }).ok, true);
  const rival = project(game, { id: '1-backend', role: 'backend', companyId: 1 });
  assert.deepEqual(rival.companies[0].plan.nodes.map(n => n.type).sort(), ['entry', 'exit', 'web']);
});
