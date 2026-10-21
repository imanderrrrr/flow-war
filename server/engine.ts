import { assertBackendEditable, workflowCommand, startQa, completeQa, workflowView, expireInvestments, settleInvestment, workflow } from './workflow.js';
import { beginSecurityReview, bindLegacySecurity, securityCommand, assertBundle, collaborationView, proposalCommand } from './collaboration.js';
import { visibleRequest } from './projections.js';
import { setMaintenance, MAINTENANCE_POLICY } from './maintenance.js';
import { postChat } from './chat.js';
import { slackFact, sampleTelemetry } from './flowslack.js';
import { updateCrisis } from './crisis.js';
import { serializeGame } from './persistence.js';
import { initialObservability, bindObservability, observe, observeCompany, recordInput, checkpoint, sampleHistory, clearBuffer, buffer, copyHistoryBuffer, projectHistoryPoint, capturingHistory } from './observability.js';
import { runLocalAgent } from './agents.js';
import { initialActionState, dispatchCommand, correctEmployee, auditCompletion } from './discipline.js';
import { businessCommand, advanceCampaigns } from './business.js';
import { blockConfiguration } from './blocks.js';
import { createTestJob, advanceTestJob, testReport, scenarioForSuite } from './qa.js';
import { testScenario } from './action-validation.js';
import { initialRuntime, executionFor, releaseFor, prepareArtifact } from './artifacts.js';
import { initialInfrastructure, syncInfrastructure, advanceInfrastructure, restart, setService } from './infrastructure.js';
import { initialOperationsState, operationsCommand, assertScope, activeDeployment, advanceOperations, reconcileRollbacks, closeOperations, recordRelease, rollbackInProgress, infraView } from './operations.js';
import { RESTART_SECONDS } from './executor.js';
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
export function createGame(duration = 1500, seed = 7357, generation = 0, dvrEnabled = true): GameState {
  const companies: Company[] = NAMES.map((name, id) => ({
    crisis: { active: false, episode: 0, lastReputation: 80 }, serviceMode: { mode: 'OPERATING', since: 0 }, runtime: initialRuntime(), infrastructure: initialInfrastructure(), id, name, tag: `EMPRESA 0${id + 1}`, color: COLORS[id], customers: 1000, capital: 10000, reputation: 80, pressure: 0,
    servers: 1, balancer: false, infraBudget: duration * .5, reserved: 0, version: 1, deployments: 0, active: 0, requests: 0, successes: 0, errors: 0, breaches: 0, oversold: 0, duplicates: 0,
    lostRevenue: 0, revenue: 0, latency: 0, utilization: 0, queue: 0, migratedIn: 0, migratedOut: 0, eliminated: false, crisisTicks: 0, deadTicks: 0, bankruptTicks: 0, concurrencyUntil: 0,
    backend: initialGraph('backend'), security: initialGraph('security'), product: initialGraph('product'), particles: [], drafts: {}, migrationRemainder: 0, arrivalRemainder: 0, processedRemainder: 0, history: Array(24).fill(20), stock: 100, concurrency: initialConcurrency(duration), traffic: initialTraffic(100, seed, `g${generation}`),
  }));
  const game: GameState = { dvrEnabled, actions: initialActionState(), schema: 6, observability: initialObservability(), slack: { sequence: 0, messages: [], receipts: {}, buckets: {}, groups: {}, automaticCount: 0, sampledCount: 0 }, market: createMarket(companies, generation), generation, tick: 0, duration, status: 'LOBBY', seed, eventSeq: 0, companies, changes: [], events: [{ id: 0, at: 0, companyId: null, text: 'Cinco empresas conectadas al mercado.', tone: 'neutral', category: 'SISTEMA' }], migrations: [], unserved: 0, speed: 1 };
  for (const company of companies) company.runtime.infra = initialOperationsState(company, duration);
  bindMarket(game); bindObservability(game, f=>slackFact(game,f)); assertMarket(game); checkpoint(game, serializeGame, true); return game;
}
export function event(g: GameState, companyId: number | null, text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral', category = 'SISTEMA') {
  observe(g, category.toLowerCase(), companyId, { text, tone });
  g.events.unshift({ id: ++g.eventSeq, at: g.tick, companyId, text, tone, category });
  g.events.length = Math.min(g.events.length, 60);
}
export function validateGraph(input: unknown, domain: 'backend' | 'security' | 'product', complete = true): Graph {
  if (!input || typeof input !== 'object') throw new Error('Grafo inválido.');
  const graph = structuredClone(input) as Graph;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length > 25 || graph.edges.length > 30) throw new Error('Máximo 25 piezas y 30 conexiones.');
  const catalog = domain === 'product' ? [] : BLOCKS[domain];
  const allowed = new Set(['entry', 'exit', ...(domain === 'backend' ? ['read', 'write', 'payment', 'module'] : []), ...catalog.map(b => b.type)]);
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (typeof n.id !== 'string' || !n.id.trim() || n.id.length > 100 || ids.has(n.id) || !allowed.has(n.type) || !n.position || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y)) throw new Error('Nodo inválido.');
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
  if (complete && path.length !== graph.nodes.length) throw new Error('Todos los bloques deben estar conectados en la ruta ejecutable.');
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
  const job = createTestJob(company, change, scenarioForSuite(suite));
  while (!advanceTestJob(job)) { /* Bounded at 500 requests and 6 attempts. */ }
  return testReport(job, g.tick);
}
function releaseReservation(c: Company, change: Change) { c.reserved = Math.max(0, c.reserved - change.reserved); change.reserved = 0; }
/** A new production version invalidates pending work built on the previous base (conservative MVP rule). */
function staleOthers(g: GameState, c: Company, keep?: Change) { for (const other of g.changes) if (other.companyId === c.id && other.id !== keep?.id && ['QA_PENDING', 'QA_RUNNING', 'CTO_PENDING', 'AUTHORIZED', 'EXPIRED'].includes(other.status)) { other.status = 'STALE'; releaseReservation(c, other); } }
export function applyCommand(g: GameState, identity: Identity | null, command: Command, context: { receivedAt?: number } = {}): Result {
  if (command.type === 'agent.fixture') return runLocalAgent(g, identity, command.payload, effective => applyCommand(g, identity, effective));
  const receivedAt = context.receivedAt ?? Date.now();
  bindObservability(g,f=>slackFact(g,f));
  const result = command.type === 'chat.send' ? postChat(g,identity,command,receivedAt) : dispatchCommand(g, identity, command, effective => executeCommand(g, identity!, effective, receivedAt));
  if (identity) {
    recordInput(g, { identity, command, receivedAt });
    sampleHistory(g);
    if (command.type === 'room.reset' || command.type === 'room.finish') checkpoint(g, serializeGame, true);
  }
  return result;
}
function executeCommand(g: GameState, identity: Identity, command: Command, receivedAt: number): Result {
  bindMarket(g);
  if (!identity || !allowedAction(command.type, identity.role)) return { ok: false, code: 'FORBIDDEN', error: 'Acción no autorizada para este rol.' };
  if (identity.role === 'operator') {
    if (command.type === 'employee.correct') return correctEmployee(g, command.payload ?? {});
    if (command.type === 'room.dvr') {
      if (g.status !== 'LOBBY') return { ok: false, code: 'DVR_MODE_LOCKED', error: 'Elige el DVR antes de iniciar la partida.' };
      if (typeof command.payload?.enabled !== 'boolean') return { ok: false, error: 'Modo DVR inválido.' };
      g.dvrEnabled = command.payload.enabled;
      if (!g.dvrEnabled) { const p=buffer(g); p.events=[]; p.commands=[]; p.points=[]; p.checkpoints=[]; }
      else checkpoint(g, serializeGame, true);
      return { ok: true };
    }
    if (command.type === 'room.reset') {
      const closed = structuredClone(g); copyHistoryBuffer(g, closed); bindObservability(closed); bindMarket(closed);
      if (closed.status !== 'FINISHED' && closed.status !== 'ABORTED') {
        finishRequests(closed, 'ROOM_INTERRUPTED');
        closed.closure = { generation: closed.generation, tick: closed.tick, previousStatus: closed.status, reason: 'TEACHER_RESET', actor: { ...identity }, receivedAt };
        closed.status = 'ABORTED';
        observe(closed, 'generation.interrupted', null, { ...closed.closure, commandId: command.id });
        if (capturingHistory(closed)) buffer(closed).points.push(projectHistoryPoint(closed));
        checkpoint(closed, serializeGame, true);
      }
      // Keep both generations and all pending evidence until one durable transaction commits.
      const earlier = buffer(closed).closed; buffer(closed).closed = [];
      clearBuffer(g); delete g.closure;
      Object.assign(g, createGame(Number(command.payload?.duration) === 1200 ? 1200 : 1500, 7357, g.generation + 1, g.dvrEnabled));
      buffer(g).closed.push(...earlier, closed);
      bindObservability(g, f => slackFact(g, f));
      checkpoint(g, serializeGame, true);
      return { ok: true };
    }
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
    validateParameters(command.type, p);
    if(identity.role==='backend'&&['draft.save','change.submit','module.create','module.revise','ai.accept'].includes(command.type))assertBackendEditable(c);
    const handled=workflowCommand(g,c,identity,command.type,p);if(handled)return handled;
    const operated=operationsCommand(g,c,identity,command.type,p,event);if(operated)return operated;
    if(identity.role==='backend' && ['module.create','module.revise','change.submit'].includes(command.type) && g.changes.some(x=>x.companyId===c.id&&x.status==='DEPLOYING'))throw new Error('Espera a que finalice la publicación en curso.');
    if (command.type.startsWith('campaign.') || command.type === 'product.propose') { const result = businessCommand(g, c, identity, command.type, p); event(g, c.id, command.type === 'campaign.activate' ? 'Campaña activada.' : 'Operación comercial registrada.', 'neutral', 'PRODUCTO'); return result; }
    if (command.type.startsWith('security.') && ['security.save','security.configure','security.submit','security.correction'].includes(command.type)) return securityCommand(g,identity,command.type,p);
    if(command.type==='ai.accept'||command.type==='ai.confirm'){
      const receipt=c.runtime.collaboration?.proposals.find(r=>r.id===p.proposalId&&r.actor===identity.id&&r.companyId===c.id&&r.generation===g.generation&&r.status==='PENDING');
      if(receipt?.kind==='qa.interpret'){
        if(identity.role!=='qa'||!receipt.output.scenario)throw new Error('Escenario no disponible.');
        const target=g.changes.find(ch=>ch.id===receipt.changeId&&ch.companyId===c.id);if(!target)throw new Error('Cambio no encontrado.');
        startQa(g,c,target,identity,receipt.output.scenario,receipt.requestText);c.runtime.workflow!.runs.at(-1)!.threadId=receipt.threadId;receipt.status='ACCEPTED';return {ok:true,refs:[target.id,target.qaRunId!]};
      }
      if(receipt?.kind==='cto.interpret'){
        if(identity.role!=='cto'||command.type!=='ai.confirm'||p.confirmed!==true)throw new Error('Se requiere confirmación del CTO.');
        const o=receipt.output;if(o.intent==='query')throw new Error('La consulta no prepara acciones.');
        const type=o.intent==='investment'?'investment.create':'cto.decide',parameters=o.intent==='investment'?{department:o.department,objective:receipt.requestText,justification:receipt.requestText,maximum:o.maximum,...(o.changeId?{changeId:o.changeId}:{}),confirmed:true}:{changeId:o.changeId,decision:o.intent,reason:receipt.requestText,confirmed:true};validateParameters(type,parameters);const result=workflowCommand(g,c,identity,type,parameters);receipt.status='ACCEPTED';return result!;
      }
      if(command.type==='ai.confirm')throw new Error('Decisión no disponible.');
    }
    if (command.type==='ai.accept'||command.type==='ai.reject') {
      const proposal=c.runtime.collaboration?.proposals.find(r=>r.id===p.proposalId);
      // Entrega 8: drafts written by Claude (stored by earlier versions) are never applied.
      if(command.type==='ai.accept'&&(proposal?.kind==='backend.propose'||proposal?.kind==='security.propose'))throw new Error('Claude no prepara diseños ni protecciones. Edita el borrador directamente.');
      return proposalCommand(c,identity,command.type,p);
    }
    if (['module.create','module.revise','security.prepare'].includes(command.type)) {
      const change = prepareArtifact(g, c, identity, command.type, p); if(change.domain==='backend')beginSecurityReview(g,c,change); else bindLegacySecurity(g,c,change); event(g, c.id, `${change.id} preparado. Pendiente de pruebas QA.`, 'neutral', 'PIPELINE'); return { ok: true, refs: [change.id, ...(change.artifactRefs?.map(ref => `${ref.id}@${ref.version}`) ?? [])] };
    }
    if (command.type === 'infra.maintenance') { setMaintenance(g,c,p.mode as import('../shared/observability.js').ServiceMode,identity.id); return {ok:true}; }
    if (command.type === 'infra.server_stop' || command.type === 'infra.server_start') {
      const instance = syncInfrastructure(c).instances.find(i => i.id === Number(p.serverId)); if (!instance) throw new Error('Servidor no encontrado.');
      if (command.type === 'infra.server_stop') { if (instance.status !== 'UP') throw new Error(`APP-${instance.id} no está en línea.`); instance.status = 'STOPPED'; delete instance.readyAt; }
      else { if (instance.status !== 'STOPPED') throw new Error(`APP-${instance.id} no está detenido.`); instance.status = 'RESTARTING'; instance.readyAt = g.tick + RESTART_SECONDS.server; }
      event(g, c.id, command.type === 'infra.server_stop' ? `APP-${instance.id} detenido. Sigue aprovisionado.` : `APP-${instance.id} en arranque · ${RESTART_SECONDS.server} s.`, 'neutral', 'DEVOPS'); return { ok: true, refs: [`APP-${instance.id}`] };
    }
    if (['infra.restart','infra.restart_all','infra.stop','infra.recover'].includes(command.type)) {
      validateParameters(command.type, p);
      if (command.type.startsWith('infra.restart')) restart(c, g.tick, Number(p.duration), command.type === 'infra.restart' ? Number(p.serverId) : undefined);
      else setService(c, p.service as import('../shared/types.js').ServiceId, command.type === 'infra.stop');
      event(g, c.id, command.type.startsWith('infra.restart') ? 'Reinicio iniciado.' : command.type === 'infra.stop' ? 'Servicio detenido.' : 'Servicio recuperado.', 'neutral', 'DEVOPS'); return { ok: true };
    }
    if (command.type === 'draft.save' || command.type === 'change.submit') {
      const domain = identity.role as 'backend' | 'security';
      if(domain==='security')throw new Error('Selecciona una versión Backend y guarda sus protecciones por bloque.');
      const current = c.drafts[domain]?.revision ?? 0;
      if (Number(p.revision) !== current) throw new Error('La revisión cambió. Recarga el borrador.');
      const graph = validateGraph(p.graph, domain, command.type === 'change.submit');
      const execution = releaseFor(c, domain === 'backend' ? graph : c.backend);

      c.drafts[domain] = { graph, revision: current + 1 };
      if (command.type === 'change.submit') {
        const cost = 100 + graph.nodes.reduce((sum, n) => sum + (BLOCKS[domain].find(b => b.type === n.type)?.cost ?? 0), 0);
        const change: Change = { id: `CH-${String(g.changes.length + 1).padStart(3, '0')}`, companyId: c.id, domain, name: `${domain === 'backend' ? 'Lógica' : 'Seguridad'} · revisión ${current + 1}`, graph: structuredClone(graph), status: 'QA_PENDING', cost, reserved: 0, baseVersion: c.version, created: g.tick, reports: [], actorId: identity.id, context: { backend: structuredClone(domain === 'backend' ? graph : c.backend), security: structuredClone(c.security), executionVersion: c.version, execution } };
        beginSecurityReview(g,c,change); g.changes.unshift(change); event(g, c.id, `${change.id} enviado a Seguridad.`, 'neutral', 'PIPELINE'); return { ok: true, refs: [change.id] };
      }
      return { ok: true };
    }
    if (command.type === 'cto.budget') {
      // Legacy quick budget: funds operation for the rest of the game with the full infrastructure scope.
      const amount = Number(p.amount);
      if (![250, 500, 1000].includes(amount) || c.capital - c.reserved - c.infraBudget < amount) throw new Error('Saldo disponible insuficiente.');
      operationsCommand(g, c, identity, 'cto.infra_authorize', { amount, durationSeconds: Math.max(10, Math.min(1500, Math.ceil(g.duration - g.tick))), maxServers: 8, operations: ['scale', 'balancer'] }, () => {});
      event(g, c.id, `Q${amount} de operación autorizados.`, 'neutral', 'CTO'); return { ok: true };
    }
    if (command.type === 'cto.prioritize') { validateParameters(command.type, p); c.runtime.priority = p.incident as 'security' | 'concurrency'; event(g, c.id, `Prioridad: ${p.incident === 'security' ? 'seguridad' : 'concurrencia'}.`, 'neutral', 'CTO'); return { ok: true }; }
    if (command.type === 'infra.scale') {
      const target = 'target' in p ? Number(p.target) : c.servers + Number(p.delta), delta = target - c.servers;
      if (!Number.isInteger(target) || target < 1 || target > 8) throw new Error('Rango de servidores: 1–8.');
      if (delta === 0) throw new Error(`Ya hay ${c.servers} servidor${c.servers === 1 ? '' : 'es'} en servicio.`);
      assertScope(c, g.tick, 'scale', target);
      if (delta > 0 && c.infraBudget < target * 30) throw new Error('Presupuesto operativo insuficiente.');
      c.servers = target; syncInfrastructure(c); event(g, c.id, `${delta > 0 ? `+${delta}` : delta} SERVER · ${c.servers} en servicio.`, 'neutral', 'DEVOPS'); return { ok: true };
    }
    if (command.type === 'infra.balancer') { assertScope(c, g.tick, 'balancer'); c.balancer = Boolean(p.enabled); event(g, c.id, `Balanceador ${c.balancer ? 'activo' : 'desactivado'}.`, 'neutral', 'DEVOPS'); return { ok: true }; }
    if (!ch) throw new Error('Cambio no encontrado.');
    if (ch.baseVersion !== c.version && !['DEPLOYED', 'QA_REJECTED', 'CTO_REJECTED'].includes(ch.status)) throw new Error('La versión base cambió.');
    if(ch.implementation && !['qa.reject','cto.reject'].includes(command.type))assertBundle(ch);
    if (command.type === 'qa.execute') {
      validateParameters(command.type, p);
      if (ch.status !== 'QA_PENDING') throw new Error('QA requiere un cambio pendiente.');
      startQa(g,c,ch,identity,testScenario(p.scenario),typeof p.request==='string'?p.request:undefined);if(typeof p.threadId==='string')c.runtime.workflow!.runs.at(-1)!.threadId=p.threadId;return {ok:true,refs:[ch.id]};
    }
    if (command.type === 'qa.run') {
      if (ch.status !== 'QA_PENDING' || !SUITES.includes(String(p.suite))) throw new Error('No se puede ejecutar esa suite en este estado.');
      if (ch.context?.execution?.modules.length || ch.context?.execution?.security || ch.context?.execution?.blockPolicies?.some(b=>b.rules.length) || !['Concurrencia','Carga'].includes(String(p.suite))) {
        ch.testJob = createTestJob(c, ch, scenarioForSuite(String(p.suite))); ch.status = 'QA_RUNNING'; ch.runningSuite = String(p.suite); return { ok: true };
      }
      ch.status = 'QA_RUNNING'; ch.runningSuite = String(p.suite); ch.due = g.tick + 4;
      if (p.suite === 'Carga') ch.qaLoad = createLoadRun(c, ch.context ?? productionContext(c), g.tick);
      if (p.suite === 'Concurrencia') ch.qaScenario = createConcurrencyRun(`${ch.id}-QA${ch.reports.length + 1}`, ch.context ?? productionContext(c), g.tick);
    } else if (command.type === 'qa.approve') {
      if(ch.implementation&&c.runtime.workflow?.runs.some(r=>r.changeId===ch.id&&r.report))return workflowCommand(g,c,identity,'qa.review',{changeId:ch.id,risks:'Aprobación manual explícita; revisar todas las pruebas adjuntas.',evidenceIds:c.runtime.workflow?.runs.filter(r=>r.changeId===ch.id&&r.report).map(r=>r.id)??[]})!;
      if (ch.status !== 'QA_PENDING' || !ch.reports.some(report => !report.obsolete)) throw new Error('Se requiere una prueba terminada.');
      if(ch.implementation){const state=workflow(c);state.decisions.push({id:`D${state.decisions.length+1}`,changeId:ch.id,actor:identity.id,at:g.tick,kind:'qa.approve',reason:'Aprobación manual explícita; sin observaciones escritas.',evidenceIds:ch.reports.map((r,i)=>`${ch.id}:report:${i}`),failedIds:ch.reports.flatMap((r,i)=>r.testEvidence?.passed===false||r.oversold>0||r.duplicates>0?[`${ch.id}:report:${i}`]:[])});}
      ch.status = 'CTO_PENDING'; event(g, c.id, `${ch.id} aprobado por QA.`, 'neutral', 'PIPELINE');
    } else if (command.type === 'qa.reject') {
      if(ch.implementation)throw new Error('Redacta una carta formal para devolver esta implementación.');
      if (ch.status !== 'QA_PENDING') throw new Error('Estado de cambio inválido.'); ch.status = 'QA_REJECTED';
    } else if (command.type === 'cto.authorize') {
      if(ch.implementation)return workflowCommand(g,c,identity,'cto.decide',{changeId:ch.id,decision:'authorize',reason:'Autorización manual explícita del CTO.',confirmed:true})!;
      if (ch.status !== 'CTO_PENDING') throw new Error('Falta aprobación de QA.');
      if (c.capital - c.reserved - c.infraBudget < ch.cost) throw new Error('Saldo disponible insuficiente.');
      c.reserved += ch.cost; ch.reserved = ch.cost; ch.status = 'AUTHORIZED'; ch.expires = g.tick + 60;
      event(g, c.id, `${ch.id} autorizado · Q${ch.cost}.`, 'neutral', 'CTO');
    } else if (command.type === 'cto.reject') {
      if(ch.implementation)return workflowCommand(g,c,identity,'cto.decide',{changeId:ch.id,decision:'reject',reason:'Rechazo manual explícito del CTO. Se solicita revisión QA.',confirmed:true})!;
      if (ch.status !== 'CTO_PENDING') throw new Error('Estado de cambio inválido.'); ch.status = 'CTO_REJECTED';
    } else if (command.type === 'deploy.start') {
      if(c.capital-c.infraBudget<c.reserved)throw new Error('Saldo reservado insuficiente. Solicita evaluación del CTO.');
      if (ch.status !== 'AUTHORIZED' || g.tick > (ch.expires ?? 0)) throw new Error('No existe autorización vigente.');
      if (g.changes.some(x => x.companyId === c.id && x.status === 'DEPLOYING') || rollbackInProgress(c)) throw new Error('Ya existe un despliegue activo.');
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
        completeQa(c,ch);const restore=(ch.testJob as any)?.restoreStatus;
        delete ch.qaScenario; delete ch.qaLoad; delete ch.testJob;
        ch.status = restore??'QA_PENDING';
        auditCompletion(g, c.id, 'qa.completed', [ch.id], [`requests.executed:${ch.reports.at(-1)!.requests}`, 'reports.added:1']);
        event(g, c.id, `${ch.id} · ${ch.runningSuite} completada.`, 'neutral', 'QA');
      }
    }
    if (ch.status === 'DEPLOYING' && g.tick >= (ch.due ?? Infinity)) {
      if(c.capital<ch.cost||c.capital-c.infraBudget<c.reserved){ch.status='DEPLOY_FAILED';releaseReservation(c,ch);event(g,c.id,`${ch.id} · publicación cancelada por saldo insuficiente.`, 'neutral','CTO');continue;}
      assertBundle(ch);
      if(ch.implementation){c.backend=structuredClone(ch.context!.backend);c.security=structuredClone(ch.context!.security);}else c[ch.domain] = structuredClone(ch.graph); c.version++; c.runtime.releases[c.version] = structuredClone(ch.context?.execution ?? releaseFor(c)); c.deployments++; c.capital -= ch.cost;settleInvestment(c,ch); releaseReservation(c, ch); ch.status = 'DEPLOYED'; ch.releasedVersion = c.version; recordRelease(g, c, ch.id, 'deploy');
      auditCompletion(g, c.id, 'deploy.completed', [ch.id, ...(ch.artifactRefs?.map(ref=>`${ref.id}@${ref.version}`) ?? [])], [`production.version:${c.version}`, `capital.delta:${-ch.cost}`]);
      event(g, c.id, `${ch.id} EN PRODUCCIÓN · v${c.version}`, 'good', 'DEPLOY');
      staleOthers(g, c, ch);
    }
  }
}
export function step(g: GameState, dt = .1) {
  if (g.status !== 'RUNNING') return;
  bindMarket(g); bindObservability(g,f=>slackFact(g,f));
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
    const recovered = c.infrastructure.instances.filter(instance=>instance.status==='RESTARTING'&&g.tick>=instance.readyAt!).map(instance=>`APP-${instance.id}`);
    advanceInfrastructure(c, g.tick); advanceCampaigns(c, g.tick);expireInvestments(c,g.tick,false,g.changes.filter(ch=>ch.companyId===c.id&&['AUTHORIZED','DEPLOYING'].includes(ch.status)).map(ch=>ch.id));
    if (recovered.length) auditCompletion(g, c.id, 'infra.recovered', recovered, ['availability.restored']);
    advanceOperations(g, c, event, (company, keep) => staleOthers(g, company, keep));
    const deploying = activeDeployment(g, c);
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
    reconcileRollbacks(c);
    if (c.capital < c.reserved + c.infraBudget) c.infraBudget = Math.max(0, c.capital - c.reserved);
    c.particles = c.particles.filter(p => g.tick - p.born < p.duration).slice(-90);
    c.deadTicks = capacity === 0 ? c.deadTicks + dt : 0;
    c.bankruptTicks = c.capital <= 0 ? c.bankruptTicks + dt : 0;
    c.crisisTicks = c.customers < 50 && c.pressure >= 200 && !health ? c.crisisTicks + dt : 0;
  }
  advanceMarket(g);
  const removed = g.companies.filter(c => !c.eliminated && (c.deadTicks >= 90 || (c.serviceMode.mode === 'FULL_MAINTENANCE' && g.tick-c.serviceMode.since >= MAINTENANCE_POLICY.eliminationSeconds) || c.crisisTicks >= 30 || c.bankruptTicks >= 30));
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
  updateCrisis(g); sampleTelemetry(g); sampleHistory(g); checkpoint(g, serializeGame, g.status === 'FINISHED');
}
function finishRequests(g: GameState, reason: 'ROOM_FINISHED' | 'ROOM_INTERRUPTED' = 'ROOM_FINISHED') {
  for (const company of g.companies) {
    expireInvestments(company,g.tick,true); closeOperations(company);
    for(const ch of g.changes)if(ch.companyId===company.id&&ch.reserved){releaseReservation(company,ch);if(ch.status==='AUTHORIZED')ch.status='EXPIRED';}
    cancelTraffic(company, g.tick, reason);
    if (company.concurrency.run) { cancelConcurrency(company.concurrency.run, g.tick, reason); settleConcurrency(company); }
  }
  flushMigrations(g); assertMarket(g);
}
export function project(g: GameState, identity: Identity | null, common?: Pick<Snapshot, 'companies'>): Snapshot {
  bindMarket(g);
  const internal = identity?.role === 'operator';
  const particles = (c: Company) => [...trafficParticles(c, g.tick), ...concurrencyParticles(c.concurrency.run, c.color, g.tick, c)].map(p => internal || p.kind !== 'attack' ? p : { ...p, kind: p.finishedAt !== undefined && p.status !== 'COMPLETED' ? 'error' as const : 'success' as const });
  const ownCompany = identity?.companyId != null ? g.companies[identity.companyId] : undefined;
  const { runtime: _runtime, breaches: _breaches, ...ownVisible } = ownCompany ?? {} as Company;
  const privateC = ownCompany ? structuredClone({ ...ownVisible, particles: common?.companies[ownCompany.id].particles ?? particles(ownCompany), traffic: trafficView(ownCompany.traffic, internal) }) : undefined;
  if (privateC) {
    if (privateC.concurrency.run) delete privateC.concurrency.run.operationsState;
    if (privateC.concurrency.run && !internal) privateC.concurrency.run.requests = privateC.concurrency.run.requests.map(r => visibleRequest(r)) as unknown as typeof privateC.concurrency.run.requests;
    const ownDraft = identity?.role === 'backend' || identity?.role === 'security' ? identity.role : null;
    privateC.drafts = ownDraft && privateC.drafts[ownDraft] ? { [ownDraft]: privateC.drafts[ownDraft] } : {};
  }
  return {
    operations: identity ? { infra:ownCompany&&['devops','cto'].includes(identity.role)?infraView(ownCompany,g.tick):undefined, qaLive:ownCompany&&identity.role==='qa'?qaProgress(g,ownCompany):undefined, ...(ownCompany ? { workflow:workflowView(ownCompany), conversations:ownCompany.runtime.conversations?.filter(t=>t.actor===identity!.id&&t.role===identity!.role&&t.generation===g.generation).map(t=>({...t,messages:t.messages.slice(-20)})), collaboration: collaborationView(ownCompany,identity!) } : {}), modules: g.companies.filter(c => identity.role === 'operator' || c.id === identity.companyId).flatMap(c => Object.values(c.runtime.modules).flat().map(({ defects, profile, graph, ...visible }) => visible)), campaigns: g.companies.filter(c => identity.role === 'operator' || c.id === identity.companyId).flatMap(c => c.runtime.campaigns), employees: Object.values(g.actions.employees).filter(e => identity.role === 'operator' || e.companyId === identity.companyId), audit: g.actions.audit.filter(a => identity.role === 'operator' || a.companyId === identity.companyId).slice(-40), priority: ownCompany?.runtime.priority ?? 'concurrency', proposals: ownCompany?.runtime.proposals ?? [], protection: ownCompany?.runtime.releases[ownCompany.version]?.security } : undefined,
    dvrEnabled: g.dvrEnabled, generation: g.generation,
    slack: ownCompany ? structuredClone(g.slack.messages.filter(m=>m.companyId===ownCompany.id)) : undefined,
    tick: g.tick, duration: g.duration, status: g.status, speed: g.speed, identity,
    companies: common?.companies ?? g.companies.map(c => {
      const { infraBudget, reserved, runtime, drafts, backend, security, product, breaches, migrationRemainder, arrivalRemainder, processedRemainder, crisisTicks, deadTicks, bankruptTicks, concurrencyUntil, concurrency, traffic, ...pub } = c;
      return { ...pub, ...(internal?{breaches,infraBudget,reserved}:{}), traffic: trafficView(traffic, internal), concurrency: { runId: concurrency.run?.id, inventory: concurrency.run && { ...concurrency.run.inventory }, totals: { ...concurrency.totals } }, particles: particles(c), modules: [...route(backend), ...route(security)].map(n => n.type), pipelineCounts: [['QA_PENDING', 'QA_RUNNING'], ['CTO_PENDING'], ['AUTHORIZED', 'DEPLOYING'], ['DEPLOYED']].map(states => g.changes.filter(ch => ch.companyId === c.id && states.includes(ch.status)).length) };
    }),
    events: internal ? g.events : g.events.filter(e=>e.companyId===null||e.companyId===identity?.companyId||['CONCURRENCIA','COLAPSO'].includes(e.category)), migrations: g.migrations, unserved: g.unserved, privateCompany: privateC,
    changes: (identity?.role === 'operator' ? g.changes : g.changes.filter(ch => ch.companyId === identity?.companyId)).map(({ qaLoad, qaScenario, testJob, context, implementation, ...change }) => ({ ...change, reports:change.reports.map(r=>r.testEvidence?.runId?{...r,testEvidence:{...r.testEvidence,outcomeCount:r.testEvidence.outcomes.length,eventCount:r.testEvidence.events?.length??0,outcomes:[],events:[]}}:r), ...(implementation ? { implementation: { ...implementation, security: implementation.security ? { ...implementation.security, blocks: [] } : undefined } } : {}), ...(context ? { context: { backend: context.backend, security: context.security, executionVersion: context.executionVersion } } : {}) })),
  };
}

function qaProgress(g:GameState,c:Company){
 const ch=g.changes.find(ch=>ch.companyId===c.id&&ch.status==='QA_RUNNING'&&ch.testJob);if(!ch?.testJob)return;
 const job=ch.testJob,requests=job.scenario.suite==='load'?Object.values(job.staging.traffic.requests):job.requests;
 return {changeId:ch.id,elapsed:job.elapsed,total:job.scenario.requests,finished:job.scenario.suite==='load'?(job.finished?.length??0):requests.filter(r=>r.result).length,requests:requests.filter(r=>r.arrivalAt<=job.elapsed).slice(-12).map(r=>({id:r.id,customerId:r.customerId,status:r.status,nodeId:r.path[Math.min(r.cursor,r.path.length-1)]?.id??'esperando'}))};
}
