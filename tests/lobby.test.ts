import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGame, project, step } from '../server/engine.js';
import { checkPin, ensureLobby, formTeams, joinLobby, lobbyView, participantIdentity, removeParticipant, type Random } from '../server/lobby.js';
import { serializeGame, recoverGame } from '../server/persistence.js';
import { LOBBY_ICONS } from '../shared/lobby.js';
import { ROLES, type GameState } from '../shared/types.js';
import { command } from './helpers.js';

/** Deterministic stand-in for the OS generator so assignments can be asserted exactly. */
const sequence = (seed = 1): Random => { let s = seed; return n => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; }; };
const room = (players = 0, product = false) => {
  const g = createGame(1500, 7357, 0, false); g.productEnabled = product; ensureLobby(g, sequence(9), 1000);
  for (let i = 0; i < players; i++) joinLobby(g, { pin: g.lobby!.pin, name: `Jugador ${i + 1}`, icon: LOBBY_ICONS[i % LOBBY_ICONS.length] }, 2000 + i);
  return g;
};
const economy = (g: GameState) => createHash('sha256').update(JSON.stringify({ tick: g.tick, seed: g.seed, companies: g.companies, market: g.market, changes: g.changes, migrations: g.migrations, unserved: g.unserved })).digest('hex');

test('a room opens once with a six-digit PIN and validates every join', () => {
  const g = room();
  assert.match(g.lobby!.pin, /^\d{6}$/); const pin = g.lobby!.pin;
  assert.equal(ensureLobby(g), false); assert.equal(g.lobby!.pin, pin);
  const fail = (input: Record<string, unknown>, code: string) => assert.throws(() => joinLobby(g, { pin, name: 'Ana', icon: '🐢', ...input }), (e: { code?: string }) => e.code === code);
  fail({ pin: '000000' === pin ? '111111' : '000000' }, 'BAD_PIN');
  fail({ name: '   ' }, 'BAD_NAME'); fail({ name: 'x'.repeat(21) }, 'BAD_NAME'); fail({ icon: '🙂' }, 'BAD_ICON'); fail({ icon: undefined }, 'BAD_ICON');
  // Double-meaning emoji are not offered and cannot be sent by hand either.
  for (const icon of ['🍑', '🍒', '🍌', '🔥', '🍄', '🍆', '💦']) { assert.equal((LOBBY_ICONS as readonly string[]).includes(icon), false); fail({ icon }, 'BAD_ICON'); }
  const ana = joinLobby(g, { pin: ` ${pin.slice(0, 3)} ${pin.slice(3)} `, name: '  Ana​   María ', icon: '🐢' });
  assert.equal(ana.name, 'Ana María');
  fail({ name: 'ANA MARÍA' }, 'NAME_TAKEN'); fail({ name: 'ana maria' }, 'NAME_TAKEN');
  assert.equal(joinLobby(g, { pin, name: 'Beto', icon: '🐢' }).icon, '🐢', 'icons may repeat');
  removeParticipant(g, ana.id); assert.equal(g.lobby!.participants.length, 1);
  assert.notEqual(joinLobby(g, { pin, name: 'Ana María', icon: '🐱' }).id, ana.id, 'ids are never reused');
  g.status = 'RUNNING'; fail({ name: 'Tarde' }, 'ROOM_CLOSED');
});

test('the draw seats exactly five players per company, one per role, and leaves the rest in reserve', () => {
  const g = room(24);
  assert.throws(() => formTeams(g, sequence()), (e: { code?: string; message: string }) => e.code === 'NOT_ENOUGH' && /25/.test(e.message));
  joinLobby(g, { pin: g.lobby!.pin, name: 'Jugador 25', icon: '🦉' }); joinLobby(g, { pin: g.lobby!.pin, name: 'Jugador 26', icon: '🦉' }); joinLobby(g, { pin: g.lobby!.pin, name: 'Jugador 27', icon: '🦉' });
  const before = economy(g);
  formTeams(g, sequence(4), 5000);
  const roles = ROLES.filter(r => r !== 'product');
  for (let c = 0; c < 5; c++) assert.deepEqual(g.lobby!.participants.filter(p => p.companyId === c).map(p => p.role).sort(), [...roles].sort());
  const reserve = g.lobby!.participants.filter(p => p.companyId === undefined);
  assert.equal(reserve.length, 2); assert(reserve.every(p => p.role === undefined));
  assert.equal(economy(g), before, 'the draw does not touch the economy or the engine seed');
  // The room closes to joins and changes once the teams exist.
  assert.throws(() => joinLobby(g, { pin: g.lobby!.pin, name: 'Tarde', icon: '🐢' }), (e: { code?: string }) => e.code === 'TEAMS_FORMED');
  assert.throws(() => checkPin(g, g.lobby!.pin), (e: { code?: string }) => e.code === 'TEAMS_FORMED');
  assert.throws(() => removeParticipant(g, reserve[0].id), (e: { code?: string }) => e.code === 'TEAMS_FORMED');
  assert.throws(() => formTeams(g, sequence()), (e: { code?: string }) => e.code === 'TEAMS_FORMED');
});

