import { workflow } from './workflow.js';
import { initialObservability, bindObservability } from './observability.js';
import { initialActionState } from './discipline.js';
import { initialRuntime } from './artifacts.js';
import { syncInfrastructure } from './infrastructure.js';
import { assertMarket, bindMarket, importLegacyMarket } from './market.js';
import { completePlan } from '../shared/plan.js';
import { planServices } from './graphs.js';
import type { GameState } from '../shared/types.js';
import { initialConcurrency } from './scenarios.js';
import { initialTraffic } from './traffic.js';

/** Upgrade only missing simulation state. Never infer historical requests/effects. */
export function recoverGame(serialized: string): GameState {
  const saved = JSON.parse(serialized);
  const originalSchema = saved.schema;
  // Missing mode means a pre-5.5 recorded generation, never a new lightweight room.
  saved.dvrEnabled ??= true;
  if (![1, 2, 3, 4, 5, 6, 7].includes(saved.schema)) throw new Error('Versión de partida no soportada.');
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
  for (const company of [...saved.companies, ...saved.changes.flatMap((change: any) => [change.qaLoad?.company, change.testJob?.staging].filter(Boolean))]) {
    company.runtime ??= initialRuntime(); syncInfrastructure(company);
    // A saved QA fixture carries no schema of its own, and the engine needs a plan to know where a
    // request goes. Before this entrega the service layer was wired in, so that plan is the complete one.
    company.plan ??= completePlan(); company.assembly ??= { active: false, closedAt: saved.tick }; company.planDrafts ??= {};
  }
  for (const change of saved.changes) if (change.testJob?.run) change.testJob.requests = change.testJob.run.requests;
  for (const change of saved.changes) if (change.qaLoad) change.qaLoad.company.traffic.scope = 'qa';
  for (const company of [...saved.companies, ...saved.changes.flatMap((change: {qaLoad?: {company: unknown}}) => [change.qaLoad?.company, (change as any).testJob?.staging].filter(Boolean))]) {
    company.traffic.paths ??= {};
    company.traffic.planPaths ??= {};
    for (const request of Object.values(company.traffic.requests) as any[]) {
      // A request in flight keeps walking the plan of its own version, so that route is restored too.
      company.traffic.planPaths[request.executionVersion] ??= planServices(company.plan);
      if (originalSchema < 5) request.executor ??= 'requests-1';
      if (request.execution?.release !== undefined) { const release = company.runtime.releases[request.executionVersion]; if (!release) throw new Error('Versión de ejecución ausente.'); request.execution = release; }
      if (!Array.isArray(request.path)) {
        const path = company.traffic.paths[request.executionVersion];
        if (!path) throw new Error('La solicitud no conserva su versión de ejecución.');
        request.path = request.type === 'query' ? path.filter((node: {type: string}) => ['entry', 'read', 'exit'].includes(node.type)) : path;
      }
    }
  }
  if(originalSchema<6)for(const change of saved.changes)delete change.implementation;
  if (saved.schema === 3) { importLegacyMarket(saved); saved.schema = 4; }
  if (saved.schema === 4) {
    saved.schema = 5; saved.actions = initialActionState();
    for (const company of saved.companies) for (const request of company.concurrency.run?.requests ?? []) request.executor ??= 'requests-1';
    for (const change of saved.changes) {
      for (const request of change.qaScenario?.requests ?? []) request.executor ??= 'requests-1';
      if (change.graph.nodes.some((n: {type: string}) => ['lock','queue','retry','idempotency','cache','validation'].includes(n.type)) && ['QA_PENDING','QA_RUNNING','CTO_PENDING','AUTHORIZED','DEPLOYING'].includes(change.status)) {
        const company = saved.companies[change.companyId]; company.reserved = Math.max(0,company.reserved-change.reserved); change.reserved=0; change.status='QA_PENDING';
        for (const report of change.reports) report.obsolete=true;
        delete change.qaScenario; delete change.qaLoad; delete change.due;
      }
    }
  }
  if (saved.schema === 5) { saved.schema = 6; saved.observability = initialObservability(saved.tick); saved.slack = { sequence: 0, messages: [], receipts: {}, buckets: {}, groups: {}, automaticCount: 0, sampledCount: 0 }; }
  if (saved.schema === 6) {
    // Before this entrega the service layer was wired into the engine, so every saved company ran
    // the complete plan and was long past a montaje it never had. The loops above already filled
    // both in; this step only records that the save is now a schema 7 one.
    saved.schema = 7;
  }
  for (const company of saved.companies) { company.crisis ??= { active: false, episode: 0, lastReputation: company.reputation }; company.serviceMode ??= { mode: 'OPERATING', since: saved.tick }; }
  if (saved.market.config.version !== 'market-3.0') throw new Error('Versión de mercado no soportada.');
  for (const company of saved.companies) { company.runtime ??= initialRuntime(); syncInfrastructure(company); }
  for(const c of saved.companies){if(!c.runtime.workflow){const ch=saved.changes.find((x:any)=>x.companyId===c.id&&x.implementation&& !['STALE','QA_REJECTED'].includes(x.status));if(ch)workflow(c).backendLock={featureId:'purchase-flow',changeId:ch.id,at:ch.created};}}
  for(const c of saved.companies)for(const a of c.runtime.aiAttempts??[])if(['QUEUED','RUNNING'].includes(a.state)){a.state='INTERRUPTED';a.code='SERVER_RESTART';}
  bindMarket(saved); bindObservability(saved); assertMarket(saved);
  if (saved.status === 'RUNNING') saved.status = 'PAUSED';
  return saved as GameState;
}

/** A frozen route is persisted once per release rather than once per request. */
export function serializeGame(game: GameState): string {
  return JSON.stringify(game, function(this: {companyId?: number; executionVersion?: number; phase?: string; scenario?: unknown; run?: unknown}, key, value) {
    if (key === 'outbox') return [];
    if (key === 'requests' && this.scenario && this.run) return undefined;
    if (key === 'execution' && this.companyId !== undefined && this.phase) return { release: this.executionVersion };
    if (key === 'path' && this.companyId !== undefined && this.phase) return { release: this.executionVersion };
    return value;
  });
}
