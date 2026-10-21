import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame, project } from '../server/engine.js';
import { serviceRates } from '../server/traffic.js';
import { effectiveServers } from '../server/infrastructure.js';
import { activeDeployment, operations } from '../server/operations.js';
import { recoverGame, serializeGame } from '../server/persistence.js';
import { commandsFor, executorContext, finalReply, outcome, planCalls } from '../server/executor.js';
import { command, advanceGame, authorizeAtomic, authorizeInfra } from './helpers.js';
import type { GameState, Identity, Role } from '../shared/types.js';
import type { ToolCall } from '../shared/executor.js';

const start = () => { const g = createGame(); g.status = 'RUNNING'; return g; };
const actor = (role: Role, companyId = 0): Identity => ({ id: `${companyId}-${role}`, role, companyId });
let n = 0;
function order(g: GameState, role: Role, text: string, calls: ToolCall[], selection = {}) {
  const who = actor(role), ctx = executorContext(g, who, { id: `dv-${++n}`, text, selection }, []), plan = planCalls(calls, ctx);
  return finalReply(plan, commandsFor(plan, ctx).map(({ planned, command: c }) => outcome(planned.tool!, planned, applyCommand(g, who, c), g)));
}

test('E8 DevOps scales only inside the CTO scope: operations, maximum servers and window', () => {
  const g = start(), c = g.companies[0];
  let r = command(g, 'devops', 'infra.scale', { delta: 1 }); assert.equal(r.ok, false); assert.match(r.error!, /Sin autorización|no incluye/);
  assert.equal(command(g, 'devops', 'infra.balancer', { enabled: true }).ok, false);
  const request = command(g, 'devops', 'infra.request_budget', { amount: 600, durationSeconds: 300, maxServers: 3, operations: ['scale'] });
  assert.equal(request.ok, true); assert.equal(c.infraBudget, 750, 'a request moves no money');
  assert.equal(command(g, 'devops', 'cto.infra_authorize', { amount: 600, durationSeconds: 300, maxServers: 3, operations: ['scale'], requestId: request.refs![0] }).ok, false, 'DevOps cannot authorize its own request');
  const before = { capital: c.capital, reserved: c.reserved };
  assert.equal(command(g, 'cto', 'cto.infra_authorize', { amount: 600, durationSeconds: 300, maxServers: 3, operations: ['scale'], requestId: request.refs![0] }).ok, true);
  assert.equal(c.infraBudget, 1350); assert.equal(c.capital, before.capital); assert.equal(operations(c).requests[0].status, 'AUTHORIZED');
  assert(command(g, 'devops', 'infra.scale', { target: 3 }).ok); assert.equal(c.servers, 3);
  r = command(g, 'devops', 'infra.scale', { target: 4 }); assert.equal(r.ok, false); assert.match(r.error!, /Máximo autorizado: 3/);
  r = command(g, 'devops', 'infra.balancer', { enabled: true }); assert.equal(r.ok, false); assert.match(r.error!, /balanceador/);
  advanceGame(g, 301);
  r = command(g, 'devops', 'infra.scale', { delta: -1 }); assert.equal(r.ok, false); assert.match(r.error!, /Sin autorización/);
  assert.equal(c.servers, 3, 'servers already provisioned keep running and keep costing');
});

test('E8 removing servers never refunds spent money; operating cost follows provisioned servers', () => {
  const g = start(), c = g.companies[0]; authorizeInfra(g, 0, 4);
  assert(command(g, 'devops', 'infra.scale', { target: 4 }).ok);
  const budget = c.infraBudget; advanceGame(g, 10);
  const spent = Math.round((budget - c.infraBudget) * 100) / 100; assert.equal(spent, 20);
  const capital = c.capital; assert(command(g, 'devops', 'infra.scale', { target: 1 }).ok);
  assert.equal(c.capital, capital); assert.equal(Math.round(c.infraBudget * 100) / 100, Math.round((budget - 20) * 100) / 100);
  const before = c.infraBudget; advanceGame(g, 10); assert.equal(Math.round((before - c.infraBudget) * 100) / 100, 5);
});

