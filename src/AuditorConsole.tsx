import { useState, type CSSProperties } from 'react';
import { CATEGORY_LABELS, CONTROL_CHECK_INFO, type AuditModule, type AuditorView } from '../shared/auditor';
import { useGame, send, number, time } from './store';
import { Icon, Mascot } from './icons';

type Probe = AuditorView['probes'][number];

/** What the probe is doing to the company's system, in words composed by the server from engine facts. */
function Narrative({ probe }: { probe: Probe }) {
  return <ul className="auditor-narrative">{probe.summary.map((line, i) => <li key={i}>{line}</li>)}</ul>;
}

/** Live counters of one prueba de control; the server decides what was contained. */
function Counters({ probe }: { probe: Probe }) {
  return <div className="auditor-counters">
    <div><small>ENVIADAS</small><b>{probe.sent}</b></div>
    <div className="good"><small>CONTENIDAS</small><b>{probe.contained}</b></div>
    <div className="bad"><small>NO CONTENIDAS</small><b>{probe.notContained}</b></div>
    {probe.breached > 0 && <div className="bad"><small>ACCESOS INDEBIDOS</small><b>{probe.breached}</b></div>}
    {probe.served > 0 && <div className="bad"><small>COMPRAS LOGRADAS</small><b>{probe.served}</b></div>}
    {probe.unserved > 0 && <div><small>SIN SERVICIO</small><b>{probe.unserved}</b></div>}
  </div>;
}

