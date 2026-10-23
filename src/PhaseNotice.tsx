import { useState } from 'react';
import { useGame, time } from './store';
import { Icon } from './icons';

/**
 * The calm start's notices (shared/pacing.ts), on every screen of a running game: when it starts and a minute
 * before each phase change. They say what the schedule does, never what to decide. ENTENDIDO hides one notice.
 */
export default function PhaseNotice() {
  const s = useGame(state => state.snapshot);
  const [closed, setClosed] = useState<string[]>([]);
  const notice = s?.phase?.notice, key = notice && `${s.generation}:${notice.key}`;
  if (!s || !notice || !key || s.status === 'LOBBY' || s.status === 'FINISHED' || closed.includes(key)) return null;
  return <aside className={`phase-notice ${s.phase!.phase}`} role="status" aria-live="polite">
    <Icon name="clock" size={18}/>
    <div>
      <strong>{notice.title}{notice.countdownTo !== undefined && <span> · EN {time(Math.max(0, notice.countdownTo - s.tick))}</span>}</strong>
      <p>{notice.text}</p>
    </div>
    <button className="text-button" onClick={() => setClosed(list => [...list, key])}>ENTENDIDO</button>
  </aside>;
}
