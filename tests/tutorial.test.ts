import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIALS, type TutorialRole } from '../shared/tutorial.js';
import type { GameState, Identity } from '../shared/types.js';
import { createGame } from '../server/engine.js';
import { serializeGame } from '../server/persistence.js';
import { ensureLobby, formTeams, joinLobby, movePlayer } from '../server/lobby.js';
import { LOBBY_ICONS } from '../shared/lobby.js';
import { acknowledge, createPractice, enterTutorial, entryFor, owesTutorial, pendingPlayers, practiceCommand, practiceFinished, practiceSnapshot, setStep, solutionFor, tickPractice, tutorialBoard, tutorialPending, withAtomic, type Practice, type Subject } from '../server/tutorial.js';

const ROLES = Object.keys(TUTORIALS) as TutorialRole[];
const identityFor = (role: TutorialRole, companyId = 2): Identity => role === 'auditor' ? { id: 'auditor-P26', role, companyId: null } : { id: `${companyId}-${role}`, role, companyId };
const subjectFor = (role: TutorialRole): Subject => ({ key: `i:${role}`, identity: identityFor(role) });
const meta = (p: Practice) => TUTORIALS[p.identity.role as TutorialRole].steps[p.step];
let sequence = 0;
/** One step the way a browser does it: the canonical action, or ENTENDIDO once the step is ready. */
function play(p: Practice) {
  const snapshot = practiceSnapshot(p, 0), view = snapshot.tutorial!;
  if (meta(p).kind === 'action') {
    const solution = solutionFor(snapshot);
    if (solution) { const result = practiceCommand(p, { id: `play-${++sequence}`, ...solution }); assert.equal(result.ok, true, `${view.stepId}: ${result.error}`); }
    for (let i = 0; i < 400 && p.step === view.step; i++) tickPractice(p);
  } else {
    for (let i = 0; i < 400 && !practiceSnapshot(p, 0).tutorial!.ready; i++) tickPractice(p);
    assert.equal(acknowledge(p, view.stepId), true, view.stepId);
  }
  assert.equal(p.step, view.step + 1, `${view.stepId} no avanzó`);
}
function playThrough(role: TutorialRole, upTo = Infinity) {
  const p = createPractice({ seed: 7357, generation: 0 }, subjectFor(role));
  while (!practiceFinished(p) && p.step < upTo) play(p);
  return p;
}

for (const role of ROLES) {
  test(`el tutorial de ${role} se completa haciendo cada acción real`, () => {
    const p = playThrough(role);
    assert.equal(practiceFinished(p), true);
  });
  test(`el tutorial de ${role} se retoma en cualquier paso, como tras un reinicio del servidor`, () => {
    for (let step = 1; step < TUTORIALS[role].steps.length; step++) {
      const p = createPractice({ seed: 7357, generation: 0 }, subjectFor(role), step);
      assert.equal(p.step, step, `${role} reconstruido en el paso ${step}`);
      while (!practiceFinished(p)) play(p);
    }
  });
}

test('cada paso tiene un objetivo en la pantalla y dice qué hacer en una o dos oraciones', () => {
  for (const role of ROLES) {
    assert.match(TUTORIALS[role].job, /\S/);
    assert.equal(TUTORIALS[role].steps[0].kind, 'read', `${role} empieza diciendo cuál es su trabajo`);
    for (const step of TUTORIALS[role].steps) {
      assert(step.target, `${step.id} resalta un elemento`);
      const sentences = step.text.split(/(?<=[.!?:])\s+(?=[A-ZÁÉÍÓÚÑ¿¡«])/).length;
      assert(sentences <= 3 && step.text.length <= 260, `${step.id}: ${step.text}`);
      if (step.kind === 'ui') assert(step.check, `${step.id} dice qué estado lo completa`);
    }
  }
});

test('un paso de acción solo avanza con el comando confirmado: ni el tiempo ni ENTENDIDO lo cierran', () => {
  const p = playThrough('backend', 3);
  assert.equal(meta(p).id, 'backend-publicar');
  for (let i = 0; i < 100; i++) tickPractice(p);
  assert.equal(acknowledge(p, 'backend-publicar'), false);
  assert.equal(meta(p).id, 'backend-publicar');
  // A plan published without the purchase route does not count, and the card says why.
  const s = practiceSnapshot(p, 0);
  assert.equal(practiceCommand(p, { id: 'wrong-plan', type: 'plan.publish', companyId: 2, payload: { graph: s.privateCompany!.plan, revision: 0 } }).ok, false, 'publicar sin cambios se rechaza');
  play(p);
  assert.equal(meta(p).id, 'backend-sobreventa');
});

