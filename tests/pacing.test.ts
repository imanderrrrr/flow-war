import test from 'node:test';
import assert from 'node:assert/strict';
import { CALM_START, FULL, NOTICE_SECONDS, intensity, phaseNotice, phaseView } from '../shared/pacing.js';
import { applyCommand, assembleGame, createGame, defaultPacing, project } from '../server/engine.js';
import { generateTraffic } from '../server/traffic.js';
import { advanceGame } from './helpers.js';
import type { GameState } from '../shared/types.js';

const probe = (g: GameState, id: string) => applyCommand(g, { id: 'auditor-P1', role: 'auditor', companyId: null }, { id, type: 'audit.probe', payload: { companyId: 0, nodeId: 'backend-write', check: 'waf' } });
const started = (g: GameState) => { assembleGame(g); g.status = 'RUNNING'; return g; };

test('el cronograma por defecto: 15 minutos tranquilos, rampa hasta el 18 y presión completa después', () => {
  assert.deepEqual([CALM_START.calmUntil, CALM_START.rampUntil], [15 * 60, 18 * 60]);
  const calm = intensity(CALM_START, 0), late = intensity(CALM_START, 899.9);
  for (const phase of [calm, late]) assert.deepEqual(phase, { phase: 'calm', demand: CALM_START.calmDemand, anomalous: 0, penalty: CALM_START.calmPenalty, bursts: false, audits: false });
  const start = intensity(CALM_START, 900), middle = intensity(CALM_START, 990), end = intensity(CALM_START, 1079.9);
  assert.equal(start.phase, 'ramp'); assert.equal(start.anomalous, 0); assert.equal(start.demand, CALM_START.calmDemand);
  assert.equal(middle.anomalous, .5); assert(middle.demand > start.demand && middle.demand < 1); assert(middle.bursts && middle.audits);
  assert(end.demand < 1 && end.anomalous < 1);
  assert.equal(intensity(CALM_START, 1080), FULL); assert.equal(intensity(CALM_START, 1500), FULL);
  assert.equal(intensity(undefined, 0), FULL, 'una partida sin cronograma corre como antes');
  assert.deepEqual(phaseView(CALM_START, 120), { phase: 'calm', label: 'FASE TRANQUILA', nextAt: 900 });
  assert.deepEqual(phaseView(CALM_START, 1000), { phase: 'ramp', label: 'LA DEMANDA SUBE', nextAt: 1080 });
  assert.deepEqual(phaseView(CALM_START, 1200), { phase: 'full', label: 'PRESIÓN COMPLETA' });
});

test('cada partida nueva congela el cronograma; FLOW_CALM_START=0 conserva el anterior', () => {
  const g = createGame();
  assert.deepEqual(g.pacing, CALM_START); assert.notEqual(g.pacing, CALM_START, 'una copia, no la constante');
  const previous = process.env.FLOW_CALM_START;
  process.env.FLOW_CALM_START = '0';
  try { assert.equal(defaultPacing(), undefined); assert.equal(createGame().pacing, undefined); }
  finally { if (previous === undefined) delete process.env.FLOW_CALM_START; else process.env.FLOW_CALM_START = previous; }
  // A reset keeps the schedule of the new game.
  const reset = createGame(); delete reset.pacing;
  assert.equal(applyCommand(reset, { id: 'operator', role: 'operator', companyId: null }, { id: 'r', type: 'room.reset', payload: { duration: 1500 } }).ok, true);
  assert.deepEqual(reset.pacing, CALM_START);
});

test('antes del minuto 15 no hay ráfagas, ni tráfico anómalo, ni pruebas de control', () => {
  const g = started(createGame());
  assert.equal(probe(g, 'p0').code, 'CALM_PHASE');
  advanceGame(g, 899);
  for (const c of g.companies) {
    assert.equal(c.traffic.malicious.generated, 0, `${c.name} sin tráfico anómalo`);
    assert.equal(c.concurrency.totals.generated, 0, `${c.name} sin ráfagas LAST-UNIT`);
    assert(c.traffic.legitimate.generated > 0, `${c.name} atiende clientes`);
  }
  assert.equal(probe(g, 'p1').code, 'CALM_PHASE');
  assert.equal(project(g, { id: 'auditor-P1', role: 'auditor', companyId: null }).auditor!.opensAt, 900);
  assert(!g.events.some(e => /muchas compras juntas|tráfico anómalo simulado/.test(e.text)));
  // Minute 15: the bursts and the anomalous traffic arrive, and the class hears it.
  advanceGame(g, 2);
  assert(g.companies.some(c => c.concurrency.totals.generated > 0), 'la primera ráfaga llega en el minuto 15');
  assert(g.events.some(e => e.text.startsWith('Termina la fase tranquila')));
  assert.equal(probe(g, 'p2').ok, true, 'las pruebas de control se habilitan');
  advanceGame(g, 30);
  assert(g.companies.some(c => c.traffic.malicious.generated > 0), 'el tráfico anómalo crece con la rampa');
  advanceGame(g, 150);
  assert(g.events.some(e => e.text.startsWith('Presión completa')));
});

