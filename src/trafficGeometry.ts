import type { FlowParticle } from '../shared/types';

export type Point = readonly [number, number];
export type Path = readonly Point[];
export const MAP_WIDTH = 1120;
export const MAP_HEIGHT = 570;
export const SERVICES = {
  ENTRY: [70, 295], GATE: [240, 295], WEB: [425, 295], AUTH: [425, 115],
  CHECK: [635, 295], STOCK: [825, 150], PAY: [825, 435], OUT: [1040, 295],
} as const;

const { ENTRY, GATE, WEB, AUTH, CHECK, STOCK, PAY, OUT } = SERVICES;
export const TRAFFIC_PATHS = {
  purchase: [ENTRY, GATE, WEB, CHECK, [730, 295], [730, 150], STOCK, [920, 150], [920, 435], PAY, [1040, 435], OUT],
  // Navigation leaves the storefront without passing through checkout or payments.
  browse: [ENTRY, GATE, WEB, [550, 295], [550, 70], [1040, 70], OUT],
} satisfies Record<string, Path>;

export const SERVICE_CONNECTIONS: Path[] = [
  [WEB, AUTH, [635, 115], CHECK],
  [GATE, [240, 465], [425, 465], WEB],
];

// The renderer draws the same paths used by moving clients. No hidden exits.
export const ROAD_PATHS: Path[] = Object.values(TRAFFIC_PATHS);

export function particlePath(particle: Pick<FlowParticle, 'route' | 'kind' | 'journey'>): Path {
  if (particle.journey) {
    const points = { entry: ENTRY, security: GATE, checkout: CHECK, inventory: STOCK, payment: PAY, exit: OUT };
    const path: Path = TRAFFIC_PATHS.purchase;
    const from = path.indexOf(points[particle.journey.from]), to = path.indexOf(points[particle.journey.to]);
    return from <= to ? path.slice(from, to + 1) : path.slice(to, from + 1).reverse();
  }
  const path: Path = TRAFFIC_PATHS[particle.route];
  if (particle.kind !== 'error') return path;
  const stop = particle.route === 'browse' ? WEB : CHECK;
  return path.slice(0, path.indexOf(stop) + 1);
}

export function particleProgress(particle: FlowParticle, now: number): number {
  const born = particle.journey?.at ?? particle.born;
  const duration = particle.journey?.duration ?? particle.duration;
  return Math.max(0, Math.min(1, (now - born) / duration));
}

export function particlePosition(path: Path, progress: number, seed = .5): Point {
  if (!path.length) throw new Error('A traffic path must contain a point.');
  const distances = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
  let distance = Math.max(0, Math.min(1, progress)) * distances.reduce((a, b) => a + b, 0);
  // Keep the entire 6 × 14 px sprite inside a 24 px road, including its feet.
  const lane = (Math.max(0, Math.min(1, seed)) - .5) * 8;
  for (let i = 0; i < distances.length; i++) {
    const length = distances[i];
    if (distance <= length && length > 0) {
      const [x, y] = path[i], [endX, endY] = path[i + 1];
      const dx = (endX - x) / length, dy = (endY - y) / length;
      return [x + dx * distance - dy * lane, y + dy * distance + dx * lane];
    }
    distance -= length;
  }
  return path.at(-1)!;
}