test('una lectura que habla de un resultado no se cierra hasta que el motor lo produce', () => {
  const p = playThrough('backend', 4);
  assert.equal(meta(p).id, 'backend-sobreventa');
  const view = practiceSnapshot(p, 0).tutorial!;
  assert.equal(view.ready, false); assert(view.waiting);
  assert.equal(acknowledge(p, 'backend-sobreventa'), false);
  for (let i = 0; i < 400 && !practiceSnapshot(p, 0).tutorial!.ready; i++) tickPractice(p);
  const done = practiceSnapshot(p, 0).tutorial!;
  assert.equal(done.ready, true); assert.match(done.facts[0], /2 compras completadas sobre 1 unidad · 1 sobreventa/);
  assert.equal(acknowledge(p, 'otro-paso'), false, 'solo el paso actual');
  assert.equal(acknowledge(p, 'backend-sobreventa'), true);
});

test('un cambio sin la corrección vuelve a Backend con una carta y el paso espera el correcto', () => {
  const p = playThrough('backend', 7);
  assert.equal(meta(p).id, 'backend-enviar');
  const s = practiceSnapshot(p, 0), graph = s.privateCompany!.drafts.backend?.graph ?? s.privateCompany!.backend;
  assert.equal(practiceCommand(p, { id: 'no-fix', type: 'change.submit', companyId: 2, payload: { graph, revision: s.privateCompany!.drafts.backend?.revision ?? 0 } }).ok, true);
  for (let i = 0; i < 5; i++) tickPractice(p);
  assert.equal(meta(p).id, 'backend-enviar', 'sin Atomic Update no avanza');
  assert.match(practiceSnapshot(p, 0).tutorial!.facts.join(' '), /falta Atomic Update/);
  // The scripted QA returned it, so the logic is editable again and the right change goes through.
  const again = practiceSnapshot(p, 0);
  assert.equal(practiceCommand(p, { id: 'fix', type: 'change.submit', companyId: 2, payload: { graph: withAtomic(again.privateCompany!.drafts.backend!.graph), revision: again.privateCompany!.drafts.backend!.revision } }).ok, true);
  tickPractice(p);
  assert.equal(meta(p).id, 'backend-fin');
});

test('las órdenes de práctica se validan como las reales: rol, empresa y parámetros', () => {
  const p = playThrough('qa', 2);
  assert.equal(practiceCommand(p, { id: 'x1', type: 'cto.infra_authorize', companyId: 2, payload: { amount: 1, durationSeconds: 60, maxServers: 2, operations: ['scale'] } }).code, 'FORBIDDEN');
  assert.equal(practiceCommand(p, { id: 'x2', type: 'qa.execute', companyId: 1, payload: {} }).code, 'FORBIDDEN');
  assert.equal(practiceCommand(p, { id: 'x3', type: 'qa.execute', companyId: 2, payload: { changeId: 'CH-001', scenario: { suite: 'concurrency' } } }).ok, false);
});

test('la práctica no toca la sala real: ni economía, ni empresas, ni el registro', () => {
  const real = createGame(); real.status = 'RUNNING';
  const before = serializeGame(real);
  for (const role of ROLES) {
    const p = createPractice(real, subjectFor(role));
    while (!practiceFinished(p)) play(p);
  }
  assert.equal(serializeGame(real), before);
});

function room(players = 26): GameState {
  const g = createGame(); ensureLobby(g, n => n - 1, 1);
  for (let i = 0; i < players; i++) joinLobby(g, { pin: g.lobby!.pin, name: `Jugador ${i}`, icon: LOBBY_ICONS[0] });
  let k = 0; formTeams(g, n => (k++ * 7) % n);
  return g;
}
const seat = (g: GameState, index: number): Subject => {
  const p = g.lobby!.participants[index], identity: Identity = p.companyId !== undefined ? { id: `${p.companyId}-${p.role}`, role: p.role!, companyId: p.companyId } : { id: `auditor-${p.id}`, role: 'auditor', companyId: null };
  return { key: `p:${p.id}`, identity, participantId: p.id };
};

test('los asientos del sorteo deben el tutorial; una credencial, desde que entra a su espacio', () => {
  const g = room(), first = seat(g, 0), credential: Subject = { key: 'i:3-qa', identity: identityFor('qa', 3) };
  assert.equal(owesTutorial(g, first), true); assert.equal(tutorialPending(g, first), true, 'sin entrar todavía también lo debe');
  assert.equal(owesTutorial(g, credential), false);
  assert.equal(enterTutorial(g, credential, 5), true); assert.equal(tutorialPending(g, credential), true);
  setStep(g, credential, TUTORIALS.qa.steps.length, 9);
  assert.equal(tutorialPending(g, credential), false); assert.equal(entryFor(g, credential)!.finishedAt, 9);
  // Producto/UX owes nothing in a room without the department.
  assert.equal(owesTutorial(g, { key: 'i:0-product', identity: identityFor('product', 0) }), false);
  assert.equal(enterTutorial(g, { key: 'i:0-product', identity: identityFor('product', 0) }), false);
});

