import { useEffect, useRef, useState } from 'react';
import { ROLE_LABELS } from '../shared/types';
import type { ExecutorReply } from '../shared/executor';
import { useGame } from './store';

const STATE_LABELS: Record<string, string> = { EXECUTED: 'EJECUTADO', PARTIAL: 'EJECUCIÓN PARCIAL', REJECTED: 'RECHAZADO POR EL MOTOR', NEEDS_INPUT: 'FALTA UN DATO', DECLINED: 'SIN EJECUCIÓN', INFORMATION: 'DATOS', NO_OPERATION: 'SIN OPERACIÓN', TECHNICAL_ERROR: 'ERROR TÉCNICO' };
const QUEUE_LABELS: Record<string, string> = { QUEUED: 'EN COLA', RUNNING: 'INTERPRETANDO', COMPLETED: 'CONFIRMANDO' };

/**
 * Secondary execution console. Claude interprets explicit orders of this department and the server executes
 * them; every reply shown here is composed by the server from engine results.
 */
export default function ClaudeExecutor({ active }: { active: boolean }) {
  const s = useGame(v => v.snapshot)!, selection = useGame(v => v.selection), role = s.identity!.role, threadId = `${role}-default`;
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [state, setState] = useState(''), [requestId, setRequestId] = useState(''), [last, setLast] = useState<ExecutorReply>();
  const log = useRef<HTMLDivElement>(null);
  const thread = s.operations?.conversations?.find(t => t.id === threadId);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [thread?.messages.length]);
  useEffect(() => {
    if (!busy) return; let alive = true;
    const poll = async () => { try { const r = await fetch('/api/ai/status'); if (r.ok && alive) { const d = await r.json(); setState(d.requests?.find((a: { id: string; state: string }) => a.id === requestId)?.state ?? 'QUEUED'); } } catch { /* polling is informative only */ } };
    const timer = setInterval(() => void poll(), 800); void poll(); return () => { alive = false; clearInterval(timer); };
  }, [busy, requestId]);
  if (role === 'operator') return null;
  async function submit() {
    const id = crypto.randomUUID(); setRequestId(id); setBusy(true); setError(''); setState('QUEUED');
    try {
      const response = await fetch('/api/ai/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, text, threadId, selection }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? 'Claude no está disponible.');
      setLast(data.reply); setText('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const references = [selection.changeId && `cambio ${selection.changeId}`, selection.nodeId && `bloque ${selection.nodeId}`, selection.serverId && `APP-${selection.serverId}`, selection.draftId && `borrador ${selection.draftId}`].filter(Boolean);
  return <section className="panel claude-executor" aria-label="Ejecutor de órdenes con Claude">
    <div className="panel-title"><span>✳ CLAUDE · ÓRDENES DE {ROLE_LABELS[role].toUpperCase()}</span><span className="label-count">EJECUTOR</span></div>
    <p className="executor-rule">Ejecuta órdenes explícitas de tu departamento. No recomienda, no evalúa y no decide por el equipo.</p>
    <div className="conversation-log" ref={log} aria-live="polite">
      {thread?.messages.map(m => <article key={m.id} className={`message-${m.role}`}><b>{m.role === 'user' ? 'TÚ' : `MOTOR${m.state ? ` · ${STATE_LABELS[m.state] ?? m.state}` : ''}`}</b><p>{m.text}</p></article>)}
      {!thread?.messages.length && <p className="muted">Ejemplo de orden: indicá operación, objeto y valores.</p>}
    </div>
    {last && last.operations.length > 0 && <ul className="executor-operations">{last.operations.map((o, i) => <li key={i} className={o.ok ? 'good-text' : 'bad-text'}>{o.ok ? '✓' : '✗'} {o.message}</li>)}</ul>}
    <form onSubmit={e => { e.preventDefault(); if (text.trim()) void submit(); }}>
      <label>ORDEN<textarea aria-label="Orden para Claude" value={text} maxLength={2000} disabled={!active || busy} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) { e.preventDefault(); void submit(); } }}/></label>
      <div className="button-row"><button className="primary-button small" disabled={!active || busy || !text.trim()}>{busy ? QUEUE_LABELS[state] ?? state : 'EJECUTAR ORDEN'}</button>
        {busy && <button type="button" className="secondary-button" onClick={() => void fetch('/api/ai/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: requestId }) })}>CANCELAR</button>}
        <span className="muted">{references.length ? `Referencia seleccionada: ${references.join(' · ')}` : 'Sin selección'}</span></div>
    </form>
    {error && <p role="alert">{error}</p>}
  </section>;
}
