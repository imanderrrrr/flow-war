import type { Role } from './types.js';

/**
 * Icons a participant can pick when joining; the slot machine spins them during the team draw.
 * Emoji commonly used with a double meaning (peach, cherries, banana, fire, mushroom…) are deliberately left out.
 */
export const LOBBY_ICONS = ['🍋', '🍉', '🍇', '🍓', '🍍', '🥝', '🍎', '🍀', '🐱', '🐶', '🦊', '🐼', '🐸', '🐵', '🦄', '🐙', '🦖', '🐧', '🐢', '🦉', '🐳', '🚀', '👾', '🤖', '👻', '🎃', '⚡', '🌵', '🎮', '💎'] as const;
export const LOBBY_COMPANIES = 5;
export const NAME_MAX = 20;
export const MAX_PARTICIPANTS = 60;
/** Projector timeline after the draw: an intro, then one window per company, revealed in company order. */
export const REVEAL = { introMs: 1500, companyMs: 7000, firstStopMs: 1800, stopGapMs: 450, namesDelayMs: 400 } as const;

export type LobbyParticipant = { id: string; name: string; icon: string; joinedAt: number; companyId?: number; role?: Role };
export type LobbyFormation = { at: number; roles: Role[]; order: string[] };
export type LobbyState = { id: string; pin: string; createdAt: number; seq: number; participants: LobbyParticipant[]; formation?: LobbyFormation };
export type LobbyMember = { id: string; name: string; icon: string };
export type LobbyView = {
  pin?: string; teamSize: number; required: number; participants: LobbyMember[];
  formation?: { at: number; teams: { companyId: number; members: (LobbyMember & { role: Role })[] }[]; reserve: LobbyMember[] };
};

/** Offset from the draw at which company `index` starts spinning. */
export const companyStart = (index: number) => REVEAL.introMs + index * REVEAL.companyMs;
/** Offset at which reel `reel` of a company stops on its member. */
export const reelStop = (reel: number) => REVEAL.firstStopMs + reel * REVEAL.stopGapMs;
/** Offset from the draw at which the names of company `index` are on screen. */
export const namesShownAt = (index: number, teamSize: number) => companyStart(index) + reelStop(teamSize - 1) + REVEAL.namesDelayMs;
export const revealEnd = () => companyStart(LOBBY_COMPANIES);
