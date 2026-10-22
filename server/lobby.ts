import { randomInt } from 'node:crypto';
import { ROLES, type GameState, type Identity, type Role } from '../shared/types.js';
import { LOBBY_COMPANIES, LOBBY_ICONS, MAX_PARTICIPANTS, NAME_MAX, type LobbyParticipant, type LobbyState, type LobbyView } from '../shared/lobby.js';
import { productEnabled } from './product.js';

/** Uniform integer in [0, n). Draws use the OS generator, never the engine seed, so the economy stays reproducible. */
export type Random = (n: number) => number;
const secure: Random = n => randomInt(n);

/** What a participant session stores instead of an identity; the role is resolved from the current draw. */
export type ParticipantRef = { participant: string; lobby: string };
export const isParticipantRef = (v: unknown): v is ParticipantRef => typeof v === 'object' && v !== null && typeof (v as ParticipantRef).participant === 'string' && typeof (v as ParticipantRef).lobby === 'string';

export class LobbyError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}

export const activeRoles = (g: GameState): Role[] => ROLES.filter(r => r !== 'product' || productEnabled(g));

export function ensureLobby(g: GameState, random: Random = secure, now = Date.now()): boolean {
  if (g.lobby) return false;
  g.lobby = { id: `L${now.toString(36)}${random(2 ** 30).toString(36)}`, pin: String(100000 + random(900000)), createdAt: now, seq: 0, participants: [] };
  return true;
}

/** The room accepts players only before the draw and while the game waits in the lobby. */
function open(g: GameState): LobbyState {
  if (!g.lobby || g.status !== 'LOBBY') throw new LobbyError('ROOM_CLOSED', 'La sala no está recibiendo jugadores.');
  if (g.lobby.formation) throw new LobbyError('TEAMS_FORMED', 'Los equipos ya se formaron.');
  return g.lobby;
}

export function checkPin(g: GameState, pin: unknown): LobbyState {
  const lobby = open(g);
  if (typeof pin !== 'string' || pin.replace(/\s/g, '') !== lobby.pin) throw new LobbyError('BAD_PIN', 'PIN incorrecto.', 401);
  return lobby;
}

export function cleanName(raw: unknown): string {
  return typeof raw === 'string' ? raw.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim() : '';
}
const nameKey = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function joinLobby(g: GameState, input: { pin?: unknown; name?: unknown; icon?: unknown }, now = Date.now()): LobbyParticipant {
  const lobby = checkPin(g, input.pin), name = cleanName(input.name);
  if (!name || [...name].length > NAME_MAX) throw new LobbyError('BAD_NAME', `Escribí un nombre de 1 a ${NAME_MAX} caracteres.`, 400);
  if (typeof input.icon !== 'string' || !(LOBBY_ICONS as readonly string[]).includes(input.icon)) throw new LobbyError('BAD_ICON', 'Elegí uno de los iconos.', 400);
  if (lobby.participants.some(p => nameKey(p.name) === nameKey(name))) throw new LobbyError('NAME_TAKEN', 'Ese nombre ya está en la sala.');
  if (lobby.participants.length >= MAX_PARTICIPANTS) throw new LobbyError('ROOM_FULL', 'La sala está llena.');
  const participant: LobbyParticipant = { id: `P${++lobby.seq}`, name, icon: input.icon, joinedAt: now };
  lobby.participants.push(participant);
  return participant;
}

/** Leaving or removal is possible only before the draw; afterwards every seat belongs to a team or the reserve. */
export function removeParticipant(g: GameState, id: unknown): void {
  const lobby = open(g), index = lobby.participants.findIndex(p => p.id === id);
  if (index < 0) throw new LobbyError('NOT_FOUND', 'Ese jugador ya no está en la sala.', 404);
  lobby.participants.splice(index, 1);
}

function shuffle<T>(items: T[], random: Random): T[] {
  for (let i = items.length - 1; i > 0; i--) { const j = random(i + 1); [items[i], items[j]] = [items[j], items[i]]; }
  return items;
}

/**
 * Draws one full team per company: who plays for which company and which role each one takes are both random.
 * Players beyond the five teams stay in the reserve without a role.
 */
export function formTeams(g: GameState, random: Random = secure, now = Date.now()): void {
  const lobby = open(g), roles = activeRoles(g), required = roles.length * LOBBY_COMPANIES;
  if (lobby.participants.length < required) throw new LobbyError('NOT_ENOUGH', `Se necesitan ${required} jugadores para formar los equipos; hay ${lobby.participants.length}.`);
  const drawn = shuffle([...lobby.participants], random).slice(0, required);
  for (let c = 0; c < LOBBY_COMPANIES; c++) {
    const seats = shuffle([...roles], random);
    drawn.slice(c * roles.length, (c + 1) * roles.length).forEach((p, i) => { p.companyId = c; p.role = seats[i]; });
  }
  lobby.formation = { at: now, roles, order: drawn.map(p => p.id) };
}

/** A room reset keeps the PIN and the players and returns them to the lobby for a new draw. */
export function resetTeams(g: GameState): void {
  if (!g.lobby) return;
  delete g.lobby.formation;
  for (const p of g.lobby.participants) { delete p.companyId; delete p.role; }
}

