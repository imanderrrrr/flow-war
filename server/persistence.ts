import type { GameState } from '../shared/types.js';
import { initialConcurrency } from './scenarios.js';

/** Upgrade only missing simulation state. Never infer historical requests/effects. */
export function recoverGame(serialized: string): GameState {
  const saved = JSON.parse(serialized);
  if (saved.schema !== 1 && saved.schema !== 2) throw new Error('Versión de partida no soportada.');
  if (saved.schema === 1) {
    for (const company of saved.companies) company.concurrency = initialConcurrency(saved.duration, saved.tick);
    for (const change of saved.changes) {
      for (const report of change.reports) report.obsolete = true;
      if (['QA_PENDING', 'QA_RUNNING', 'CTO_PENDING', 'AUTHORIZED', 'DEPLOYING', 'EXPIRED'].includes(change.status)) {
        const company = saved.companies[change.companyId];
        company.reserved = Math.max(0, company.reserved - change.reserved);
        change.reserved = 0;
        change.status = 'QA_PENDING';
        change.context = {
          backend: structuredClone(change.domain === 'backend' ? change.graph : company.backend),
          security: structuredClone(change.domain === 'security' ? change.graph : company.security),
          executionVersion: change.baseVersion,
        };
        delete change.due;
      }
    }
    saved.schema = 2;
  }
  if (saved.status === 'RUNNING') saved.status = 'PAUSED';
  return saved as GameState;
}
