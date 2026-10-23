import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../server/engine.js';
import { planServices } from '../server/graphs.js';
import { advanceGame, command, planWith } from './helpers.js';

const SELLING = ['web', 'checkout', 'inventory', 'payment', 'exit'];
/** Opens the room and closes company 0's montaje with a plan that sells and has no perímetro. */
function selling() {
  const game = createGame(); command(game, 'operator', 'room.start');
  assert.equal(command(game, 'backend', 'plan.publish', { graph: planWith(...SELLING), revision: 0 }).ok, true);
  advanceGame(game, .1);
  assert.equal(game.companies[0].assembly.active, false);
  return game;
}
const withPerimeter = () => planWith('security', ...SELLING);
/** Protections already in production, as the full cycle leaves them: they only filter where the plan has a perímetro. */
function protect(game: ReturnType<typeof createGame>) {
  const company = game.companies[0];
  company.runtime.releases[company.version] = { modules: [], security: { auth: true, authorization: true, waf: true, botThreshold: 80, blockedOrigins: [], rate: null } };
}

test('tras la primera venta, Seguridad envía el perímetro al ciclo y llega a producción por QA, CTO y DevOps', () => {
  const game = selling(), company = game.companies[0];
  const capital = company.capital, version = company.version;
  const submitted = command(game, 'security', 'plan.submit', { graph: withPerimeter(), revision: 0 });
  assert.equal(submitted.ok, true, submitted.error);
  const change = game.changes.find(ch => ch.id === submitted.refs![0])!;
  assert.equal(change.domain, 'plan');
  assert.equal(change.status, 'QA_PENDING', 'un cambio de plano va directo a QA');
  assert.equal(change.cost, 100 + 300, 'el CTO autoriza el mismo costo que el editor muestra');
  assert.equal(planServices(company.plan).includes('security'), false, 'enviar no toca producción');
  assert.equal(company.capital, capital, 'enviar no cobra');
  assert.equal(company.planDrafts.security!.revision, 1, 'el envío avanza el borrador de Seguridad');

  assert.equal(command(game, 'qa', 'qa.run', { suite: 'Seguridad' }, change.id).ok, true);
  advanceGame(game, 4);
  assert.equal(change.status, 'QA_PENDING'); assert.equal(change.reports.length, 1);
  assert.equal(command(game, 'qa', 'qa.approve', {}, change.id).ok, true);
  assert.equal(change.status, 'CTO_PENDING');
  assert.equal(command(game, 'cto', 'cto.authorize', {}, change.id).ok, true);
  assert.equal(change.status, 'AUTHORIZED'); assert.equal(company.reserved, 400);
  assert.equal(command(game, 'devops', 'deploy.start', { strategy: 'rolling' }, change.id).ok, true);
  advanceGame(game, 7);

  assert.equal(change.status, 'DEPLOYED');
  assert.ok(planServices(company.plan).includes('security'), 'el perímetro quedó en el plano de producción');
  assert.equal(company.version, version + 1);
  assert.equal(company.reserved, 0);
  const charged = game.actions.audit.find(a => a.type === 'deploy.completed' && a.refs.includes(change.id));
  assert.ok(charged?.effects.includes('capital.delta:-400'), 'se cobra al publicar, no antes');
});

test('el perímetro que llega por el ciclo detiene en producción lo que antes pasaba', () => {
  const game = selling(), company = game.companies[0];
  protect(game);
  const submitted = command(game, 'security', 'plan.submit', { graph: withPerimeter(), revision: 0 });
  const change = game.changes.find(ch => ch.id === submitted.refs![0])!;
  command(game, 'qa', 'qa.run', { suite: 'Seguridad' }, change.id); advanceGame(game, 4);
  command(game, 'qa', 'qa.approve', {}, change.id); command(game, 'cto', 'cto.authorize', {}, change.id);
  command(game, 'devops', 'deploy.start', { strategy: 'rolling' }, change.id); advanceGame(game, 7);
  assert.equal(change.status, 'DEPLOYED');
  const release = company.runtime.releases[company.version];
  assert.equal(release.security?.waf, true, 'publicar el plano conserva la protección que ya estaba en producción');
});

test('QA prueba en staging el plano propuesto: sin camino por el perímetro, nada se filtra', () => {
  const routed = selling(); protect(routed);
  const through = command(routed, 'security', 'plan.submit', { graph: withPerimeter(), revision: 0 });
  command(routed, 'qa', 'qa.run', { suite: 'Seguridad' }, through.refs![0]); advanceGame(routed, 4);
  const blocked = routed.changes[0].reports[0];

  const placedOnly = selling(); protect(placedOnly);
  // The perímetro is on its solar, but no road goes through it.
  const graph = planWith(...SELLING); graph.nodes.push({ id: 'plan-security', type: 'security', position: { x: 0, y: 0 }, data: { label: 'security' } });
  const aside = command(placedOnly, 'security', 'plan.submit', { graph, revision: 0 });
  assert.equal(aside.ok, true, aside.error);
  command(placedOnly, 'qa', 'qa.run', { suite: 'Seguridad' }, aside.refs![0]); advanceGame(placedOnly, 4);
  const open = placedOnly.changes[0].reports[0];

  assert.equal(blocked.securityOutcomes!.blocked, blocked.requests, 'con el camino por el perímetro, las protecciones detienen todo');
  assert.equal(open.securityOutcomes!.blocked, 0, 'un perímetro sin camino no filtra nada, igual que en producción');
});

