import { useState } from 'react';
import { STATUS_LABELS } from '../shared/types';
import type { InfraOperation, InfraRequest } from '../shared/operations';
import { send, money, time, useGame } from './store';
import { Icon } from './icons';

/** CTO authority: money, scopes and approvals. No editors, servers, strategies or deploy buttons. */
export default function CtoConsole({ active, onSelect }: { active: boolean; onSelect: (id: string) => void }) {
  const s = useGame(v => v.snapshot)!, c = s.privateCompany!, publicC = s.companies[c.id], infra = s.operations?.infra, w = s.operations?.workflow;
  const [form, setForm] = useState({ amount: '', seconds: '', maxServers: '', requestId: '' }), [ops, setOps] = useState<InfraOperation[]>([]);
  const [target, setTarget] = useState(''), [rollbackAmount, setRollbackAmount] = useState('');
  const act = (type: string, payload: Record<string, unknown>) => send(type, { companyId: c.id, payload });
  const availableNow = w?.available ?? Math.max(0, c.capital - c.reserved - c.infraBudget);
  const incidents = s.events.filter(e => (e.companyId === c.id || e.companyId === null) && e.tone === 'bad').slice(0, 6);
  const inbox = s.changes.filter(ch => ['CTO_PENDING', 'EXPIRED'].includes(ch.status));
  const fill = (r: InfraRequest) => { setForm({ amount: String(r.amount), seconds: String(r.durationSeconds), maxServers: String(r.maxServers), requestId: r.id }); setOps(r.operations); };
  const history = [
    ...(w?.decisions ?? []).map(d => ({ at: d.at, text: `${d.changeId} · ${d.kind} · ${d.actor}${d.cost ? ` · ${money(d.cost)}` : ''}` })),
    ...(infra?.authorizations ?? []).filter(a => a.kind === 'cto').map(a => ({ at: a.at, text: `${a.id} · infraestructura ${money(a.amount)} · ${a.durationSeconds} s · máx. ${a.maxServers} · ${a.status}` })),
    ...(infra?.rollbacks ?? []).map(r => ({ at: r.at, text: `${r.id} · rollback a v${r.targetVersion} · ${money(r.amount)} · ${r.status}` })),
  ].sort((a, b) => b.at - a.at).slice(0, 14);
  return <div className="cto-console">
    <section className="panel"><div className="metrics-strip cto-metrics">
      {[['CAPITAL', money(c.capital)], ['RESERVADO', money(c.reserved)], ['PRESUPUESTO OPERATIVO', money(c.infraBudget)], ['DISPONIBLE', money(availableNow)], ['GASTO OPERATIVO', `Q${(c.servers * .5 * 60).toFixed(2)}/min`], ['REPUTACIÓN', `${Math.round(c.reputation)}/100`], ['MERCADO', `${(publicC.customers / 50).toFixed(1)}%`]].map(([label, value]) => <div className="metric" key={label}><span className="metric-label">{label}</span><div>{value}</div></div>)}
    </div></section>
    <div className="cto-grid">
      <section className="panel"><div className="panel-title">CAMBIOS APROBADOS POR QA</div>{inbox.length ? inbox.map(ch => { const review = w?.decisions.filter(d => d.changeId === ch.id && d.kind === 'qa.approve').at(-1); return <article key={ch.id} className="cto-item"><button className="text-button" onClick={() => onSelect(ch.id)}><b>{ch.id}</b> · {STATUS_LABELS[ch.status]} · costo {money(ch.cost)}</button>{review && <p>QA: {review.reason.slice(0, 280)} · evidencia {review.evidenceIds.join(', ') || '—'} · fallos conocidos {review.failedIds.join(', ') || 'ninguno'}</p>}</article>; }) : <p className="empty-state">Sin cambios pendientes de CTO.</p>}<p className="muted">La decisión se registra con tu motivo escrito en el panel de decisión.</p></section>
      <section className="panel"><div className="panel-title">INCIDENTES OBSERVADOS</div><div className="event-list">{incidents.length ? incidents.map(e => <div key={e.id} className="event-row"><time>{time(e.at)}</time><span className="event-dot bad"/><span>{e.text}</span></div>) : <p className="empty-state">Sin incidentes registrados.</p>}</div>
        <div className="button-row priorities-row"><span className="eyebrow">PRIORIDAD REGISTRADA: {s.operations?.priority === 'security' ? 'SEGURIDAD' : 'CONCURRENCIA'}</span><button className="secondary-button" disabled={!active} onClick={() => void act('cto.prioritize', { incident: 'security' })}><Icon name="shield" size={15}/>SEGURIDAD</button><button className="secondary-button" disabled={!active} onClick={() => void act('cto.prioritize', { incident: 'concurrency' })}><Icon name="code" size={15}/>CONCURRENCIA</button></div></section>
    </div>
    <section className="panel scope-panel"><div className="panel-title"><span>PRESUPUESTO Y ALCANCE DE DEVOPS</span><span>{infra?.scope ? `VIGENTE ${infra.scope.id} · ${Math.max(0, Math.ceil(infra.scope.expires - s.tick))} s` : 'SIN ALCANCE VIGENTE'}</span></div>
      <ul className="request-list">{infra?.requests.filter(r => r.status === 'REQUESTED').map(r => <li key={r.id}><b>{r.id}</b> {money(r.amount)} · {r.durationSeconds} s · máx. {r.maxServers} servidores · {r.operations.join(', ')} · {r.requestedBy}<button className="text-button" disabled={!active} onClick={() => fill(r)}>REVISAR</button><button className="text-button danger" disabled={!active} onClick={() => void act('cto.infra_reject', { requestId: r.id })}>RECHAZAR</button></li>)}{!infra?.requests.some(r => r.status === 'REQUESTED') && <li className="muted">Sin solicitudes pendientes de DevOps.</li>}</ul>
      <form className="scope-form" onSubmit={e => { e.preventDefault(); void act('cto.infra_authorize', { amount: Number(form.amount), durationSeconds: Number(form.seconds), maxServers: Number(form.maxServers), operations: ops, ...(form.requestId ? { requestId: form.requestId } : {}) }).then(ok => { if (ok) { setForm({ amount: '', seconds: '', maxServers: '', requestId: '' }); setOps([]); } }); }}>
        <label>MONTO Q<input type="number" min={0} max={10000} required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}/></label>
        <label>DURACIÓN (S)<input type="number" min={10} max={1500} required value={form.seconds} onChange={e => setForm({ ...form, seconds: e.target.value })}/></label>
        <label>MÁX. SERVIDORES<input type="number" min={1} max={8} required value={form.maxServers} onChange={e => setForm({ ...form, maxServers: e.target.value })}/></label>
        {(['scale', 'balancer'] as const).map(o => <label key={o} className="control-row"><input type="checkbox" checked={ops.includes(o)} onChange={e => setOps(e.target.checked ? [...ops, o] : ops.filter(x => x !== o))}/>{o === 'scale' ? 'ESCALAR' : 'BALANCEADOR'}</label>)}
        <button className="primary-button small" disabled={!active || !ops.length}>{form.requestId ? `AUTORIZAR ${form.requestId}` : 'AUTORIZAR ALCANCE'}</button>
        {form.requestId && <button type="button" className="text-button" onClick={() => setForm({ ...form, requestId: '' })}>SIN SOLICITUD</button>}
      </form>
      <p className="muted">Autorizar mueve el monto del saldo disponible al presupuesto operativo. No escala ni despliega.</p>
    </section>
    <section className="panel scope-panel"><div className="panel-title">AUTORIZACIÓN DE ROLLBACK</div>
      <form className="scope-form" onSubmit={e => { e.preventDefault(); void act('cto.rollback_authorize', { targetVersion: Number(target), amount: Number(rollbackAmount) }).then(ok => { if (ok) { setTarget(''); setRollbackAmount(''); } }); }}>
        <label>VERSIÓN OBJETIVO<select required value={target} onChange={e => setTarget(e.target.value)}><option value="" disabled>Elegir versión</option>{[...new Set(infra?.releases.map(r => r.version) ?? [])].filter(v => v !== c.version).map(v => <option key={v} value={v}>v{v}.0</option>)}</select></label>
        <label>MONTO Q<input type="number" min={1} max={10000} required value={rollbackAmount} onChange={e => setRollbackAmount(e.target.value)}/></label>
        <button className="secondary-button" disabled={!active}>AUTORIZAR ROLLBACK</button>
      </form>
      <p className="muted">Un rollback es un nuevo evento operativo: no restaura dinero, clientes ni reputación. DevOps elige la estrategia y lo ejecuta.</p>
    </section>
    <section className="panel"><div className="panel-title">HISTORIAL DE DECISIONES</div><ol className="release-history">{history.length ? history.map((h, i) => <li key={i}><time>{time(h.at)}</time> {h.text}</li>) : <li className="muted">Sin decisiones registradas.</li>}</ol></section>
  </div>;
}