/** Teams can be adjusted only after the draw and before the game starts. */
function drawn(g: GameState): LobbyState & { formation: NonNullable<LobbyState['formation']> } {
  if (!g.lobby?.formation) throw new LobbyError('NO_TEAMS', 'Primero hay que formar los equipos.');
  if (g.status !== 'LOBBY') throw new LobbyError('GAME_STARTED', 'El juego ya empezó; los equipos quedaron fijos.');
  return g.lobby as LobbyState & { formation: NonNullable<LobbyState['formation']> };
}
function seat(p: LobbyParticipant, companyId: number | undefined, role: Role | undefined) {
  if (companyId === undefined || !role) { delete p.companyId; delete p.role; } else { p.companyId = companyId; p.role = role; }
}
/** Exchanges the company and role of two players; a reserve player takes the other's seat and the other goes to the reserve. */
function exchange(lobby: LobbyState & { formation: NonNullable<LobbyState['formation']> }, a: LobbyParticipant, b: LobbyParticipant) {
  const first = { companyId: a.companyId, role: a.role };
  seat(a, b.companyId, b.role); seat(b, first.companyId, first.role);
  // The board lists seated players in draw order; the newcomer takes the place of whoever left the team.
  const order = lobby.formation.order, ia = order.indexOf(a.id), ib = order.indexOf(b.id);
  if (ia >= 0 && ib < 0) order[ia] = b.id; else if (ib >= 0 && ia < 0) order[ib] = a.id;
}
const participant = (lobby: LobbyState, id: unknown) => {
  const p = lobby.participants.find(x => x.id === id);
  if (!p) throw new LobbyError('NOT_FOUND', 'Ese jugador ya no está en la sala.', 404);
  return p;
};
export type SeatChange = { player: LobbyParticipant; from: { companyId?: number; role?: Role }; to: { companyId?: number; role?: Role } };
const change = (p: LobbyParticipant, from: { companyId?: number; role?: Role }): SeatChange => ({ player: p, from, to: { companyId: p.companyId, role: p.role } });
const seatOf = (p: LobbyParticipant) => ({ companyId: p.companyId, role: p.role });

/**
 * Moves a player to a company. A random member of that company takes the player's old seat (company and role, or
 * the reserve), so every company keeps exactly one player per role.
 */
export function movePlayer(g: GameState, playerId: unknown, companyId: unknown, random: Random = secure): SeatChange[] {
  const lobby = drawn(g), p = participant(lobby, playerId);
  if (typeof companyId !== 'number' || !Number.isInteger(companyId) || companyId < 0 || companyId >= LOBBY_COMPANIES) throw new LobbyError('BAD_COMPANY', 'Empresa no válida.', 400);
  if (p.companyId === companyId) throw new LobbyError('SAME_COMPANY', `${p.name} ya está en ${g.companies[companyId].name}.`);
  const members = lobby.participants.filter(m => m.companyId === companyId), other = members[random(members.length)];
  const before = [seatOf(p), seatOf(other)];
  exchange(lobby, p, other);
  return [change(p, before[0]), change(other, before[1])];
}
/** Exchanges the seats of two players (company and role). */
export function swapPlayers(g: GameState, firstId: unknown, secondId: unknown): SeatChange[] {
  const lobby = drawn(g), a = participant(lobby, firstId), b = participant(lobby, secondId);
  if (a.id === b.id) throw new LobbyError('SAME_PLAYER', 'Indicá dos jugadores distintos.', 400);
  if (a.companyId === undefined && b.companyId === undefined) throw new LobbyError('BOTH_RESERVE', `${a.name} y ${b.name} están los dos en la reserva.`);
  const before = [seatOf(a), seatOf(b)];
  exchange(lobby, a, b);
  return [change(a, before[0]), change(b, before[1])];
}

export function participantOf(g: GameState, ref: ParticipantRef): LobbyParticipant | undefined {
  return g.lobby?.id === ref.lobby ? g.lobby.participants.find(p => p.id === ref.participant) : undefined;
}

/** A drawn participant acts with the same identity as that company role's credential. */
export function participantIdentity(g: GameState, ref: ParticipantRef): Identity | null {
  const p = participantOf(g, ref);
  return p && p.companyId !== undefined && p.role ? { id: `${p.companyId}-${p.role}`, role: p.role, companyId: p.companyId } : null;
}

/** Names, icons and teams are public while the room waits; the PIN and the teams during play are for the teacher. */
export function lobbyView(g: GameState, identity: Identity | null): LobbyView | undefined {
  const lobby = g.lobby, operator = identity?.role === 'operator';
  if (!lobby || (!operator && g.status !== 'LOBBY')) return undefined;
  const roles = lobby.formation?.roles ?? activeRoles(g), byId = new Map(lobby.participants.map(p => [p.id, p]));
  const member = (p: LobbyParticipant) => ({ id: p.id, name: p.name, icon: p.icon });
  const formation = lobby.formation;
  return {
    ...(operator ? { pin: lobby.pin } : {}), teamSize: roles.length, required: roles.length * LOBBY_COMPANIES, participants: lobby.participants.map(member),
    ...(formation ? { formation: {
      at: formation.at,
      teams: Array.from({ length: LOBBY_COMPANIES }, (_, companyId) => ({ companyId, members: formation.order.map(id => byId.get(id)).filter((p): p is LobbyParticipant => p?.companyId === companyId).map(p => ({ ...member(p), role: p.role! })) })),
      reserve: lobby.participants.filter(p => p.companyId === undefined).map(member),
    } } : {}),
  };
}