test('E8 servers without balancer or stopped servers provide no capacity, but still cost', () => {
  const g = start(), c = g.companies[0]; authorizeInfra(g);
  assert(command(g, 'devops', 'infra.scale', { target: 3 }).ok);
  assert.equal(effectiveServers(c), 1); assert(command(g, 'devops', 'infra.balancer', { enabled: true }).ok); assert.equal(effectiveServers(c), 3);
  const web = serviceRates(c).web;
  assert(command(g, 'devops', 'infra.server_stop', { serverId: 2 }).ok); assert.equal(effectiveServers(c), 2); assert.equal(serviceRates(c).web, web * 2 / 3);
  assert.equal(command(g, 'devops', 'infra.server_stop', { serverId: 2 }).ok, false);
  const budget = c.infraBudget; advanceGame(g, 2); assert.equal(Math.round((budget - c.infraBudget) * 100) / 100, 3, 'three provisioned servers keep their cost');
  assert(command(g, 'devops', 'infra.server_start', { serverId: 2 }).ok); assert.equal(c.infrastructure.instances[1].status, 'RESTARTING'); advanceGame(g, 10.5);
  assert.equal(c.infrastructure.instances[1].status, 'UP'); assert.equal(effectiveServers(c), 3);
  assert.equal(command(g, 'backend', 'infra.server_stop', { serverId: 1 }).ok, false);
});

test('E8 rollback restores an authorized tested version as a new release, with real transition and no refunds', () => {
  const g = start(), c = g.companies[0];
  const ch = authorizeAtomic(g, 'rolling'); advanceGame(g, 7);
  assert.equal(ch.status, 'DEPLOYED'); assert.equal(c.version, 2); assert.equal(ch.releasedVersion, 2);
  const v2 = structuredClone(c.backend), customers = c.customers, reputation = c.reputation;
  // No authorization: DevOps cannot roll back on its own.
  let r = command(g, 'devops', 'deploy.rollback', { strategy: 'restart' }); assert.equal(r.ok, false);
  assert.equal(command(g, 'devops', 'cto.rollback_authorize', { targetVersion: 1, amount: 150 }).ok, false);
  assert.equal(command(g, 'cto', 'cto.rollback_authorize', { targetVersion: 2, amount: 150 }).ok, false, 'current version');
  assert.equal(command(g, 'cto', 'cto.rollback_authorize', { targetVersion: 9, amount: 150 }).ok, false, 'unknown version');
  const reserved = c.reserved; assert(command(g, 'cto', 'cto.rollback_authorize', { targetVersion: 1, amount: 150 }).ok);
  assert.equal(c.reserved, reserved + 150);
  const capital = c.capital; r = command(g, 'devops', 'deploy.rollback', { strategy: 'restart' }); assert.equal(r.ok, true);
  assert.equal(activeDeployment(g, c)?.strategy, 'restart'); assert.equal(serviceRates(c, activeDeployment(g, c)).web, 0, 'Restart Replace interrupts capacity');
  assert.equal(command(g, 'devops', 'deploy.start', { strategy: 'rolling' }, ch.id).ok, false, 'no parallel deployment');
  advanceGame(g, 3.2);
  const rollback = operations(c).rollbacks[0];
  assert.equal(rollback.status, 'COMPLETED'); assert.equal(c.version, 3); assert.equal(rollback.resultVersion, 3);
  assert.deepEqual(c.backend, operations(c).releases.find(x => x.version === 1)!.backend); assert.notDeepEqual(c.backend, v2);
  assert(c.capital < capital - 149, 'the rollback cost is charged'); assert.equal(c.reserved, reserved);
  assert(c.customers <= customers + 5); assert(c.reputation <= reputation + 1, 'reputation is not restored by a rollback');
  assert.equal(operations(c).releases.at(-1)!.kind, 'rollback'); assert.equal(operations(c).releases.at(-1)!.rollbackOf, 1);
  assert.equal(command(g, 'devops', 'deploy.rollback', { strategy: 'restart' }).ok, false, 'an authorization is used once');
});

test('E8 rollback authorizations expire and release their reservation; restart persists the state', () => {
  const g = start(), c = g.companies[0]; authorizeAtomic(g, 'restart'); advanceGame(g, 4);
  const reserved = c.reserved; assert(command(g, 'cto', 'cto.rollback_authorize', { targetVersion: 1, amount: 200 }).ok);
  const restored = recoverGame(serializeGame(g)); assert.equal(operations(restored.companies[0]).rollbacks[0].status, 'AUTHORIZED');
  advanceGame(g, 61); assert.equal(operations(c).rollbacks[0].status, 'EXPIRED'); assert.equal(c.reserved, reserved);
});

