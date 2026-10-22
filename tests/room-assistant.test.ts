import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../server/engine.js';
import { ensureLobby, formTeams, joinLobby, lobbyView, movePlayer, participantIdentity, swapPlayers, LobbyError, type Random } from '../server/lobby.js';
import { applyRoomPlan, describeChanges, planRoomCalls, roomRequest } from '../server/room-assistant.js';
import { LOBBY_ICONS } from '../shared/lobby.js';
import { ROLES, type GameState } from '../shared/types.js';
import { command } from './helpers.js';

const seeded = (seed = 7): Random => { let s = seed; return n => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; }; };
const NAMES = ['Víctor', 'Ana', 'Luis', 'Marta', 'Sofía', 'Diego', 'Lucía', 'Pablo', 'Elena', 'Jorge', 'Carla', 'Raúl', 'Inés', 'Tomás', 'Paula', 'Hugo Paz', 'Nora', 'Iván', 'Lara', 'Óscar', 'Rosa', 'Julián', 'Eva', 'Mateo', 'Clara', 'Víctor Hugo', 'Andrés'];
function room(players = 27): GameState {
  const g = createGame(1500, 7357, 0, false); ensureLobby(g, seeded(1), 1);
  NAMES.slice(0, players).forEach((name, i) => joinLobby(g, { pin: g.lobby!.pin, name, icon: LOBBY_ICONS[i % LOBBY_ICONS.length] }, 10 + i));
  formTeams(g, seeded(3), 100); return g;
}
const byName = (g: GameState, name: string) => g.lobby!.participants.find(p => p.name === name)!;
const companyOf = (g: GameState, name: string) => byName(g, name).companyId;
const firstSeatedName = (g: GameState, exclude: string[] = []) => g.lobby!.participants.find(p => p.companyId !== undefined && !exclude.includes(p.name))!.name;
/** Each company keeps exactly one player per role, and nobody holds two seats. */
function assertSeats(g: GameState) {
  const roles = g.lobby!.formation!.roles;
  for (let c = 0; c < 5; c++) assert.deepEqual(g.lobby!.participants.filter(p => p.companyId === c).map(p => p.role).sort(), [...roles].sort(), `company ${c}`);
  const view = lobbyView(g, { id: 'operator', role: 'operator', companyId: null })!;
  assert.equal(view.formation!.teams.flatMap(t => t.members).length + view.formation!.reserve.length, g.lobby!.participants.length);
}
const call = (name: string, input: Record<string, unknown>) => ({ name, input });
const messageOf = (plan: ReturnType<typeof planRoomCalls>) => 'message' in plan ? plan.message : '';

test('room moves are allowed only between FORMAR EQUIPOS and EMPEZAR JUEGO', () => {
  const g = createGame(1500, 7357, 0, false); ensureLobby(g, seeded(1), 1);
  NAMES.slice(0, 25).forEach((name, i) => joinLobby(g, { pin: g.lobby!.pin, name, icon: '🐱' }, i));
  assert.throws(() => movePlayer(g, byName(g, 'Ana').id, 1), (e: LobbyError) => e.code === 'NO_TEAMS');
  formTeams(g, seeded(3), 100);
  const target = (companyOf(g, 'Ana')! + 1) % 5;
  assert.equal(movePlayer(g, byName(g, 'Ana').id, target, seeded(5)).length, 2);
  assert.equal(command(g, 'operator', 'room.start').ok, true);
  assert.throws(() => movePlayer(g, byName(g, 'Ana').id, (target + 1) % 5), (e: LobbyError) => e.code === 'GAME_STARTED');
  assert.throws(() => swapPlayers(g, byName(g, 'Ana').id, byName(g, 'Luis').id), (e: LobbyError) => e.code === 'GAME_STARTED');
});