/** External auditor (reserve players after the draw): module/control view of the five production releases. */
export default function AuditorConsole() {
  const s = useGame(st => st.snapshot)!, connected = useGame(st => st.connected), view = s.auditor;
  const [companyId, setCompanyId] = useState<number>(), [nodeId, setNodeId] = useState<string>(), [busy, setBusy] = useState(false);
  if (!view) return <main className="auditor"><div className="empty-state"><span className="loading-pixel"/><strong>SINCRONIZANDO…</strong></div></main>;
  const company = view.companies.find(c => c.companyId === companyId) ?? view.companies.find(c => !c.eliminated) ?? view.companies[0];
  const module: AuditModule | undefined = company.modules.find(m => m.nodeId === nodeId);
  const current = view.probes[0], active = current && !current.finished ? current : undefined;
  const wait = Math.max(0, Math.ceil(view.nextAt - s.tick)), running = s.status === 'RUNNING' && connected;
  // During the calm start the wait is the phase itself, not a cooldown (shared/pacing.ts).
  const calm = view.opensAt !== undefined && s.tick < view.opensAt;
  const ready = running && !active && wait === 0 && !busy;
  async function launch(check: string) {
    if (!module) return;
    setBusy(true);
    try { await send('audit.probe', { payload: { companyId: company.companyId, nodeId: module.nodeId, check } }); } finally { setBusy(false); }
  }
  const nameOf = (id: number) => view.companies[id]?.name ?? '—';
  return <main className="auditor">
    <div className="auditor-head">
      <div><span className="eyebrow">FLOW WAR / AUDITORÍA EXTERNA</span><h1><Icon name="shield" size={22}/>Auditor externo</h1></div>
      <button className="text-button" onClick={() => { void fetch('/api/logout', { method: 'POST' }).then(() => window.location.href = '/'); }}>CERRAR SESIÓN <Icon name="exit" size={14}/></button>
    </div>
    <p className="auditor-intro">Elegí una empresa, abrí un módulo en producción y lanzá una prueba de control sobre un control pendiente. La empresa recibe tráfico anómalo simulado durante {view.limits.durationSeconds} s ({view.limits.requests} solicitudes) y su configuración decide qué se contiene. Después esperás {view.limits.cooldownSeconds} s.</p>
    {s.status !== 'RUNNING' && <div className="state-banner"><Icon name="pause" size={14}/>{s.status === 'LOBBY' ? 'ESPERANDO INICIO DE PARTIDA' : s.status === 'FINISHED' ? 'PARTIDA FINALIZADA' : 'SIMULACIÓN EN PAUSA'}</div>}

    <section className={`panel auditor-status ${active ? 'live' : ''}`} aria-live="polite">
      {active ? <>
        <div className="panel-title"><span><i className="green-dot"/> PRUEBA DE CONTROL EN CURSO</span><span>{Math.max(0, Math.ceil(active.endsAt - s.tick))} s</span></div>
        <div className="auditor-status-body">
          <p><b>{nameOf(active.companyId)}</b> · {active.module} · {CONTROL_CHECK_INFO[active.check].control}<br/><span className="muted">Tráfico anómalo simulado: {CATEGORY_LABELS[active.category]}</span></p>
          <div className="auditor-progress"><i style={{ width: `${Math.min(100, active.sent / view.limits.requests * 100)}%` }}/></div>
          <Counters probe={active}/>
          <Narrative probe={active}/>
        </div>
      </> : <>
        <div className="panel-title"><span>{calm ? 'FASE TRANQUILA · LAS PRUEBAS SE HABILITAN EN' : wait > 0 ? 'ESPERA ENTRE PRUEBAS' : 'LISTO PARA AUDITAR'}</span><span>{calm ? time(wait) : wait > 0 ? `${wait} s` : <Icon name="play" size={12}/>}</span></div>
        <div className="auditor-status-body">{current ? <><p className="muted">Última prueba: <b>{nameOf(current.companyId)}</b> · {current.module}</p><Counters probe={current}/><Narrative probe={current}/></> : <p className="muted">Todavía no lanzaste pruebas de control.</p>}</div>
      </>}
    </section>

    <section className="panel">
      <div className="panel-title"><span>1 · EMPRESA</span><span>{view.companies.filter(c => !c.eliminated).length} EN JUEGO</span></div>
      <div className="auditor-companies">{view.companies.map(c => {
        const count = c.modules.reduce((n, m) => n + m.pending.length, 0);
        return <button key={c.companyId} disabled={c.eliminated || c.assembling} aria-pressed={c.companyId === company.companyId} style={{ '--team': c.color } as CSSProperties} onClick={() => { setCompanyId(c.companyId); setNodeId(undefined); }}>
          <Mascot id={c.companyId} color={c.color} size={24}/><strong>{c.name}</strong><small>{c.eliminated ? 'FUERA' : c.assembling ? 'EN MONTAJE · todavía no acepta compras' : `${count} pendientes`}</small>
        </button>; })}</div>
    </section>

    <section className="panel" style={{ '--team': company.color } as CSSProperties}>
      <div className="panel-title"><span>2 · MÓDULOS EN PRODUCCIÓN · {company.name}</span><span>v{company.version}</span></div>
      {company.modules.length ? <ol className="auditor-modules">{company.modules.map(m => <li key={m.nodeId}>
        <button aria-pressed={m.nodeId === nodeId} onClick={() => setNodeId(m.nodeId)}>
          <span>{m.module && <small className="tag">MÓDULO</small>}{m.label}</span><b className={m.pending.length ? 'bad' : 'good'}>{m.pending.length ? `${m.pending.length} pendientes` : 'sin pendientes'}</b>
        </button></li>)}</ol> : <p className="muted auditor-empty">{company.assembling ? 'Esta empresa está en montaje: todavía no acepta compras.' : 'Esta empresa está fuera de la partida.'}</p>}
    </section>

    <section className="panel">
      <div className="panel-title"><span>3 · CONTROLES PENDIENTES</span><span>{module?.label ?? '—'}</span></div>
      {!module ? <p className="muted auditor-empty">Tocá un módulo para ver sus controles pendientes.</p>
        : !module.pending.length ? <p className="muted auditor-empty">Sin controles pendientes en este módulo.</p>
        : <ul className="auditor-pending">{module.pending.map(p => <li key={p.check}>
          <div><p>{p.text}</p><small>Control: <b>{p.control}</b> · Tráfico: {CATEGORY_LABELS[p.category]}</small></div>
          <button className="primary-button small" disabled={!ready} onClick={() => void launch(p.check)}><Icon name="play" size={12}/>{busy ? 'ENVIANDO…' : active ? 'PRUEBA EN CURSO' : calm ? 'FASE TRANQUILA' : wait > 0 ? `EN ESPERA · ${wait} s` : 'LANZAR PRUEBA'}</button>
        </li>)}</ul>}
    </section>

    {view.probes.length > 1 && <section className="panel">
      <div className="panel-title"><span>MIS PRUEBAS</span><span>{view.probes.length}</span></div>
      <ul className="auditor-history">{view.probes.slice(active ? 0 : 1).filter(p => p.finished).map(p => <li key={p.id}>
        <span><b>{nameOf(p.companyId)}</b> · {p.module}</span><span>{number(p.contained)} contenidas · {number(p.notContained)} no contenidas</span>
      </li>)}</ul>
    </section>}
  </main>;
}
