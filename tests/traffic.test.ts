import test from 'node:test';
import assert from 'node:assert/strict';
import { ROAD_PATHS, SERVICES, TRAFFIC_PATHS, particlePath, particlePosition, type Point } from '../src/trafficGeometry.js';

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