test('el envío al ciclo respeta la propiedad de las piezas del plano', () => {
  const game = selling();
  // Backend's draft is at revision 1 after the publication that closed the montaje.
  const r = command(game, 'backend', 'plan.submit', { graph: withPerimeter(), revision: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error!, /Seguridad/);
  assert.equal(game.changes.length, 0);
});

test('durante el montaje el plano se publica directo, no por el ciclo', () => {
  const game = createGame(); command(game, 'operator', 'room.start');
  const r = command(game, 'backend', 'plan.submit', { graph: planWith('web', 'exit'), revision: 0 });
  assert.equal(r.ok, false);
  assert.match(r.error!, /montaje/i);
  assert.equal(game.changes.length, 0);
});

test('un plano idéntico no se envía al ciclo', () => {
  const game = selling();
  const r = command(game, 'security', 'plan.submit', { graph: planWith(...SELLING), revision: 0 });
  assert.equal(r.ok, false);
  assert.equal(game.changes.length, 0);
});

test('una revisión vieja del borrador no se envía', () => {
  const game = selling();
  assert.equal(command(game, 'security', 'plan.save', { graph: withPerimeter(), revision: 0 }).ok, true);
  const r = command(game, 'security', 'plan.submit', { graph: withPerimeter(), revision: 0 });
  assert.equal(r.ok, false);
  assert.match(r.error!, /revisión/i);
  assert.equal(game.changes.length, 0);
});

test('QA y el CTO no envían cambios de plano', () => {
  const game = selling();
  for (const role of ['qa', 'cto'] as const) assert.equal(command(game, role, 'plan.submit', { graph: withPerimeter(), revision: 0 }).code, 'FORBIDDEN');
});

test('si otra publicación cambia producción, el cambio de plano pendiente queda con la base vieja', () => {
  const game = selling(), company = game.companies[0];
  const perimeter = command(game, 'security', 'plan.submit', { graph: withPerimeter(), revision: 0 });
  // Backend rewires its own roads in a separate change that reaches production first.
  const rewired = planWith('web', 'inventory', 'checkout', 'payment', 'exit');
  const other = command(game, 'backend', 'plan.submit', { graph: rewired, revision: 1 });
  assert.equal(other.ok, true, other.error);
  const first = game.changes.find(ch => ch.id === other.refs![0])!;
  command(game, 'qa', 'qa.run', { suite: 'Unitarias' }, first.id); advanceGame(game, 2);
  command(game, 'qa', 'qa.approve', {}, first.id); command(game, 'cto', 'cto.authorize', {}, first.id);
  command(game, 'devops', 'deploy.start', { strategy: 'rolling' }, first.id); advanceGame(game, 7);
  assert.equal(first.status, 'DEPLOYED');
  const stale = game.changes.find(ch => ch.id === perimeter.refs![0])!;
  assert.equal(stale.status, 'STALE', 'se envía de nuevo sobre el plano vigente; nunca se pisa un plano más nuevo');
  assert.equal(planServices(company.plan).includes('security'), false);
});

test('mientras hay un despliegue en curso no se envía otro cambio de plano', () => {
  const game = selling();
  const first = command(game, 'security', 'plan.submit', { graph: withPerimeter(), revision: 0 });
  const change = game.changes.find(ch => ch.id === first.refs![0])!;
  command(game, 'qa', 'qa.run', { suite: 'Unitarias' }, change.id); advanceGame(game, 2);
  command(game, 'qa', 'qa.approve', {}, change.id); command(game, 'cto', 'cto.authorize', {}, change.id);
  assert.equal(command(game, 'devops', 'deploy.start', { strategy: 'rolling' }, change.id).ok, true);
  const r = command(game, 'backend', 'plan.submit', { graph: planWith('web', 'inventory', 'checkout', 'payment', 'exit'), revision: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error!, /publicación en curso/);
});

test('el mismo plano no se envía dos veces mientras el primero sigue en el ciclo', () => {
  const game = selling();
  const first = command(game, 'security', 'plan.submit', { graph: withPerimeter(), revision: 0 });
  assert.equal(first.ok, true, first.error);
  const again = command(game, 'security', 'plan.submit', { graph: withPerimeter(), revision: 1 });
  assert.equal(again.ok, false);
  assert.match(again.error!, new RegExp(first.refs![0]));
  assert.equal(game.changes.length, 1);
  // Once QA returns it, the same plan can travel again.
  assert.equal(command(game, 'qa', 'qa.reject', {}, first.refs![0]).ok, true);
  assert.equal(command(game, 'security', 'plan.submit', { graph: withPerimeter(), revision: 1 }).ok, true);
});
