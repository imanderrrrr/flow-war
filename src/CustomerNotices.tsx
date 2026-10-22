import { useEffect, useRef, useState } from 'react';
import { dropExpired, freshComplaints, pushNotices, type Notice } from './notices';
import { useGame, time } from './store';
import { Icon } from './icons';

/**
 * Customer complaints as text-message notices. Same facts FlowSlack already records; shown where the team will
 * look up from what they are doing. Silencing them only hides the notices: the channel keeps every complaint.
 */
export default function CustomerNotices() {
  const messages = useGame(s => s.snapshot?.slack);
  const [shown, setShown] = useState<Notice[]>([]);
  const [muted, setMuted] = useState(() => localStorage.getItem('flow-notices-muted') === 'true');
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => { localStorage.setItem('flow-notices-muted', String(muted)); }, [muted]);
  useEffect(() => {
    const { seen: history, fresh } = freshComplaints(seen.current, messages);
    seen.current = history;
    if (!fresh.length) return;
    const now = Date.now();
    setShown(current => pushNotices(current, fresh, now));
  }, [messages]);
  useEffect(() => {
    if (!shown.length) return;
    // The earliest notice sets the next deadline, so a change in the stack never extends anyone else's 9 s.
    const deadline = shown[0].until;
    const timer = setTimeout(() => setShown(current => dropExpired(current, deadline)), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [shown]);
  if (muted) return <button className="notices-muted" onClick={() => setMuted(false)}><Icon name="mute" size={14}/> QUEJAS SILENCIADAS</button>;
  if (!shown.length) return null;
  return <div className="customer-notices" aria-live="polite" aria-label="Quejas de clientes">
    {shown.map(({ message: m }) => <article key={m.id} className="customer-notice">
      <header><span className="notice-avatar">{m.author.replace(/^Cliente /, '').slice(0, 2).toUpperCase()}</span><b>{m.author}</b><time>{time(m.at)}</time></header>
      <p>{m.text}</p>
    </article>)}
    <button className="text-button notices-silence" onClick={() => { setMuted(true); setShown([]); }}>SILENCIAR</button>
  </div>;
}
