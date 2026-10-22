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
  const r = command(game, 'security', 'plan.publish', { graph: planWith('security', 'web', 'exit'), revision: 0 });
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
  const r = command(game, 'backend', 'plan.publish', { graph: planWith('web', 'checkout', 'inventory', 'exit'), revision: 1 });
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
  assert.equal(game.companies[0].planDrafts.backend, undefined, 'una publicación rechazada no avanza el borrador');
});

test('guardar el borrador del plano no cobra ni publica', () => {
  const game = started();
  const r = command(game, 'backend', 'plan.save', { graph: planWith('web', 'exit'), revision: 0 });
  assert.equal(r.ok, true, r.error);
  assert.equal(game.companies[0].capital, 10000);
  assert.equal(game.companies[0].planDrafts.backend!.revision, 1);
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

test('cada rol recibe su propio borrador del plano y el de nadie más', () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.save', { graph: planWith('web', 'exit'), revision: 0 }).ok, true);
  const own = project(game, { id: '0-backend', role: 'backend', companyId: 0 });
  assert.ok(own.privateCompany!.planDrafts.backend, 'Backend tiene que ver su borrador');
  for (const role of ['security', 'devops', 'qa'] as const) {
    const view = project(game, { id: `0-${role}`, role, companyId: 0 });
    assert.deepEqual(view.privateCompany!.planDrafts, {}, `${role} no debería ver el borrador ajeno`);
  }
});

test('el plano de cada empresa es público: el proyector lo necesita', () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.publish', { graph: planWith('web', 'exit'), revision: 0 }).ok, true);
  const rival = project(game, { id: '1-backend', role: 'backend', companyId: 1 });
  assert.deepEqual(rival.companies[0].plan.nodes.map(n => n.type).sort(), ['entry', 'exit', 'web']);
});

test('publicar el plano conserva el perímetro que la empresa ya tenía en producción', () => {
  const game = started();
  const company = game.companies[0];
  // Una versión en producción con su protección configurada, como la deja el ciclo completo.
  company.runtime.releases[company.version] = { modules: [], blockPolicies: [{ nodeId: 'backend-write', rules: [{ kind: 'input' }] }] } as never;
  assert.equal(command(game, 'backend', 'plan.publish', { graph: planWith('web', 'exit'), revision: 0 }).ok, true);
  const release = company.runtime.releases[company.version] as { blockPolicies?: { nodeId: string }[] };
  assert.ok(release.blockPolicies?.some(b => b.nodeId === 'backend-write'), 'la protección publicada no puede desaparecer al publicar el plano');
});

test('cada rol tiene su propio borrador del plano', () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.save', { graph: planWith('web', 'exit'), revision: 0 }).ok, true);
  // Seguridad no hereda la salida sin publicar de Backend, así que puede guardar y publicar la suya.
  const saved = command(game, 'security', 'plan.save', { graph: planWith('security', 'web'), revision: 0 });
  assert.equal(saved.ok, true, saved.error);
  const published = command(game, 'security', 'plan.publish', { graph: planWith('security', 'web'), revision: 1 });
  assert.equal(published.ok, true, published.error);
  assert.ok(game.companies[0].plan.nodes.some(n => n.type === 'security'));
  assert.equal(game.companies[0].plan.nodes.some(n => n.type === 'exit'), false, 'la salida de Backend seguía sin publicar');
});

test('un rol no puede sacar del recorrido las piezas de otro', () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.publish', { graph: planWith('web', 'checkout', 'inventory', 'payment', 'exit'), revision: 0 }).ok, true);
  const rerouted = planWith('security', 'exit');
  for (const type of ['web', 'checkout', 'inventory', 'payment']) rerouted.nodes.push({ id: `plan-${type}`, type, position: { x: 0, y: 0 }, data: { label: type } });
  const r = command(game, 'security', 'plan.publish', { graph: rerouted, revision: 1 });
  assert.equal(r.ok, false, 'Seguridad no puede redibujar el camino que sale de la tienda web');
});

test('publicar un plano idéntico no cobra ni descarta el trabajo en curso', () => {
  const game = started();
  const company = game.companies[0];
  const r = command(game, 'backend', 'plan.publish', { graph: planWith('web'), revision: 0 });
  assert.equal(r.ok, false);
  assert.equal(company.capital, 10000);
  assert.equal(company.version, 1);
});
