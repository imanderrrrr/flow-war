import test from 'node:test';
import assert from 'node:assert/strict';
import { CTO_DEFAULT_REASON, QA_NO_COMMENT, SUITE_INFO, attachFinished, awaitsCto, ctoDecision, evidenceLines, qaApproval, qaReturn, strategyFor } from '../src/consoleState.js';
import { SUITES, type ChangeStatus } from '../shared/types.js';

test('la decisión del CTO queda a la vista mientras el cambio la espera', () => {
  for (const status of ['CTO_PENDING', 'EXPIRED'] as ChangeStatus[]) assert.equal(awaitsCto({ status }), true, status);
  for (const status of ['SECURITY_PENDING', 'QA_PENDING', 'QA_RUNNING', 'AUTHORIZED', 'DEPLOYING', 'DEPLOYED', 'STALE'] as ChangeStatus[]) assert.equal(awaitsCto({ status }), false, status);
  assert.equal(awaitsCto(undefined), false);
});

test('la estrategia de deploy elegida para un cambio no pasa al siguiente', () => {
  const chosen = { changeId: 'CH-001', strategy: 'restart' as const };
  assert.equal(strategyFor(chosen, 'CH-001'), 'restart');
  assert.equal(strategyFor(chosen, 'CH-002'), '', 'un cambio nuevo arranca sin estrategia elegida');
  assert.equal(strategyFor(null, 'CH-002'), '');
  assert.equal(strategyFor(chosen, undefined), '');
});

test('una prueba que termina queda adjunta sola, y la que el estudiante desmarca sigue desmarcada', () => {
  let state = attachFinished({ selected: [], known: [] }, ['R1']);
  assert.deepEqual(state.selected, ['R1']);
  state = { ...state, selected: [] };
  assert.deepEqual(attachFinished(state, ['R1']).selected, [], 'desmarcar no se deshace solo');
  assert.deepEqual(attachFinished(state, ['R1', 'R2']).selected, ['R2'], 'la siguiente prueba se adjunta igual');
  const same = attachFinished(state, ['R1']);
  assert.equal(same, state, 'sin pruebas nuevas no cambia nada');
});

const pending = { id: 'CH-003', status: 'QA_PENDING' as ChangeStatus, reports: [{}], domain: 'backend', implementation: {} };
test('APROBAR manda las pruebas marcadas con el comentario, que es opcional', () => {
  assert.deepEqual(qaApproval(pending, ['R1', 'R2'], ['R2'], '  Probé la última unidad.  '), { type: 'qa.review', payload: { changeId: 'CH-003', risks: 'Probé la última unidad.', evidenceIds: ['R2'] } });
  assert.equal((qaApproval(pending, ['R1'], ['R1'], '  ')!.payload as { risks: string }).risks, QA_NO_COMMENT);
  assert.equal(qaApproval(pending, ['R1'], [], 'ok'), null, 'con pruebas para marcar y ninguna marcada todavía no se aprueba');
  assert.equal(qaApproval({ ...pending, status: 'QA_RUNNING' }, ['R1'], ['R1'], ''), null);
  assert.equal(qaApproval({ ...pending, reports: [] }, [], [], ''), null, 'sin ninguna prueba no hay aprobación');
});

test('con solo un reporte histórico, APROBAR adjunta los reportes del cambio y conserva el comentario', () => {
  assert.deepEqual(qaApproval(pending, [], [], 'Reporte de Concurrencia sin sobreventa.'), { type: 'qa.approve', changeId: 'CH-003', payload: { risks: 'Reporte de Concurrencia sin sobreventa.' } });
  assert.deepEqual(qaApproval(pending, [], [], ''), { type: 'qa.approve', changeId: 'CH-003', payload: {} });
  assert.equal(qaApproval({ ...pending, reports: [{ obsolete: true }] }, [], [], ''), null, 'un reporte obsoleto no alcanza');
});