test('with Producto/UX each company gets six players and the switch locks after the draw', () => {
  const g = room(29, true);
  assert.throws(() => formTeams(g, sequence()), (e: { code?: string; message: string }) => e.code === 'NOT_ENOUGH' && /30/.test(e.message));
  joinLobby(g, { pin: g.lobby!.pin, name: 'Jugador 30', icon: '🐢' }); formTeams(g, sequence(7));
  for (let c = 0; c < 5; c++) assert.deepEqual(g.lobby!.participants.filter(p => p.companyId === c).map(p => p.role).sort(), [...ROLES].sort());
  assert.equal(command(g, 'operator', 'room.product', { enabled: false }).code, 'PRODUCT_MODE_LOCKED');
});

test('a seated participant acts as that company role; the reserve audits and stale rooms have no identity', () => {
  const g = room(26); formTeams(g, sequence(3));
  const seated = g.lobby!.participants.find(p => p.companyId === 2 && p.role === 'devops')!, spare = g.lobby!.participants.find(p => p.companyId === undefined)!;
  assert.deepEqual(participantIdentity(g, { participant: seated.id, lobby: g.lobby!.id }), { id: '2-devops', role: 'devops', companyId: 2 });
  assert.deepEqual(participantIdentity(g, { participant: spare.id, lobby: g.lobby!.id }), { id: `auditor-${spare.id}`, role: 'auditor', companyId: null });
  assert.equal(participantIdentity(g, { participant: seated.id, lobby: 'another-room' }), null);
});

test('the PIN is only for the teacher, the room is public while waiting and teams stay with the teacher during play', () => {
  const g = room(25); formTeams(g, sequence(5), 7000);
  const operator = lobbyView(g, { id: 'operator', role: 'operator', companyId: null })!, pub = lobbyView(g, null)!;
  assert.equal(operator.pin, g.lobby!.pin); assert.equal(pub.pin, undefined); assert.equal(project(g, null).lobby?.pin, undefined);
  assert.equal(pub.participants.length, 25); assert.equal(pub.formation!.teams.length, 5); assert(pub.formation!.teams.every(t => t.members.length === 5)); assert.equal(pub.formation!.at, 7000);
  assert.equal(JSON.stringify(pub).includes('joinedAt'), false);
  command(g, 'operator', 'room.start');
  assert.equal(project(g, null).lobby, undefined); assert.equal(project(g, { id: '0-qa', role: 'qa', companyId: 0 }).lobby, undefined);
  assert.equal(project(g, { id: 'operator', role: 'operator', companyId: null }).lobby?.formation?.teams.length, 5);
});

test('the room survives a restart and a reset keeps PIN and players for a new draw', () => {
  const g = room(25); formTeams(g, sequence(6)); const pin = g.lobby!.pin;
  const recovered = recoverGame(serializeGame(g));
  assert.deepEqual(recovered.lobby, g.lobby);
  command(g, 'operator', 'room.start'); for (let i = 0; i < 20; i++) step(g);
  assert.equal(command(g, 'operator', 'room.reset', { duration: 1200 }).ok, true);
  assert.equal(g.status, 'LOBBY'); assert.equal(g.lobby!.pin, pin); assert.equal(g.lobby!.participants.length, 25);
  assert.equal(g.lobby!.formation, undefined); assert(g.lobby!.participants.every(p => p.companyId === undefined && p.role === undefined));
  formTeams(g, sequence(8)); assert.equal(g.lobby!.participants.filter(p => p.companyId !== undefined).length, 25);
});

test('with the real generator every player is equally likely to land in each company and role', () => {
  const counts = new Map<string, number>(), draws = 2000;
  for (let i = 0; i < draws; i++) {
    const g = room(25); formTeams(g);
    const first = g.lobby!.participants[0]; counts.set(`${first.companyId}`, (counts.get(`${first.companyId}`) ?? 0) + 1); counts.set(first.role!, (counts.get(first.role!) ?? 0) + 1);
  }
  // Expected 400 of 2000 per company and per role; ±25% is far outside random noise (σ ≈ 18).
  for (const key of ['0', '1', '2', '3', '4', 'backend', 'security', 'qa', 'cto', 'devops']) assert((counts.get(key) ?? 0) > 300 && (counts.get(key) ?? 0) < 500, `${key}: ${counts.get(key)}`);
});