test('moving a player swaps seats with a random member of the target company; phones follow the draw', () => {
  const g = room(), name = firstSeatedName(g), p = byName(g, name), from = p.companyId!, role = p.role!, target = (from + 2) % 5;
  const economy = JSON.stringify(g.companies);
  const changes = movePlayer(g, p.id, target, seeded(9));
  const displaced = changes[1].player;
  assert.equal(p.companyId, target); assert.equal(displaced.companyId, from); assert.equal(displaced.role, role);
  assert.equal(p.role, changes[1].from.role, 'the moved player takes the displaced member role');
  assert.deepEqual(participantIdentity(g, { participant: p.id, lobby: g.lobby!.id }), { id: `${target}-${p.role}`, role: p.role, companyId: target });
  assertSeats(g);
  assert.equal(JSON.stringify(g.companies), economy, 'room moves never touch the economy');
  assert.throws(() => movePlayer(g, p.id, target), (e: LobbyError) => e.code === 'SAME_COMPANY');
  assert.match(describeChanges(g, changes), new RegExp(`${name} pasó de ${g.companies[from].name} a ${g.companies[target].name} como`));
});

test('a reserve player takes a seat and the displaced member goes to the reserve; swaps exchange seats', () => {
  const g = room(), spare = g.lobby!.formation!.order.length === 25 ? g.lobby!.participants.find(p => p.companyId === undefined)! : undefined;
  assert(spare, 'two players stay in reserve');
  const changes = movePlayer(g, spare.id, 4, seeded(11)), displaced = changes[1].player;
  assert.equal(spare.companyId, 4); assert.equal(displaced.companyId, undefined); assert.equal(displaced.role, undefined);
  const view = lobbyView(g, { id: 'operator', role: 'operator', companyId: null })!;
  assert(view.formation!.teams[4].members.some(m => m.id === spare.id), 'the newcomer is listed with the team');
  assert(view.formation!.reserve.some(m => m.id === displaced.id));
  assert.deepEqual(participantIdentity(g, { participant: displaced.id, lobby: g.lobby!.id }), { id: `auditor-${displaced.id}`, role: 'auditor', companyId: null }, 'the displaced member audits');
  assertSeats(g);
  assert.match(describeChanges(g, changes), /entró a ORBIT como .*pasó a la reserva\./);
  // Swap across companies and inside one company.
  const a = g.lobby!.participants.find(p => p.companyId === 0)!, b = g.lobby!.participants.find(p => p.companyId === 1)!, seatA = { c: a.companyId, r: a.role }, seatB = { c: b.companyId, r: b.role };
  swapPlayers(g, a.id, b.id);
  assert.deepEqual([a.companyId, a.role, b.companyId, b.role], [seatB.c, seatB.r, seatA.c, seatA.r]); assertSeats(g);
  const [x, y] = g.lobby!.participants.filter(p => p.companyId === 2);
  const roles = [x.role, y.role]; swapPlayers(g, x.id, y.id); assert.deepEqual([x.role, y.role], roles.reverse()); assertSeats(g);
  const reserve = g.lobby!.participants.filter(p => p.companyId === undefined);
  assert.throws(() => swapPlayers(g, reserve[0].id, reserve[1].id), (e: LobbyError) => e.code === 'BOTH_RESERVE');
});