test('la fase tranquila escala la demanda existente; desde el minuto 18 es exactamente la de antes', () => {
  const arrivals = (pacing: GameState['pacing'] | null, at: number) => {
    const g = createGame(1500, 7357, 0, false, pacing), c = g.companies[0];
    generateTraffic(c, at, 30, g.duration, intensity(g.pacing, at));
    return c.traffic.legitimate.generated;
  };
  const calm = arrivals(CALM_START, 600), before = arrivals(null, 600);
  assert(calm > 0 && calm < before * .6, `minuto 10: ${calm} contra ${before}`);
  assert(arrivals(CALM_START, 1000) > calm, 'la rampa sube');
  assert.equal(arrivals(CALM_START, 1200), arrivals(null, 1200));
});

test('en la fase tranquila un error cuesta menos: presión, reputación y el reloj de eliminación', () => {
  const run = (pacing: GameState['pacing'] | null) => {
    const g = started(createGame(1500, 7357, 0, false, pacing)), c = g.companies[0];
    // The storefront gone after the montaje closed: the company serves nobody and its clock runs.
    c.plan = { nodes: c.plan.nodes.filter(n => n.type !== 'web'), edges: [] };
    advanceGame(g, 100);
    return c;
  };
  const calm = run(CALM_START), legacy = run(null);
  assert.equal(legacy.eliminated, true, 'sin cronograma, 90 s sin servicio eliminan');
  assert.equal(calm.eliminated, false, 'en la fase tranquila el reloj corre a un cuarto');
  assert(calm.deadTicks > 20 && calm.deadTicks < 30, String(calm.deadTicks));
});

test('avisos de fase: al empezar y un minuto antes de cada cambio, solo con hechos del cronograma', () => {
  const at = (tick: number) => phaseNotice(CALM_START, tick)?.key;
  assert.deepEqual([0, 39.9, 40, 300, 839.9].map(at), ['start', 'start', undefined, undefined, undefined]);
  assert.deepEqual([840, 899.9, 900, 919.9, 920, 1019.9].map(at), ['calm-ends', 'calm-ends', 'ramp', 'ramp', undefined, undefined]);
  assert.deepEqual([1020, 1079.9, 1080, 1099.9, 1100, 1499].map(at), ['full-soon', 'full-soon', 'full', 'full', undefined, undefined]);
  assert.equal(NOTICE_SECONDS.warning, 60);
  // The warnings count down to the change itself; the texts follow the frozen schedule.
  assert.equal(phaseNotice(CALM_START, 850)!.countdownTo, 900); assert.equal(phaseNotice(CALM_START, 1030)!.countdownTo, 1080);
  assert.match(phaseNotice(CALM_START, 0)!.text, /primeros 15 minutos la demanda es el 50 % .* el 25 % de lo normal/);
  assert.match(phaseNotice(CALM_START, 850)!.text, /sube durante 3 minutos/);
  const short = { ...CALM_START, calmUntil: 600, rampUntil: 840, calmDemand: .4 };
  assert.match(phaseNotice(short, 5)!.text, /primeros 10 minutos la demanda es el 40 %/); assert.match(phaseNotice(short, 545)!.text, /durante 4 minutos/);
  // Facts only: no notice ever tells a team what to do.
  for (let t = 0; t < 1500; t += 5) { const n = phaseNotice(CALM_START, t); if (n) assert.doesNotMatch(`${n.title} ${n.text}`, /deber|convien|recomend|te sugier|tenés que|tienen que|prepar|asegur/i, n.key); }
  assert.equal(phaseNotice(undefined, 0), undefined, 'a game without a schedule shows none');
  // The snapshot carries the notice of the moment, and nothing outside its window.
  const g = started(createGame()), view = (tick: number) => { g.tick = tick; return project(g, null).phase; };
  assert.equal(view(10)!.notice!.key, 'start'); assert.equal(view(120)!.notice, undefined); assert.equal(view(870)!.notice!.title, 'TERMINA LA FASE TRANQUILA');
});
