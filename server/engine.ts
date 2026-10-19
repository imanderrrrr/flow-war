import { businessCommand, advanceCampaigns } from './business.js';
import { blockConfiguration } from './blocks.js';
import { createTestJob, advanceTestJob, testReport, scenarioForSuite } from './qa.js';
import { testScenario } from './action-validation.js';
import { initialRuntime, executionFor, releaseFor, prepareArtifact } from './artifacts.js';
import { initialInfrastructure, syncInfrastructure, advanceInfrastructure, restart, setService } from './infrastructure.js';
import { parseAction, validateParameters } from './action-validation.js';
import { allowedAction } from '../shared/actions.js';
import { advanceMarket, assertMarket, bindMarket, createMarket, evacuateEliminated, flushMigrations } from './market.js';
import { advanceLoadRun, createLoadRun, loadReport, runLoadFixture } from './load.js';
import { initialTraffic, issueInitialTraffic, generateTraffic, serviceRates, advanceTraffic, restockTraffic, cancelTraffic, trafficParticles, trafficView } from './traffic.js';
import { advanceConcurrency, cancelConcurrency, concurrencyParticles, concurrencyReport, createConcurrencyRun, isRunFinished, runConcurrencyFixture } from './requests.js';
import { initialConcurrency, productionContext, settleConcurrency, stepConcurrency } from './scenarios.js';
import { route, evaluateSecurity } from './graphs.js';
export { route, evaluateSecurity } from './graphs.js';
import { BLOCKS, SUITES, type Company, type GameState, type Graph, type Identity, type Command, type Result, type Snapshot, type Change, type Report } from '../shared/types.js';

