import { assertMarket, bindMarket, importLegacyMarket } from './market.js';
import type { GameState } from '../shared/types.js';
import { initialConcurrency } from './scenarios.js';
import { initialTraffic } from './traffic.js';

/** Upgrade only missing simulation state. Never infer historical requests/effects. */
export function recoverGame(serialized: string): GameState {
  const saved = JSON.parse(serialized);
  if (![1, 2, 3, 4].includes(saved.schema)) throw new Error('Versión de partida no soportada.');
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
  if (saved.schema === 2) {
    saved.generation ??= 0;
    for (const company of saved.companies) {
      if (!company.traffic) {
        company.traffic = initialTraffic(company.stock, saved.seed, `g${saved.generation}-upgrade2`, saved.tick);
        company.traffic.initialIssued = saved.status !== 'LOBBY' || saved.tick > 0;
        company.traffic.arrivalRemainder = company.arrivalRemainder;
      }
      company.traffic.legacyMetrics = { active: company.active, queue: company.queue, latency: company.latency, utilization: company.utilization };
      company.active = company.concurrency.run?.requests.filter((request: {result?: unknown}) => !request.result).length ?? 0;
      company.queue = 0; company.latency = 0; company.utilization = 0;
      company.particles = [];
    }
    for (const change of saved.changes) {
      for (const report of change.reports) if (report.suite === 'Carga') report.obsolete = true;
      if ((change.status === 'QA_RUNNING' && change.runningSuite === 'Carga') ||
          (['CTO_PENDING', 'AUTHORIZED', 'DEPLOYING'].includes(change.status) && !change.reports.some((report: {obsolete?: boolean}) => !report.obsolete))) {
        const company = saved.companies[change.companyId];
        company.reserved = Math.max(0, company.reserved - change.reserved);
        change.reserved = 0; change.status = 'QA_PENDING'; delete change.due;
      }
    }
    saved.schema = 3;
  }
  for (const change of saved.changes) if (change.qaLoad) change.qaLoad.company.traffic.scope = 'qa';
  for (const company of [...saved.companies, ...saved.changes.flatMap((change: {qaLoad?: {company: unknown}}) => change.qaLoad ? [change.qaLoad.company] : [])]) {
    company.traffic.paths ??= {};
    for (const request of Object.values(company.traffic.requests) as any[]) {
      if (!Array.isArray(request.path)) {
        const path = company.traffic.paths[request.executionVersion];
        if (!path) throw new Error('La solicitud no conserva su versión de ejecución.');
        request.path = request.type === 'query' ? path.filter((node: {type: string}) => ['entry', 'read', 'exit'].includes(node.type)) : path;
      }
    }
  }
  if (saved.schema === 3) { importLegacyMarket(saved); saved.schema = 4; }
  if (saved.market.config.version !== 'market-3.0') throw new Error('Versión de mercado no soportada.');
  bindMarket(saved); assertMarket(saved);
  if (saved.status === 'RUNNING') saved.status = 'PAUSED';
  return saved as GameState;
}

/** A frozen route is persisted once per release rather than once per request. */
export function serializeGame(game: GameState): string {
  return JSON.stringify(game, function(this: {companyId?: number; executionVersion?: number; phase?: string}, key, value) {
    if (key === 'outbox') return [];
    if (key === 'path' && this.companyId !== undefined && this.phase) return { release: this.executionVersion };
    return value;
  });
}
