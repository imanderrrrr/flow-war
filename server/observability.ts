import type { Company, GameState } from '../shared/types.js';
import { OBSERVABILITY_VERSION, type Observation, type JournalCommand, type HistoricalPoint } from '../shared/observability.js';
export const initialObservability = (at = 0) => ({ version: OBSERVABILITY_VERSION, startTick: at, sequence: 0, checkpointAt: at, sampleAt: at - 5 });
type Pending = { closed: GameState[]; events: Observation[]; commands: JournalCommand[]; points: HistoricalPoint[]; checkpoints: { at: number; sequence: number; state: string }[] };
const pending = new WeakMap<GameState, Pending>(), owners = new WeakMap<Company, GameState>(), silent = new WeakSet<GameState>();
const listeners = new WeakMap<GameState, (fact: Observation) => void>();
export function buffer(g: GameState): Pending { let p = pending.get(g); if (!p) { p = { closed: [], events: [], commands: [], points: [], checkpoints: [] }; pending.set(g, p); } return p; }
export function quietHistory(g: GameState) { silent.add(g); }
export function bindObservability(g: GameState, listener?: (fact: Observation) => void) { for (const c of g.companies) owners.set(c, g); if (listener) listeners.set(g, listener); }
export function observe(g: GameState, kind: string, companyId: number | null, data: Record<string, unknown> = {}, refs: string[] = []): Observation {
  const fact = { id: ++g.observability.sequence, at: g.tick, companyId, kind, data, refs };
  if (!silent.has(g)) buffer(g).events.push(fact);
  listeners.get(g)?.(fact); return fact;
}
export function observeCompany(c: Company, kind: string, data: Record<string, unknown>, refs: string[] = []) { const g = owners.get(c); return g && observe(g, kind, c.id, data, refs); }
export function recordInput(g: GameState, input: Omit<JournalCommand, 'id' | 'at'>) { const entry = { ...input, id: ++g.observability.sequence, at: g.tick }; if (!silent.has(g)) buffer(g).commands.push(structuredClone(entry)); }
export function projectHistoryPoint(g: GameState): HistoricalPoint { return { at: g.tick, unserved: g.unserved, companies: g.companies.map(c => ({ id: c.id, customers: c.customers, capital: c.capital, reputation: c.reputation, revenue: c.revenue, errors: c.errors, servers: c.servers, version: c.version, mode: c.serviceMode.mode, queue: c.queue })) }; }
export function sampleHistory(g: GameState) { if (g.tick - g.observability.sampleAt >= 5 || g.status === 'FINISHED') { g.observability.sampleAt = g.tick; if (!silent.has(g)) buffer(g).points.push(projectHistoryPoint(g)); } }
export function checkpoint(g: GameState, serialize: (g: GameState) => string, force = false) { if (silent.has(g)) return; if (force || g.tick - g.observability.checkpointAt >= 60) { g.observability.checkpointAt = g.tick; buffer(g).checkpoints.push({ at: g.tick, sequence: g.observability.sequence, state: serialize(g) }); } }
export function clearBuffer(g: GameState) { pending.delete(g); }

/** Preserve uncommitted facts when the authoritative command state rolls back. */
export function copyHistoryBuffer(from:GameState,to:GameState){const p=buffer(from);pending.set(to,{closed:[...p.closed],events:[...p.events],commands:[...p.commands],points:[...p.points],checkpoints:[...p.checkpoints]});}

/** Only live production evidence needs durable receipt preparation; replays and isolated QA do not. */
export function isLiveEvidence(c:Company){const owner=owners.get(c);return c.traffic.scope!=='qa'&&!!owner&&!silent.has(owner);}