test('el progreso es de cada jugador, se reinicia si el docente le cambia el asiento y con la generación', () => {
  const g = room(), index = g.lobby!.participants.findIndex(p => p.companyId !== undefined), first = seat(g, index);
  setStep(g, first, 3);
  assert.equal(entryFor(g, first)!.step, 3);
  const company = g.lobby!.participants[index].companyId!;
  movePlayer(g, g.lobby!.participants[index].id, (company + 1) % 5, () => 0);
  const moved = seat(g, index);
  assert.equal(entryFor(g, moved), undefined, 'otro asiento, otro tutorial');
  assert.equal(tutorialPending(g, moved), true);
  g.generation++;
  assert.equal(entryFor(g, first), undefined, 'una partida nueva empieza de cero');
});

test('EMPEZAR JUEGO espera solo a los jugadores conectados que no terminaron', () => {
  const g = room(), seated = g.lobby!.participants.map((_, i) => seat(g, i));
  const connected = new Set(seated.slice(0, 4).map(s => s.key));
  assert.equal(pendingPlayers(g, connected).length, 4);
  assert.equal(pendingPlayers(g, new Set()).length, 0, 'un ausente no frena la sala');
  for (const s of seated.slice(0, 3)) setStep(g, s, TUTORIALS[s.identity.role as TutorialRole].steps.length);
  assert.deepEqual(pendingPlayers(g, connected).map(p => p.key), [seated[3].key]);
  const credential: Subject = { key: 'i:4-cto', identity: identityFor('cto', 4) };
  enterTutorial(g, credential);
  assert.equal(pendingPlayers(g, new Set([...connected, credential.key])).length, 2, 'una credencial en su tutorial también cuenta');
  const board = tutorialBoard(g, connected);
  assert.equal(board.rows.length, 27); assert.equal(board.finished, 3); assert.equal(board.pending, 1);
  assert.equal(board.rows.find(r => r.key === seated[0].key)!.finished, true);
  assert.equal(board.rows.filter(r => r.role === 'auditor').length, 1, 'la reserva hace el tutorial de auditor');
});

test('publicar un recorrido que vende en otro orden no deja al Backend sin salida', () => {
  const p = playThrough('backend', 3);
  const s = practiceSnapshot(p, 0), plan = s.privateCompany!.plan;
  // Tienda web → Inventario → Checkout → Pagos → Salida: can sell, so the montaje closes for good.
  const id = (t: string) => `plan-${t}`, pieces = ['checkout', 'inventory', 'payment', 'exit'];
  const graph = { nodes: [...plan.nodes, ...pieces.map(t => ({ id: id(t), type: t, position: { x: 0, y: 0 }, data: { label: t } }))],
    edges: [...plan.edges, ...[['web', 'inventory'], ['inventory', 'checkout'], ['checkout', 'payment'], ['payment', 'exit']].map(([a, b]) => ({ id: `${a}-${b}`, source: id(a), target: id(b) }))] };
  assert.equal(practiceCommand(p, { id: 'other-order', type: 'plan.publish', companyId: 2, payload: { graph, revision: s.privateCompany!.planDrafts?.backend?.revision ?? 0 } }).ok, true);
  for (let i = 0; i < 3; i++) tickPractice(p);
  assert.equal(meta(p).id, 'backend-sobreventa');
  while (!practiceFinished(p)) play(p);
});

test('DevOps no queda bloqueado si tarda: el CTO guionado renueva el alcance vencido', () => {
  for (const upTo of [1, 2, 3]) {
    const p = playThrough('devops', upTo);
    for (let i = 0; i < 16 * 60 * 10; i++) tickPractice(p);
    while (!practiceFinished(p)) play(p);
  }
});

test('empezar un paso de nuevo reconstruye la copia al inicio de ese mismo paso', () => {
  const p = playThrough('backend', 3), fresh = createPractice({ seed: 7357, generation: 0 }, subjectFor('backend'), p.step);
  assert.equal(fresh.step, 3); assert.equal(meta(fresh).id, 'backend-publicar');
  assert.equal(fresh.game.companies[2].assembly.active, true, 'el plano vuelve a estar en montaje');
});
