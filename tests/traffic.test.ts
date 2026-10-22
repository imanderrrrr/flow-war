import test from 'node:test';
import assert from 'node:assert/strict';
import { ROAD_PATHS, SERVICES, TRAFFIC_PATHS, particlePath, particlePosition, particleProgress, type Point } from '../src/trafficGeometry.js';
import { createGame } from '../server/engine.js';
import { advanceConcurrency, concurrencyParticles } from '../server/requests.js';
import { startConcurrency } from '../server/scenarios.js';
import { advanceGame, insertBlock } from './helpers.js';
import { admitTraffic, advanceTraffic, trafficParticles } from '../server/traffic.js';

function onDrawnRoad([x, y]: Point): boolean {
  return ROAD_PATHS.some(path => path.slice(1).some(([bx, by], i) => {
    const [ax, ay] = path[i];
    return ax === bx
      ? Math.abs(x - ax) <= 12 && y >= Math.min(ay, by) - 12 && y <= Math.max(ay, by) + 12
      : ay === by && Math.abs(y - ay) <= 12 && x >= Math.min(ax, bx) - 12 && x <= Math.max(ax, bx) + 12;
  }));
}

test('every moving sprite stays on a drawn road, including navigation exits and lane offsets', () => {
  for (const route of ['browse', 'purchase'] as const) {
    for (const kind of ['success', 'error', 'attack'] as const) {
      const path = particlePath({ route, kind });
      for (const seed of [0, .5, 1]) {
        for (let i = 0; i <= 400; i++) {
          const [x, y] = particlePosition(path, i / 400, seed);
          // Check the whole sprite, not only its center point.
          for (const dx of [-3, 3]) for (const dy of [-6, 8]) {
            assert.ok(onDrawnRoad([x + dx, y + dy]), `${route}/${kind} leaves the road at ${i / 400}`);
          }
        }
      }
    }
  }
});

test('navigation exits from the storefront without going through checkout, stock or payment', () => {
  const path = TRAFFIC_PATHS.browse;
  assert.ok(path.includes(SERVICES.WEB));
  assert.deepEqual(path.at(-1), SERVICES.OUT);
  for (const service of [SERVICES.CHECK, SERVICES.STOCK, SERVICES.PAY]) assert.equal(path.some(p => p[0] === service[0] && p[1] === service[1]), false);
});

test('a failed browsing request stops at the storefront instead of completing the exit route', () => {
  assert.deepEqual(particlePath({ route: 'browse', kind: 'error' }).at(-1), SERVICES.WEB);
  assert.deepEqual(particlePosition(TRAFFIC_PATHS.browse, 2), particlePosition(TRAFFIC_PATHS.browse, 1));
});

test('real request journeys wait at stock and finish at the confirmed result location', () => {
  const company = createGame().companies[0]; company.backend = insertBlock('atomic'); startConcurrency(company, 0);
  const run = company.concurrency.run!;
  for (let tick = 1; tick <= 40; tick++) {
    const now = tick / 10; advanceConcurrency(run, now);
    for (const particle of concurrencyParticles(run, company.color, now)) {
      const path = particlePath(particle);
      for (let progress = 0; progress <= 1; progress += .05) assert.ok(onDrawnRoad(particlePosition(path, progress, particle.seed)));
      if (particle.status === 'REJECTED') {
        assert.deepEqual(path.at(-1), SERVICES.STOCK);
        assert.deepEqual(particlePosition(path, particleProgress(particle, now + 10), .5), SERVICES.STOCK);
      }
      if (particle.status === 'COMPLETED') assert.deepEqual(path.at(-1), SERVICES.OUT);
    }
  }
  assert.equal(concurrencyParticles(run, company.color, 20).length, 0);
});

test('ordinary navigation and query journeys use existing roads and never imply a payment', () => {
  const company=createGame().companies[0];admitTraffic(company,0,'browse');admitTraffic(company,0,'query');
  for(let tick=1;tick<=30;tick++){
    advanceTraffic(company,tick/10);
    for(const particle of trafficParticles(company,tick/10)){
      const path=particlePath(particle);
      assert.ok(!path.some(([x,y])=>x===SERVICES.PAY[0]&&y===SERVICES.PAY[1]));
      for(let progress=0;progress<=1;progress+=.05)assert.ok(onDrawnRoad(particlePosition(path,progress,particle.seed)));
    }
  }
});

test('la demanda y el tráfico anómalo suben despacio al principio', () => {
  const g = createGame(), c = g.companies[0];
  g.status = 'RUNNING';
  advanceGame(g, 300);
  assert.equal(c.traffic.malicious.generated, 0, 'antes del minuto 6 no hay tráfico anómalo');
  advanceGame(g, 200);
  assert(c.traffic.malicious.generated > 0, 'después del minuto 6 sí');
  // Al minuto 10 la demanda legítima sigue siendo baja: con la curva anterior pasaba de 19/s.
  advanceGame(g, 100);
  const before = c.traffic.legitimate.generated;
  advanceGame(g, 10);
  const perSecond = (c.traffic.legitimate.generated - before) / 10;
  assert(perSecond > 3 && perSecond < 12, `llegadas por segundo al minuto 10: ${perSecond}`);
});