const NAMES = ['NOVA', 'VERTEX', 'BYTE', 'EMBER', 'ORBIT'];
const COLORS = ['#f5d45c', '#68dca2', '#69adff', '#f27e79', '#b69af7'];
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export function initialGraph(domain: 'backend' | 'security' | 'product'): Graph {
  const types = domain === 'backend' ? ['entry', 'read', 'write', 'payment', 'exit'] : ['entry', 'exit'];
  const labels: Record<string, string> = { entry: 'Request IN', read: 'Read Stock', write: 'Write Stock', payment: 'Payment', exit: 'Response OUT' };
  return { nodes: types.map((type, i) => ({ id: `${domain}-${type}`, type, position: { x: i * 190, y: 160 }, data: { label: labels[type] } })), edges: types.slice(1).map((type, i) => ({ id: `${domain}-e${i}`, source: `${domain}-${types[i]}`, target: `${domain}-${type}` })) };
}
export function createGame(duration = 1500, seed = 7357, generation = 0): GameState {
  const companies: Company[] = NAMES.map((name, id) => ({
    runtime: initialRuntime(), infrastructure: initialInfrastructure(), id, name, tag: `EMPRESA 0${id + 1}`, color: COLORS[id], customers: 1000, capital: 10000, reputation: 80, pressure: 0,
    servers: 1, balancer: false, infraBudget: duration * .5, reserved: 0, version: 1, deployments: 0, active: 0, requests: 0, successes: 0, errors: 0, breaches: 0, oversold: 0, duplicates: 0,
    lostRevenue: 0, revenue: 0, latency: 0, utilization: 0, queue: 0, migratedIn: 0, migratedOut: 0, eliminated: false, crisisTicks: 0, deadTicks: 0, bankruptTicks: 0, concurrencyUntil: 0,
    backend: initialGraph('backend'), security: initialGraph('security'), product: initialGraph('product'), particles: [], drafts: {}, migrationRemainder: 0, arrivalRemainder: 0, processedRemainder: 0, history: Array(24).fill(20), stock: 100, concurrency: initialConcurrency(duration), traffic: initialTraffic(100, seed, `g${generation}`),
  }));
  const game: GameState = { schema: 4, market: createMarket(companies, generation), generation, tick: 0, duration, status: 'LOBBY', seed, eventSeq: 0, companies, changes: [], events: [{ id: 0, at: 0, companyId: null, text: 'Cinco empresas conectadas al mercado.', tone: 'neutral', category: 'SISTEMA' }], migrations: [], unserved: 0, speed: 1 };
  bindMarket(game); assertMarket(game); return game;
}
export function event(g: GameState, companyId: number | null, text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral', category = 'SISTEMA') {
  g.events.unshift({ id: ++g.eventSeq, at: g.tick, companyId, text, tone, category });
  g.events.length = Math.min(g.events.length, 60);
}
export function validateGraph(input: unknown, domain: 'backend' | 'security' | 'product', complete = true): Graph {
  if (!input || typeof input !== 'object') throw new Error('Grafo inválido.');
  const graph = structuredClone(input) as Graph;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length > 25 || graph.edges.length > 30) throw new Error('Máximo 20 piezas y 30 conexiones.');
  const catalog = domain === 'product' ? [] : BLOCKS[domain];
  const allowed = new Set(['entry', 'exit', ...(domain === 'backend' ? ['read', 'write', 'payment', 'module'] : []), ...catalog.map(b => b.type)]);
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (typeof n.id !== 'string' || n.id.length > 100 || ids.has(n.id) || !allowed.has(n.type) || !n.position || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y)) throw new Error('Nodo inválido.');
    ids.add(n.id);
    const block = catalog.find(b => b.type === n.type);
    if (n.type === 'atomic' && (!Number.isInteger(Number(n.data?.value ?? block!.value)) || Number(n.data?.value ?? block!.value) < 1 || Number(n.data?.value ?? block!.value) > 120)) throw new Error('Atomic Update requiere una cantidad entera entre 1 y 120.');
    const config = blockConfiguration(n);
    const moduleRef = n.data?.module;
    n.data = { ...(n.data?.config && config ? { config } : {}), ...(n.type === 'module' ? { module: moduleRef } : {}), label: block?.label ?? ({ entry: 'Request IN', exit: 'Response OUT', read: 'Read Stock', write: 'Write Stock', payment: 'Payment' }[n.type] ?? n.type), ...(block ? { value: clamp(Number(n.data?.value ?? block.value) || block.value, 1, n.type === 'lock' ? 5000 : 120) } : {}) };
  }
  for (const type of ['entry', 'exit', ...(domain === 'backend' ? ['read', 'write', 'payment'] : [])]) if (graph.nodes.filter(n => n.type === type).length !== 1) throw new Error(`El grafo requiere un módulo ${type}.`);
  const out = new Set<string>(), edgeIds = new Set<string>();
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || out.has(e.source) || typeof e.id !== 'string' || edgeIds.has(e.id)) throw new Error('Puertos o conexiones incompatibles.');
    if (graph.nodes.find(n => n.id === e.source)?.type === 'exit' || graph.nodes.find(n => n.id === e.target)?.type === 'entry') throw new Error('Dirección de conexión inválida.');
    out.add(e.source); edgeIds.add(e.id);
  }
  for (const n of graph.nodes) {
    let id: string | undefined = n.id; const seen = new Set<string>();
    while (id) { if (seen.has(id)) throw new Error('Ciclo no soportado.'); seen.add(id); id = graph.edges.find(e => e.source === id)?.target; }
  }
  const path = route(graph);
  if (complete && path.at(-1)?.type !== 'exit') throw new Error('No existe una ruta de entrada a salida.');
  if (complete && domain === 'backend' && !['read', 'write', 'payment'].every(t => path.some(n => n.type === t))) throw new Error('La ruta debe atravesar inventario y pagos.');
  return graph;
}
export function inventoryBatch(graph: Graph, demand: number, stock: number): { completed: number; oversold: number; duplicates: number; remaining: number } {
  const p = route(graph).map(n => n.type), write = p.indexOf('write'), payment = p.indexOf('payment');
  const atomic = p.indexOf('atomic') >= 0 && p.indexOf('atomic') < write;
  const locked = p.indexOf('lock') >= 0 && p.indexOf('lock') < p.indexOf('read');
  const idempotent = p.indexOf('idempotency') >= 0 && p.indexOf('idempotency') < payment;
  const retries = p.indexOf('retry') >= 0 && p.indexOf('retry') < payment;
  const completed = atomic || locked ? Math.min(demand, Math.max(0, stock)) : stock > 0 ? demand : 0;
  return { completed, oversold: Math.max(0, completed - stock), duplicates: retries && !idempotent ? Math.floor(completed * .08) : 0, remaining: Math.max(0, stock - completed) };
}
export function reportFor(g: GameState, change: Change, suite: string): Report {
  const company = g.companies[change.companyId];
  if (suite === 'Concurrencia') return concurrencyReport(runConcurrencyFixture(change.context ?? { backend: change.domain === 'backend' ? change.graph : company.backend, security: change.domain === 'security' ? change.graph : company.security, executionVersion: change.baseVersion }), g.tick);
  if (suite === 'Carga') return runLoadFixture(company, change.context ?? productionContext(company), g.tick);
  const backend = change.domain === 'backend' ? change.graph : company.backend;
  const security = change.domain === 'security' ? change.graph : company.security;
  const load = 100;
  const valid = Array.from({ length: load }, (_, i) => evaluateSecurity(security, 'valid', i)).filter(Boolean).length;
  const batches = suite === 'Integración' ? inventoryBatch(backend, valid, 20) : inventoryBatch(backend, valid, load);
  let breaches = 0;
  if (suite === 'Seguridad' || suite === 'Integración') for (let i = 0; i < 60; i++) if (evaluateSecurity(security, (['forged', 'injection', 'bot'] as const)[i % 3], i)) breaches++;
  return { suite, requests: load, completed: batches.completed, rejected: load - batches.completed, oversold: batches.oversold, breaches, duplicates: batches.duplicates, latency: Math.round(180 + route(backend).length * 12), tick: g.tick };
}
function releaseReservation(c: Company, change: Change) { c.reserved = Math.max(0, c.reserved - change.reserved); change.reserved = 0; }
export function applyCommand(g: GameState, identity: Identity | null, command: Command): Result {
  bindMarket(g);
  if (command.type === 'action.execute') {
    try { const action = parseAction(command.payload?.action); return applyCommand(g, identity, { id: action.id, type: action.type, companyId: action.companyId, changeId: action.changeId, payload: action.parameters }); }
    catch (e) { return { ok: false, code: 'INVALID', error: (e as Error).message }; }
  }
  if (!identity || !allowedAction(command.type, identity.role)) return { ok: false, code: 'FORBIDDEN', error: 'Acción no autorizada para este rol.' };
  if (identity.role === 'operator') {
    if (command.type === 'room.reset') { const duration = Number(command.payload?.duration) === 1200 ? 1200 : 1500; finishRequests(g); const receipts = g.companies.map(company => company.traffic.outbox); Object.assign(g, createGame(duration, 7357, g.generation + 1)); for (const company of g.companies) company.traffic.outbox = receipts[company.id]; return { ok: true }; }
    if (command.type === 'room.start') { if (g.status === 'FINISHED') return { ok: false, error: 'La partida ha finalizado.' }; if (g.status === 'LOBBY') for (const company of g.companies) issueInitialTraffic(company, g.tick); g.status = 'RUNNING'; event(g, null, 'SIMULACIÓN EN CURSO', 'good'); }
    if (command.type === 'room.pause' && g.status === 'RUNNING') { g.status = 'PAUSED'; event(g, null, 'Simulación pausada.'); }
    if (command.type === 'room.finish') { finishRequests(g); g.status = 'FINISHED'; event(g, null, 'PARTIDA FINALIZADA'); }
    if (command.type === 'room.speed') g.speed = [1, 5, 20].includes(Number(command.payload?.speed)) ? Number(command.payload?.speed) : 1;
    return { ok: true };
  }
  if (g.status !== 'RUNNING') return { ok: false, code: 'ROOM_PAUSED', error: 'La simulación no está en curso.' };
  if (command.companyId !== identity.companyId) return { ok: false, code: 'FORBIDDEN', error: 'Empresa no autorizada.' };
  const c = g.companies[identity.companyId!];
  if (c.eliminated) return { ok: false, error: 'La empresa está fuera de la partida.' };
  const ch = g.changes.find(x => x.id === (command.changeId ?? command.payload?.changeId) && x.companyId === c.id);
  const p = command.payload ?? {};
  try {
    if (command.type.startsWith('campaign.') || command.type === 'product.propose') { const result = businessCommand(g, c, identity, command.type, p); event(g, c.id, command.type === 'campaign.activate' ? 'Campaña activada.' : 'Operación comercial registrada.', 'neutral', 'PRODUCTO'); return result; }
    if (['module.create','module.revise','security.prepare'].includes(command.type)) {
      const change = prepareArtifact(g, c, identity, command.type, p); event(g, c.id, `${change.id} preparado. Pendiente de pruebas QA.`, 'neutral', 'PIPELINE'); return { ok: true, refs: [change.id, ...(change.artifactRefs?.map(ref => `${ref.id}@${ref.version}`) ?? [])] };
    }
    if (['infra.restart','infra.restart_all','infra.stop','infra.recover'].includes(command.type)) {
      validateParameters(command.type, p);
      if (command.type.startsWith('infra.restart')) restart(c, g.tick, Number(p.duration), command.type === 'infra.restart' ? Number(p.serverId) : undefined);
      else setService(c, p.service as import('../shared/types.js').ServiceId, command.type === 'infra.stop');
      event(g, c.id, command.type.startsWith('infra.restart') ? 'Reinicio iniciado.' : command.type === 'infra.stop' ? 'Servicio detenido.' : 'Servicio recuperado.', 'neutral', 'DEVOPS'); return { ok: true };
    }
    if (command.type === 'draft.save' || command.type === 'change.submit') {
      const domain = identity.role as 'backend' | 'security';
      const current = c.drafts[domain]?.revision ?? 0;
      if (Number(p.revision) !== current) throw new Error('La revisión cambió. Recarga el borrador.');
      const graph = validateGraph(p.graph, domain, command.type === 'change.submit');
      const execution = releaseFor(c, domain === 'backend' ? graph : c.backend);
      c.drafts[domain] = { graph, revision: current + 1 };
      if (command.type === 'change.submit') {
        const cost = 100 + graph.nodes.reduce((sum, n) => sum + (BLOCKS[domain].find(b => b.type === n.type)?.cost ?? 0), 0);
        const change: Change = { id: `CH-${String(g.changes.length + 1).padStart(3, '0')}`, companyId: c.id, domain, name: `${domain === 'backend' ? 'Lógica' : 'Seguridad'} · revisión ${current + 1}`, graph: structuredClone(graph), status: 'QA_PENDING', cost, reserved: 0, baseVersion: c.version, created: g.tick, reports: [], actorId: identity.id, context: { backend: structuredClone(domain === 'backend' ? graph : c.backend), security: structuredClone(domain === 'security' ? graph : c.security), executionVersion: c.version, execution } };
        g.changes.unshift(change); event(g, c.id, `${change.id} enviado a QA.`, 'neutral', 'PIPELINE');
      }
      return { ok: true };
    }
    if (command.type === 'cto.budget') {
      const amount = Number(p.amount);
      if (![250, 500, 1000].includes(amount) || c.capital - c.reserved - c.infraBudget < amount) throw new Error('Saldo disponible insuficiente.');
      c.infraBudget += amount; event(g, c.id, `Q${amount} de operación autorizados.`, 'neutral', 'CTO'); return { ok: true };
    }
    if (command.type === 'cto.prioritize') { validateParameters(command.type, p); c.runtime.priority = p.incident as 'security' | 'concurrency'; event(g, c.id, `Prioridad: ${p.incident === 'security' ? 'seguridad' : 'concurrencia'}.`, 'neutral', 'CTO'); return { ok: true }; }
    if (command.type === 'infra.scale') {
      const delta = Number(p.delta); if (delta !== 1 && delta !== -1) throw new Error('Operación inválida.');
      if (c.servers + delta < 1 || c.servers + delta > 8) throw new Error('Rango de servidores: 1–8.');
      if (delta > 0 && c.infraBudget < (c.servers + 1) * 30) throw new Error('Presupuesto operativo insuficiente.');
      c.servers += delta; syncInfrastructure(c); event(g, c.id, `${delta > 0 ? '+1' : '-1'} SERVER · ${c.servers} en servicio.`, 'neutral', 'DEVOPS'); return { ok: true };
    }
    if (command.type === 'infra.balancer') { c.balancer = Boolean(p.enabled); event(g, c.id, `Balanceador ${c.balancer ? 'activo' : 'desactivado'}.`, 'neutral', 'DEVOPS'); return { ok: true }; }
    if (!ch) throw new Error('Cambio no encontrado.');
    if (ch.baseVersion !== c.version && !['DEPLOYED', 'QA_REJECTED', 'CTO_REJECTED'].includes(ch.status)) throw new Error('La versión base cambió.');
    if (command.type === 'qa.execute') {
      validateParameters(command.type, p);
      if (ch.status !== 'QA_PENDING') throw new Error('QA requiere un cambio pendiente.');
      const job = createTestJob(c, ch, testScenario(p.scenario));
      ch.testJob = job; ch.status = 'QA_RUNNING'; ch.runningSuite = job.scenario.suite; return { ok: true };
    }
    if (command.type === 'qa.run') {
      if (ch.status !== 'QA_PENDING' || !SUITES.includes(String(p.suite))) throw new Error('No se puede ejecutar esa suite en este estado.');
      if (ch.context?.execution?.modules.length || ch.context?.execution?.security || p.suite === 'Unitarias') {
        ch.testJob = createTestJob(c, ch, scenarioForSuite(String(p.suite))); ch.status = 'QA_RUNNING'; ch.runningSuite = String(p.suite); return { ok: true };
      }
      ch.status = 'QA_RUNNING'; ch.runningSuite = String(p.suite); ch.due = g.tick + 4;
      if (p.suite === 'Carga') ch.qaLoad = createLoadRun(c, ch.context ?? productionContext(c), g.tick);
      if (p.suite === 'Concurrencia') ch.qaScenario = createConcurrencyRun(`${ch.id}-QA${ch.reports.length + 1}`, ch.context ?? productionContext(c), g.tick);
    } else if (command.type === 'qa.approve') {
      if (ch.status !== 'QA_PENDING' || !ch.reports.some(report => !report.obsolete)) throw new Error('Se requiere una prueba terminada.');
      ch.status = 'CTO_PENDING'; event(g, c.id, `${ch.id} aprobado por QA.`, 'neutral', 'PIPELINE');
    } else if (command.type === 'qa.reject') {
      if (ch.status !== 'QA_PENDING') throw new Error('Estado de cambio inválido.'); ch.status = 'QA_REJECTED';
    } else if (command.type === 'cto.authorize') {
      if (ch.status !== 'CTO_PENDING') throw new Error('Falta aprobación de QA.');
      if (c.capital - c.reserved - c.infraBudget < ch.cost) throw new Error('Saldo disponible insuficiente.');
      c.reserved += ch.cost; ch.reserved = ch.cost; ch.status = 'AUTHORIZED'; ch.expires = g.tick + 60;
      event(g, c.id, `${ch.id} autorizado · Q${ch.cost}.`, 'neutral', 'CTO');
    } else if (command.type === 'cto.reject') {
      if (ch.status !== 'CTO_PENDING') throw new Error('Estado de cambio inválido.'); ch.status = 'CTO_REJECTED';
    } else if (command.type === 'deploy.start') {
      if (ch.status !== 'AUTHORIZED' || g.tick > (ch.expires ?? 0)) throw new Error('No existe autorización vigente.');
      if (g.changes.some(x => x.companyId === c.id && x.status === 'DEPLOYING')) throw new Error('Ya existe un despliegue activo.');
      if (!['rolling', 'restart'].includes(String(p.strategy))) throw new Error('Estrategia no disponible.');
      ch.status = 'DEPLOYING'; ch.strategy = String(p.strategy); ch.due = g.tick + (p.strategy === 'rolling' ? 6 : 3);
      event(g, c.id, `${ch.id} · DEPLOY INICIADO`, 'neutral', 'DEVOPS');
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Comando inválido.' }; }
}
function jobs(g: GameState) {
  const qaSlots = new Set<number>();
  const ordered = [...g.changes].sort((a,b) => {
    const rank = (ch: Change) => (g.companies[ch.companyId].runtime.priority === 'security' ? ch.domain === 'security' : ch.domain === 'backend') ? 0 : 1;
    return rank(a) - rank(b) || a.created - b.created || a.id.localeCompare(b.id);
  });
  for (const ch of ordered) {
    const c = g.companies[ch.companyId];
    if (ch.status === 'AUTHORIZED' && g.tick > (ch.expires ?? Infinity)) { ch.status = 'EXPIRED'; releaseReservation(c, ch); }
    if (ch.status === 'QA_RUNNING' && !qaSlots.has(c.id)) {
      qaSlots.add(c.id);
      if (ch.qaScenario) advanceConcurrency(ch.qaScenario, g.tick);
      const completed = ch.testJob ? advanceTestJob(ch.testJob) : ch.qaLoad ? advanceLoadRun(ch.qaLoad) : ch.qaScenario ? isRunFinished(ch.qaScenario) : g.tick >= (ch.due ?? Infinity);
      if (completed) {
        ch.reports.push(ch.testJob ? testReport(ch.testJob, g.tick) : ch.qaLoad ? loadReport(ch.qaLoad, g.tick) : ch.qaScenario ? concurrencyReport(ch.qaScenario, g.tick) : reportFor(g, ch, ch.runningSuite!));
        delete ch.qaScenario; delete ch.qaLoad; delete ch.testJob;
        ch.status = 'QA_PENDING';
        event(g, c.id, `${ch.id} · ${ch.runningSuite} completada.`, 'neutral', 'QA');
      }
    }
    if (ch.status === 'DEPLOYING' && g.tick >= (ch.due ?? Infinity)) {
      c[ch.domain] = structuredClone(ch.graph); c.version++; c.runtime.releases[c.version] = structuredClone(ch.context?.execution ?? releaseFor(c)); c.deployments++; c.capital -= ch.cost; releaseReservation(c, ch); ch.status = 'DEPLOYED';
      event(g, c.id, `${ch.id} EN PRODUCCIÓN · v${c.version}`, 'good', 'DEPLOY');
      for (const other of g.changes) if (other.companyId === c.id && other.id !== ch.id && ['QA_PENDING', 'QA_RUNNING', 'CTO_PENDING', 'AUTHORIZED', 'EXPIRED'].includes(other.status)) { other.status = 'STALE'; releaseReservation(c, other); }
    }
  }
}
export function step(g: GameState, dt = .1) {
  if (g.status !== 'RUNNING') return;
  bindMarket(g);
  if (dt > .1) { for (let remaining = dt; remaining > .00001; remaining = Math.round((remaining - .1) * 1e6) / 1e6) step(g, Math.min(.1, remaining)); return; }
  const previousSecond = Math.floor(g.tick);
  g.tick = Math.min(g.duration, Math.round((g.tick + dt) * 1000) / 1000);
  jobs(g);
  const second = Math.floor(g.tick) !== previousSecond;
  const securityIncident = g.tick >= g.duration * .12;
  const concurrencyIncident = g.tick >= g.duration * .24;
  if (g.tick - dt < g.duration * .12 && securityIncident) event(g, null, 'Tráfico anómalo detectado en las cinco empresas.', 'bad', 'SECURITY');
  if (g.tick - dt < g.duration * .24 && concurrencyIncident) event(g, null, 'Ráfagas de compra sobre inventario compartido.', 'bad', 'CONCURRENCIA');
  for (const c of g.companies) {
    if (c.eliminated) continue;
    advanceInfrastructure(c, g.tick); advanceCampaigns(c, g.tick);
    const deploying = g.changes.find(ch => ch.companyId === c.id && ch.status === 'DEPLOYING');
    const rates = serviceRates(c, deploying);
    const capacity = rates.web;
    generateTraffic(c, g.tick, dt, g.duration);
    if (second) restockTraffic(c);
    const breachesBefore = c.breaches;
    advanceTraffic(c, g.tick, rates);
    if (c.breaches > breachesBefore && second && previousSecond % 12 === 0) event(g, c.id, `${c.breaches - breachesBefore} accesos indebidos · SECURITY BREACH`, 'bad', 'SECURITY');
    const scenario = stepConcurrency(c, g.tick, capacity > 0);
    if (scenario.started) event(g, c.id, 'SKU LAST-UNIT · 2 compras / 1 unidad.', 'neutral', 'CONCURRENCIA');
    if (scenario.oversold) c.concurrencyUntil = g.tick + 20;
    if (scenario.finished) {
      const report = concurrencyReport(c.concurrency.run!, g.tick);
      event(g, c.id, `LAST-UNIT · ${report.completed} completadas / ${report.rejected} rechazadas / ${report.abandoned} abandonadas / ${report.oversold} sobreventas.`, report.oversold ? 'bad' : 'neutral', 'CONCURRENCIA');
    }
    c.active += c.concurrency.run?.requests.filter(request => !request.result).length ?? 0;
    if (second && previousSecond % 10 === 0) { c.history.push(c.customers / 50); c.history = c.history.slice(-24); }
    const concurrencyRisk = g.tick < c.concurrencyUntil ? .45 : 0;
    const observed = c.traffic.metrics, errorFraction = observed.errorRate;
    const fraud = observed.fraudRate;
    const quality = c.traffic.config.quality;
    const health = observed.legitimateTerminated > 0 && errorFraction < .02 && fraud === 0 && c.latency < quality.healthyLatencyMs && c.utilization < .9 && !concurrencyRisk && capacity > 0 ? 1 : 0;
    c.pressure = clamp(c.pressure + dt * (.8 * errorFraction + .4 * clamp((c.latency - quality.healthyLatencyMs) / (quality.latencyCeilingMs - quality.healthyLatencyMs), 0, 1) + .5 * clamp(c.utilization - 1, 0, 1) + 1.2 * fraud + .2 * observed.unavailable + concurrencyRisk - .35 * health - .002 * c.pressure), 0, 300);
    c.reputation = clamp(c.reputation + dt * (.04 * health - .15 * errorFraction - .30 * fraud - .1 * observed.unavailable - .06 * concurrencyRisk), 0, 100);
    const operation = Math.min(c.infraBudget, c.servers * .5 * dt); c.infraBudget -= operation; c.capital -= operation;
    for (const ch of g.changes) if (ch.companyId === c.id && ch.status === 'AUTHORIZED' && c.capital < c.reserved + c.infraBudget) { releaseReservation(c, ch); ch.status = 'EXPIRED'; }
    if (c.capital < c.reserved + c.infraBudget) c.infraBudget = Math.max(0, c.capital - c.reserved);
    c.particles = c.particles.filter(p => g.tick - p.born < p.duration).slice(-90);
    c.deadTicks = capacity === 0 ? c.deadTicks + dt : 0;
    c.bankruptTicks = c.capital <= 0 ? c.bankruptTicks + dt : 0;
    c.crisisTicks = c.customers < 50 && c.pressure >= 200 && !health ? c.crisisTicks + dt : 0;
  }
  advanceMarket(g);
  const removed = g.companies.filter(c => !c.eliminated && (c.deadTicks >= 90 || c.crisisTicks >= 30 || c.bankruptTicks >= 30));
  for (const c of removed) { cancelTraffic(c, g.tick, 'COMPANY_ELIMINATED'); if (c.concurrency.run) { cancelConcurrency(c.concurrency.run, g.tick, 'COMPANY_ELIMINATED'); settleConcurrency(c); } c.eliminated = true; advanceCampaigns(c, g.tick); c.eliminatedAt = g.tick; c.active = 0; c.particles = []; event(g, c.id, 'EMPRESA FUERA DEL MERCADO', 'bad', 'COLAPSO'); }
  if (removed.length) {
    evacuateEliminated(g);
    for (const c of removed) {
      for (const ch of g.changes.filter(ch => ch.companyId === c.id && !['DEPLOYED', 'QA_REJECTED', 'CTO_REJECTED'].includes(ch.status))) { releaseReservation(c, ch); ch.status = 'STALE'; delete ch.qaLoad; delete ch.qaScenario; delete ch.due; }
      c.infraBudget = 0;
    }
  }
  if (g.tick >= g.duration || g.companies.every(c => c.eliminated)) { finishRequests(g); g.status = 'FINISHED'; event(g, null, 'PARTIDA FINALIZADA', 'neutral', 'SISTEMA'); }
  g.migrations = g.migrations.filter(m => g.tick - m.at < 20).slice(-30);
}
function finishRequests(g: GameState) {
  for (const company of g.companies) {
    cancelTraffic(company, g.tick, 'ROOM_FINISHED');
    if (company.concurrency.run) { cancelConcurrency(company.concurrency.run, g.tick, 'ROOM_FINISHED'); settleConcurrency(company); }
  }
  flushMigrations(g); assertMarket(g);
}
export function project(g: GameState, identity: Identity | null): Snapshot {
  bindMarket(g);
  const ownCompany = identity?.companyId != null ? g.companies[identity.companyId] : undefined;
  const { runtime: _runtime, ...ownVisible } = ownCompany ?? {} as Company;
  const privateC = ownCompany ? structuredClone({ ...ownVisible, particles: trafficParticles(ownCompany, g.tick), traffic: trafficView(ownCompany.traffic) }) : undefined;
  if (privateC) {
    for (const request of privateC.concurrency.run?.requests ?? []) { delete request.execution; delete request.effectCodes; }
    const ownDraft = identity?.role === 'backend' || identity?.role === 'security' ? identity.role : null;
    privateC.drafts = ownDraft && privateC.drafts[ownDraft] ? { [ownDraft]: privateC.drafts[ownDraft] } : {};
  }
  return {
    tick: g.tick, duration: g.duration, status: g.status, speed: g.speed, identity,
    companies: g.companies.map(c => {
      const { runtime, drafts, backend, security, product, migrationRemainder, arrivalRemainder, processedRemainder, crisisTicks, deadTicks, bankruptTicks, concurrencyUntil, concurrency, traffic, ...pub } = c;
      return { ...pub, traffic: trafficView(traffic), concurrency: { runId: concurrency.run?.id, inventory: concurrency.run && { ...concurrency.run.inventory }, totals: { ...concurrency.totals } }, particles: [...trafficParticles(c, g.tick), ...concurrencyParticles(concurrency.run, c.color, g.tick, c)], modules: [...route(backend), ...route(security)].map(n => n.type), pipelineCounts: [['QA_PENDING', 'QA_RUNNING'], ['CTO_PENDING'], ['AUTHORIZED', 'DEPLOYING'], ['DEPLOYED']].map(states => g.changes.filter(ch => ch.companyId === c.id && states.includes(ch.status)).length) };
    }),
    events: g.events, migrations: g.migrations, unserved: g.unserved, privateCompany: privateC,
    changes: (identity?.role === 'operator' ? g.changes : g.changes.filter(ch => ch.companyId === identity?.companyId)).map(({ qaLoad, qaScenario, testJob, context, ...change }) => ({ ...change, ...(context ? { context: { backend: context.backend, security: context.security, executionVersion: context.executionVersion } } : {}) })),
  };
}