test('E8 DevOps and CTO orders through Claude: scope, request, rollback with explicit strategy', () => {
  const g = start(), c = g.companies[0];
  let r = order(g, 'devops', 'Pedile al CTO Q500 por 3 minutos para escalar hasta 4 servidores', [{ name: 'devops_solicitar_presupuesto', input: { monto: 500, duracion_segundos: 180, max_servidores: 4, operaciones: ['escalar'], citas: ['Q500', '3 minutos', 'escalar hasta 4 servidores'] } }]);
  assert.equal(r.state, 'EXECUTED', r.message); assert.equal(operations(c).requests[0].amount, 500);
  r = order(g, 'cto', `Autorizá la solicitud ${operations(c).requests[0].id} por Q500, 3 minutos y máximo 4 servidores`, [{ name: 'cto_autorizar_infraestructura', input: { monto: 500, duracion_segundos: 180, max_servidores: 4, operaciones: ['escalar'], solicitud: operations(c).requests[0].id, citas: [`Autorizá la solicitud ${operations(c).requests[0].id}`, 'Q500', '3 minutos', 'máximo 4 servidores'] } }]);
  assert.equal(r.state, 'EXECUTED', r.message); assert.equal(operations(c).requests[0].status, 'AUTHORIZED');
  r = order(g, 'cto', 'Decidí qué inversiones deberíamos aprobar', [{ name: 'rechazar_instruccion', input: { motivo: 'DECISION_DELEGADA' } }]);
  assert.equal(r.state, 'DECLINED'); assert.equal(operations(c).authorizations.filter(a => a.kind === 'cto').length, 1);
  r = order(g, 'cto', 'Autorizá presupuesto para infraestructura', [{ name: 'cto_autorizar_infraestructura', input: { monto: 1000, duracion_segundos: 300, max_servidores: 8, operaciones: [], solicitud: '', citas: ['Autorizá presupuesto para infraestructura'] } }]);
  assert.equal(r.state, 'NEEDS_INPUT'); assert.match(r.message, /monto/);
  authorizeAtomic(g, 'rolling'); advanceGame(g, 7);
  r = order(g, 'cto', 'Autorizá rollback a la versión anterior por Q120', [{ name: 'cto_autorizar_rollback', input: { version_objetivo: null, monto: 120, citas: ['rollback a la versión anterior', 'Q120'] } }]);
  assert.equal(r.state, 'EXECUTED', r.message); assert.equal(operations(c).rollbacks[0].targetVersion, 1);
  r = order(g, 'devops', 'Ejecutá rollback a la versión anterior autorizada', [{ name: 'devops_rollback', input: { estrategia: 'rolling', citas: ['Ejecutá rollback a la versión anterior autorizada'] } }]);
  assert.equal(r.state, 'NEEDS_INPUT'); assert.match(r.message, /estrategia/); assert.equal(operations(c).rollbacks[0].status, 'AUTHORIZED');
  r = order(g, 'devops', 'Ejecutá rollback a la versión anterior autorizada con Rolling', [{ name: 'devops_rollback', input: { estrategia: 'rolling', citas: ['rollback', 'con Rolling'] } }]);
  assert.equal(r.state, 'EXECUTED', r.message); assert.equal(operations(c).rollbacks[0].status, 'IN_PROGRESS');
  r = order(g, 'devops', 'Detené el servidor 1', [{ name: 'devops_servidor', input: { servidor: 1, accion: 'detener', citas: ['Detené el servidor 1'] } }]);
  assert.equal(r.state, 'EXECUTED'); assert.equal(c.infrastructure.instances[0].status, 'STOPPED');
});

test('E8 infrastructure scope and requests stay private to the company DevOps and CTO', () => {
  const g = start(); command(g, 'devops', 'infra.request_budget', { amount: 777, durationSeconds: 120, maxServers: 2, operations: ['scale'] });
  assert(project(g, actor('devops')).operations!.infra!.requests.length === 1); assert(project(g, actor('cto')).operations!.infra);
  for (const identity of [null, actor('backend'), actor('qa'), actor('devops', 1), actor('cto', 1)]) assert(!JSON.stringify(project(g, identity)).includes('"amount":777'));
});
