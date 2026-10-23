import test from 'node:test';
import assert from 'node:assert/strict';
import { workflow } from '../server/workflow.js';
import { advanceGame, assembledGame, command, reviewForQa } from './helpers.js';

/** A Backend change that Seguridad reviewed with one control, so every quick suite runs in staging. */
function reviewed() {
  const game = assembledGame(); game.status = 'RUNNING';
  assert.equal(command(game, 'backend', 'change.submit', { graph: game.companies[0].backend, revision: 0 }).ok, true);
  const change = game.changes[0], review = game.companies[0].runtime.collaboration!.reviews[change.id];
  assert.equal(command(game, 'security', 'security.configure', { changeId: change.id, nodeId: 'backend-write', revision: review.revision, rules: [{ kind: 'input' }] }).ok, true);
  assert.equal(command(game, 'security', 'security.submit', { changeId: change.id, revision: review.revision }).ok, true);
  assert.equal(change.status, 'QA_PENDING');
  return { game, change };
}

test('una suite rápida que corre en staging queda como evidencia seleccionable', () => {
  const { game, change } = reviewed();
  const ran = command(game, 'qa', 'qa.run', { suite: 'Seguridad' }, change.id);
  assert.equal(ran.ok, true, ran.error);
  advanceGame(game, 4);
  const runs = workflow(game.companies[0]).runs.filter(r => r.changeId === change.id);
  assert.equal(runs.length, 1, 'la suite deja una corrida de evidencia, como un caso manual');
  assert.equal(runs[0].scenario.suite, 'security');
  assert.ok(runs[0].report, 'la corrida terminada guarda su reporte');
  assert.equal(change.reports.at(-1)!.testEvidence?.runId, runs[0].id, 'el reporte del cambio apunta a la corrida');
  const approved = command(game, 'qa', 'qa.review', { changeId: change.id, risks: 'La suite de seguridad no mostró accesos indebidos.', evidenceIds: [runs[0].id] });
  assert.equal(approved.ok, true, approved.error);
  assert.equal(change.status, 'CTO_PENDING');
});

test('la evidencia de una suite pasa la misma validación: no sirve para otra versión', () => {
  const { game, change } = reviewed();
  command(game, 'qa', 'qa.run', { suite: 'Unitarias' }, change.id); advanceGame(game, 2);
  const run = workflow(game.companies[0]).runs.find(r => r.changeId === change.id)!;
  // QA returns the change to Backend, which submits a new functional version.
  const returned = command(game, 'qa', 'qa.return', { changeId: change.id, recipient: 'backend', subject: 'Revisar', description: 'Revisar la compra.', steps: 'Correr la suite.', observed: 'Ver evidencia.', expected: 'Sin cambios.', severity: 'low', evidenceIds: [run.id], observationRefs: [] });
  assert.equal(returned.ok, true, returned.error);
  assert.equal(command(game, 'backend', 'change.submit', { graph: game.companies[0].backend, revision: game.companies[0].drafts.backend!.revision }).ok, true);
  const next = game.changes[0];
  assert.notEqual(next.id, change.id);
  command(game, 'security', 'security.submit', { changeId: next.id, revision: game.companies[0].runtime.collaboration!.reviews[next.id].revision });
  const reused = command(game, 'qa', 'qa.review', { changeId: next.id, risks: 'Reutilizo la corrida anterior.', evidenceIds: [run.id] });
  assert.equal(reused.ok, false);
  assert.match(reused.error!, /Evidencia ajena/);
});

test('las suites de un cambio de plano también quedan como evidencia', () => {
  const game = assembledGame(); game.status = 'RUNNING';
  const company = game.companies[0];
  company.plan.nodes = company.plan.nodes.filter(n => n.type !== 'security');
  company.plan.edges = [{ id: 'e0', source: 'plan-entry', target: 'plan-web' }, ...company.plan.edges.filter(e => e.source !== 'plan-entry' && e.source !== 'plan-security')];
  company.version++;
  const graph = structuredClone(company.plan);
  graph.nodes.push({ id: 'plan-security', type: 'security', position: { x: 240, y: 295 }, data: { label: 'Seguridad' } });
  graph.edges = [{ id: 'e0', source: 'plan-entry', target: 'plan-security' }, { id: 'e1', source: 'plan-security', target: 'plan-web' }, ...graph.edges.filter(e => e.source !== 'plan-entry')];
  const submitted = command(game, 'security', 'plan.submit', { graph, revision: 0 });
  assert.equal(submitted.ok, true, submitted.error);
  command(game, 'qa', 'qa.run', { suite: 'Concurrencia' }, submitted.refs![0]); advanceGame(game, 6);
  const runs = workflow(company).runs.filter(r => r.changeId === submitted.refs![0] && r.report);
  assert.equal(runs.length, 1);
});

test('aprobar con solo un reporte histórico guarda el comentario de QA, y sin comentario lo dice', () => {
  for (const risks of ['La última unidad no se sobrevendió.', undefined]) {
    const game = assembledGame(); game.status = 'RUNNING';
    assert.equal(command(game, 'backend', 'change.submit', { graph: game.companies[0].backend, revision: 0 }).ok, true);
    const change = game.changes[0];
    reviewForQa(game);
    // Without modules or controls Concurrencia runs the historical fixture: a report, never a markable run.
    assert.equal(command(game, 'qa', 'qa.run', { suite: 'Concurrencia' }, change.id).ok, true); advanceGame(game, 6);
    assert.equal(workflow(game.companies[0]).runs.filter(r => r.changeId === change.id).length, 0);
    const approved = command(game, 'qa', 'qa.approve', risks ? { risks } : {}, change.id);
    assert.equal(approved.ok, true, approved.error);
    const decision = workflow(game.companies[0]).decisions.find(d => d.changeId === change.id && d.kind === 'qa.approve')!;
    assert.equal(decision.reason, risks ?? 'Aprobación manual explícita; sin observaciones escritas.');
    assert.equal(change.status, 'CTO_PENDING');
  }
});

test('el comentario de una aprobación directa pasa la validación de texto', () => {
  const { game, change } = reviewed();
  command(game, 'qa', 'qa.run', { suite: 'Unitarias' }, change.id); advanceGame(game, 2);
  assert.equal(command(game, 'qa', 'qa.approve', { risks: 'x'.repeat(4001) }, change.id).ok, false);
  assert.equal(command(game, 'qa', 'qa.approve', { otro: 1 }, change.id).ok, false, 'solo admite el comentario');
  const approved = command(game, 'qa', 'qa.approve', { risks: 'Probé la compra simple.' }, change.id);
  assert.equal(approved.ok, true, approved.error);
  assert.equal(workflow(game.companies[0]).decisions.at(-1)!.reason, 'Probé la compra simple.', 'con corridas también conserva el comentario');
});
