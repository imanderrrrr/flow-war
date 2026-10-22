import { createGame } from '../server/engine.js';
import { command, reviewForQa } from './helpers.js';
export function defectFixture(kind: 'coupon' | 'purchase' | 'concurrency' | 'inventory', code: string, present = true) {
  for (let seed = 1; seed <= 500; seed++) {
    const g = createGame(1500, seed); g.status = 'RUNNING';
    const configuration = kind === 'coupon' ? { kind, percent: 20, audience: 'new', stackable: false } : kind === 'purchase' ? { kind, idempotent: true } : kind === 'concurrency' ? { kind, strategy: 'atomic' } : { kind, minimum: 1 };
    command(g, 'backend', 'module.create', { name: kind, configuration, dependencies: [] });
    if (g.changes[0].context!.execution!.modules[0].defects.some(d => d.code === code) === present) { reviewForQa(g); return g; }
  }
  throw new Error('No deterministic fixture found.');
}