test('room orders: names and companies must be in the teacher words; Claude only asks for unknown or ambiguous names', () => {
  const g = room(), victor = byName(g, 'Víctor'), from = g.companies[victor.companyId!].name, target = g.companies[(victor.companyId! + 1) % 5].name;
  const order = `Cámbiame a Víctor de ${from} a ${target}`;
  const ok = planRoomCalls(g, order, [call('mover_jugador', { jugador: 'Víctor', empresa: target, citas: ['Cámbiame a Víctor', `a ${target}`] })]);
  assert.equal(ok.state, 'EXECUTE');
  // "Víctor" is exact even though "Víctor Hugo" also exists; "Hugo" alone matches two players.
  assert.deepEqual(ok.state === 'EXECUTE' && ok.operations, [{ kind: 'move', playerId: victor.id, companyId: (victor.companyId! + 1) % 5 }]);
  const ambiguous = planRoomCalls(g, `pasá a Hugo a ${target}`, [call('mover_jugador', { jugador: 'Hugo', empresa: target, citas: ['pasá a Hugo'] })]);
  assert.equal(ambiguous.state, 'REJECTED'); assert.match(messageOf(ambiguous), /Hay 2 jugadores que coinciden con "Hugo": Hugo Paz, Víctor Hugo/);
  const unknown = planRoomCalls(g, `pasá a Bruno a ${target}`, [call('mover_jugador', { jugador: 'Bruno', empresa: target, citas: ['pasá a Bruno'] })]);
  assert.match(messageOf(unknown), /No encuentro a "Bruno" en la sala/);
  // A name the teacher never said is not executed, whatever the model claims.
  assert.equal(planRoomCalls(g, `pasá a Víctor a ${target}`, [call('mover_jugador', { jugador: 'Ana', empresa: target, citas: ['pasá a Víctor'] })]).state, 'NEEDS_INPUT');
  assert.equal(planRoomCalls(g, `pasá a Víctor a ${target}`, [call('mover_jugador', { jugador: 'Víctor', empresa: target, citas: ['mandá a Ana'] })]).state, 'NEEDS_INPUT');
  // Direction: with two companies, the destination is the one introduced with "a"; the stated origin is a fact checked by the server.
  assert.equal(planRoomCalls(g, order, [call('mover_jugador', { jugador: 'Víctor', empresa: from, citas: ['Cámbiame a Víctor'] })]).state, 'NEEDS_INPUT');
  const other = g.companies.find(c => c.id !== victor.companyId && c.name !== target)!.name;
  const wrongOrigin = planRoomCalls(g, `Cámbiame a Víctor de ${other} a ${target}`, [call('mover_jugador', { jugador: 'Víctor', empresa: target, citas: ['Cámbiame a Víctor'] })]);
  assert.match(messageOf(wrongOrigin), new RegExp(`Víctor está en ${from}, no en ${other}`));
  // No move ordered, negated order, advice, contract violations and too many calls execute nothing.
  assert.equal(planRoomCalls(g, `no muevas a Víctor a ${target}`, [call('mover_jugador', { jugador: 'Víctor', empresa: target, citas: ['Víctor'] })]).state, 'NEEDS_INPUT');
  assert.equal(planRoomCalls(g, '¿Quién debería ir a NOVA?', [call('rechazar_instruccion', { motivo: 'CONSEJO' })]).state, 'DECLINED');
  assert.equal(planRoomCalls(g, 'hola', []).state, 'NO_OPERATION');
  assert.equal(planRoomCalls(g, `pasá a Víctor a ${target}`, [call('mover_jugador', { jugador: 'Víctor', empresa: target, citas: ['pasá a Víctor'], rol: 'qa' })]).state, 'REJECTED');
  const five = ['Ana', 'Luis', 'Marta', 'Sofía', 'Diego'].map(n => call('mover_jugador', { jugador: n, empresa: 'NOVA', citas: [n] }));
  assert.equal(planRoomCalls(g, 'pasá a Ana, Luis, Marta, Sofía y Diego a NOVA', five).state, 'REJECTED');
  assert.match(messageOf(planRoomCalls(g, 'pasá a alguien', [call('solicitar_dato', { faltantes: ['jugador', 'empresa'] })])), /Falta indicar el jugador, la empresa de destino/);
  // Swap.
  const swap = planRoomCalls(g, 'intercambiá a Ana con Luis', [call('intercambiar', { jugador_a: 'Ana', jugador_b: 'Luis', citas: ['intercambiá a Ana con Luis'] })]);
  assert.equal(swap.state, 'EXECUTE');
  if (swap.state === 'EXECUTE') { const before = [companyOf(g, 'Ana'), companyOf(g, 'Luis')]; applyRoomPlan(g, swap.operations); assert.deepEqual([companyOf(g, 'Ana'), companyOf(g, 'Luis')], before.reverse()); assertSeats(g); }
});

test('only the order and the company names reach the provider; player names stay on the server', () => {
  const g = room(), request = roomRequest(g, { id: 'r1', text: 'pasá a Víctor a EMBER' });
  assert.deepEqual(JSON.parse(request.content), { orden: 'pasá a Víctor a EMBER', empresas: ['NOVA', 'VERTEX', 'BYTE', 'EMBER', 'ORBIT'] });
  for (const p of g.lobby!.participants.filter(p => p.name !== 'Víctor')) assert(!request.content.includes(p.name) && !request.system.includes(p.name), p.name);
  assert.deepEqual(request.tools.map(t => t.name), ['mover_jugador', 'intercambiar', 'solicitar_dato', 'rechazar_instruccion']);
  for (const t of request.tools) { assert.equal(t.strict, true); assert.equal((t.input_schema as { additionalProperties: boolean }).additionalProperties, false); }
  assert.equal(ROLES.length, 6);
});