test('DEVOLVER pide dos líneas y completa la carta con las pruebas adjuntas', () => {
  const evidence = [{ scenario: 'R1 · Suite Concurrencia', observed: '2 completadas · 0 rechazadas · 1 sobreventas · 0 cobros duplicados · 0 accesos indebidos' }];
  const letter = qaReturn(pending, 'backend', 'Se vendió la última unidad dos veces.', 'Una compra cobrada y la otra rechazada.', evidence, ['R1'])!;
  assert.equal(letter.type, 'qa.return');
  assert.deepEqual(letter.payload, { changeId: 'CH-003', recipient: 'backend', subject: 'Se vendió la última unidad dos veces.', description: 'Se vendió la última unidad dos veces.',
    steps: 'R1 · Suite Concurrencia', observed: evidence[0].observed, expected: 'Una compra cobrada y la otra rechazada.', severity: 'medium', evidenceIds: ['R1'], observationRefs: [] });
  assert.equal(qaReturn(pending, 'backend', 'Falla', ' ', evidence, ['R1']), null, 'sin lo esperado no hay carta');
  assert.equal(qaReturn(pending, 'backend', ' ', 'Algo', evidence, ['R1']), null, 'sin lo que falló no hay carta');
  assert.match(String(qaReturn(pending, 'security', 'Falla', 'Algo', [], [])!.payload.steps), /sin prueba/i, 'sin pruebas adjuntas la carta lo dice');
  assert.equal(qaReturn(pending, 'security', 'Falla', 'Algo', [], [])!.payload.recipient, 'security');
});

test('un cambio del plano se devuelve sin carta y una promoción le vuelve a Producto', () => {
  assert.deepEqual(qaReturn({ ...pending, domain: 'plan', implementation: undefined }, 'backend', '', '', [], []), { type: 'qa.reject', changeId: 'CH-003', payload: {} });
  assert.equal(qaReturn({ ...pending, domain: 'product', implementation: undefined }, 'backend', 'Falla', 'Algo', [], [])!.payload.recipient, 'product');
});

test('el CTO decide con un toque; sin motivo escrito queda registrado qué decidió', () => {
  assert.deepEqual(ctoDecision('CH-003', 'authorize', ''), { type: 'cto.decide', payload: { changeId: 'CH-003', decision: 'authorize', reason: CTO_DEFAULT_REASON.authorize, confirmed: true } });
  assert.equal(ctoDecision('CH-003', 'evidence', '  ').payload.reason, CTO_DEFAULT_REASON.evidence);
  assert.equal(ctoDecision('CH-003', 'reject', ' Falta la prueba de carga. ').payload.reason, 'Falta la prueba de carga.');
});

test('cada suite dice qué simula', () => {
  for (const suite of SUITES) assert.ok(SUITE_INFO[suite]?.length > 10, suite);
});

test('la carta cita las pruebas marcadas, o los reportes históricos si no hay ninguna para marcar', () => {
  const run = { id: 'R1', request: 'Suite Concurrencia', seed: 9, scenario: { requests: 200, stock: 1, concurrency: 200 } };
  const counts = { completed: 1, rejected: 199, oversold: 0, duplicates: 0, breaches: 0 };
  const reports = [{ suite: 'Concurrencia', ...counts, testEvidence: { runId: 'R1' } }, { suite: 'Carga', ...counts }, { suite: 'Carga', ...counts, obsolete: true }];
  assert.deepEqual(evidenceLines([run], reports, ['R1']), [{ scenario: 'R1 · Suite Concurrencia · 200 solicitudes · stock 1 · 200 a la vez · semilla 9', observed: '1 completadas · 199 rechazadas · 0 sobreventas · 0 cobros duplicados · 0 accesos indebidos' }]);
  assert.deepEqual(evidenceLines([run], reports, []).map(e => e.scenario), ['Carga (prueba histórica)'], 'sin marcar, los históricos vigentes');
});

test('la carta de devolución cabe en el límite del servidor aunque adjunte muchas pruebas largas', () => {
  const long = 'x'.repeat(4000), runs = Array.from({ length: 60 }, (_, i) => ({ id: `R${i}`, request: long, seed: i, scenario: { requests: 1, stock: 1, concurrency: 1 } }));
  const reports = runs.map(r => ({ suite: 'Unitarias', completed: 1, rejected: 0, oversold: 0, duplicates: 0, breaches: 0, testEvidence: { runId: r.id } }));
  const lines = evidenceLines(runs, reports, runs.map(r => r.id));
  assert.ok(lines[0].scenario.length < 200, 'el pedido de cada prueba se recorta');
  const letter = qaReturn(pending, 'backend', 'Falla', 'Algo', lines, runs.map(r => r.id))!;
  assert.ok(String(letter.payload.steps).length <= 4000 && String(letter.payload.observed).length <= 4000);
});
