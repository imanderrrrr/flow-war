import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame, project } from '../server/engine.js';
import { advanceGame, command, planWith } from './helpers.js';
import type { Identity } from '../shared/types.js';

const auditorIdentity: Identity = { id: 'auditor-P1', role: 'auditor', companyId: null };
const started = () => { const game = createGame(); command(game, 'operator', 'room.start'); return game; };
const auditorView = (game: ReturnType<typeof started>) => project(game, auditorIdentity).auditor!;
let sequence = 0;
/** An auditor belongs to no company, so its identity carries companyId null. */
const probe = (game: ReturnType<typeof started>, payload: Record<string, unknown>) =>
  applyCommand(game, auditorIdentity, { id: `probe-${++sequence}`, type: 'audit.probe', payload });
const sellingPlan = () => planWith('web', 'checkout', 'inventory', 'payment', 'exit');

test('una empresa en montaje se ve en montaje y sin módulos auditables', () => {
  const view = auditorView(started());
  assert.equal(view.companies[0].assembling, true);
  assert.deepEqual(view.companies[0].modules, []);
});

test('la prueba de control contra una empresa en montaje se rechaza', () => {
  const game = started();
  const r = probe(game, { companyId: 0, nodeId: 'backend-write', check: 'waf' });
  assert.equal(r.code, 'ASSEMBLING');
  assert.match(r.error!, /montaje|compras/i);
});

test('cerrado el montaje sin perímetro, los cinco controles figuran pendientes', () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.publish', { graph: sellingPlan(), revision: 0 }).ok, true);
  advanceGame(game, .1);
  const view = auditorView(game);
  assert.equal(view.companies[0].assembling, false);
  assert.deepEqual(view.companies[0].modules[0].pending.map(p => p.check).sort(),
    ['auth', 'bot_detection', 'rate_limit', 'role_check', 'waf']);
});

test('la ficha y el comando deciden con el mismo estado en el mismo tick', () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.publish', { graph: sellingPlan(), revision: 0 }).ok, true);
  advanceGame(game, .1);
  const view = auditorView(game);
  const r = probe(game, { companyId: 0, nodeId: 'backend-write', check: 'waf' });
  assert.equal(view.companies[0].assembling, false);
  assert.notEqual(r.code, 'ASSEMBLING');
  assert.equal(r.ok, true, r.error);
});

test('las empresas que siguen en montaje no estorban a la auditable', () => {
  const game = started();
  assert.equal(command(game, 'backend', 'plan.publish', { graph: sellingPlan(), revision: 0 }).ok, true);
  advanceGame(game, .1);
  const view = auditorView(game);
  assert.deepEqual(view.companies.map(c => c.assembling), [false, true, true, true, true]);
  assert.equal(probe(game, { companyId: 1, nodeId: 'backend-write', check: 'waf' }).code, 'ASSEMBLING');
});
