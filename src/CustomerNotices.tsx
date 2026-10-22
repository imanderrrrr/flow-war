import { useEffect, useRef, useState } from 'react';
import type { SlackMessage } from '../shared/observability';
import { useGame, time } from './store';
import { Icon } from './icons';

const VISIBLE = 3, LIFETIME = 9000;

/**
 * Customer complaints as text-message notices. Same facts FlowSlack already records; shown where the team will
 * look up from what they are doing. Silencing them only hides the notices: the channel keeps every complaint.
 */
export default function CustomerNotices() {
  const messages = useGame(s => s.snapshot?.slack);
  const [shown, setShown] = useState<SlackMessage[]>([]);
  const [muted, setMuted] = useState(() => localStorage.getItem('flow-notices-muted') === 'true');
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => { localStorage.setItem('flow-notices-muted', String(muted)); }, [muted]);
  useEffect(() => {
    const complaints = (messages ?? []).filter(m => m.channel === 'soporte-clientes' && m.source === 'customer');
    // The first snapshot is history, not news: remember it without announcing it.
    if (!seen.current) { seen.current = new Set(complaints.map(m => m.id)); return; }
    const fresh = complaints.filter(m => !seen.current!.has(m.id));
    if (!fresh.length) return;
    for (const m of fresh) seen.current.add(m.id);
    setShown(current => [...current, ...fresh].slice(-VISIBLE));
  }, [messages]);
  useEffect(() => {
    if (!shown.length) return;
    const timer = setTimeout(() => setShown(current => current.slice(1)), LIFETIME);
    return () => clearTimeout(timer);
  }, [shown]);
  if (muted) return <button className="notices-muted" onClick={() => setMuted(false)}><Icon name="mute" size={14}/> QUEJAS SILENCIADAS</button>;
  if (!shown.length) return null;
  return <div className="customer-notices" aria-live="polite" aria-label="Quejas de clientes">
    {shown.map(m => <article key={m.id} className="customer-notice">
      <header><span className="notice-avatar">{m.author.replace(/^Cliente /, '').slice(0, 2).toUpperCase()}</span><b>{m.author}</b><time>{time(m.at)}</time></header>
      <p>{m.text}</p>
    </article>)}
    <button className="text-button notices-silence" onClick={() => { setMuted(true); setShown([]); }}>SILENCIAR</button>
  </div>;
}
