import type { SlackMessage } from '../shared/observability';

export const NOTICE_VISIBLE = 3, NOTICE_LIFETIME = 9000;
/** One customer complaint on screen, with the moment its own window closes. */
export type Notice = { message: SlackMessage; until: number };

/**
 * The complaints still to announce. `seen` is the history already accounted for, and it is null until the first
 * snapshot actually arrives: "no data yet" is not the same as "data without complaints". Remembering an empty
 * history before any data would make the history that arrives next — on a browser reconnect, for instance — look
 * like news, and drop a pile of old complaints on the team at once.
 */
export function freshComplaints(seen: Set<string> | null, messages: SlackMessage[] | undefined): { seen: Set<string> | null; fresh: SlackMessage[] } {
  if (!messages) return { seen, fresh: [] };
  const complaints = messages.filter(m => m.channel === 'soporte-clientes' && m.source === 'customer');
  if (!seen) return { seen: new Set(complaints.map(m => m.id)), fresh: [] };   // the first data is history, not news
  const fresh = complaints.filter(m => !seen.has(m.id));
  const grown = new Set(seen); for (const m of fresh) grown.add(m.id);
  return { seen: grown, fresh };
}
/** Adds the fresh complaints to the stack, each one carrying its own expiry from the moment it entered. */
export function pushNotices(current: Notice[], fresh: SlackMessage[], now: number): Notice[] {
  return [...current, ...fresh.map(message => ({ message, until: now + NOTICE_LIFETIME }))].slice(-NOTICE_VISIBLE);
}
/** Drops the notices whose own window has closed, leaving the newer ones their remaining time. */
export function dropExpired(current: Notice[], deadline: number): Notice[] {
  return current.filter(n => n.until > deadline);
}
