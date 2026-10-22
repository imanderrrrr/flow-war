import { useState } from 'react';
import { TERMINAL_LABELS, STATUS_LABELS, type TerminalReason } from '../shared/types';
import { PRODUCT_CATALOG, PUBLICATION_BASE_COST } from '../shared/product';
import { send, money, number, time, useGame } from './store';

const DRAFT_LABELS: Record<string, string> = { DRAFT: 'BORRADOR', SUBMITTED: 'EN PIPELINE', RETURNED: 'DEVUELTO POR QA', PUBLISHED: 'PUBLICADO', DISCARDED: 'DESCARTADO' };
const pct = (a: number, b: number) => b ? `${Math.round(a / b * 1000) / 10}%` : '—';

/** Observed customer behaviour and a neutral catalog. Producto prepares and submits; it never publishes. */
export default function ProductConsole({ active }: { active: boolean }) {
  const s = useGame(v => v.snapshot)!, c = s.privateCompany!, view = s.operations?.product, setSelection = useGame(v => v.setSelection);
  const [catalogId, setCatalogId] = useState(''), [values, setValues] = useState({ percent: '', duration: '', demandMultiplier: '', budget: '' });
  if (!s.productEnabled || !view?.enabled) return <section className="panel"><div className="state-banner">PRODUCTO / UX NO ESTÁ HABILITADO EN ESTA PARTIDA</div><p className="empty-state">El docente lo habilita antes de iniciar, para las cinco empresas por igual.</p></section>;
  const f = view.funnel.window, item = PRODUCT_CATALOG.find(i => i.id === catalogId);
  const stages: [string, number][] = [['NAVEGACIÓN', f.visits], ['ENTRADA A CHECKOUT', f.checkout], ['COMPRA', f.purchased], ['ABANDONO', f.abandoned], ['RECHAZO', f.rejected]];
  return <div className="product-console">
    <section className="panel"><div className="panel-title"><span>EMBUDO OBSERVADO</span><span>ÚLTIMOS {view.funnel.windowSeconds} S · MUESTRA {number(f.visits)}</span></div>
      <div className="funnel">{stages.map(([label, value]) => <div key={label} className="funnel-stage"><span className="metric-label">{label}</span><b>{number(value)}</b><small>{pct(value, f.visits)} de las visitas</small><i style={{ width: `${f.visits ? Math.min(100, value / f.visits * 100) : 0}%` }}/></div>)}</div>
      <div className="metrics-strip product-metrics">
        <div className="metric"><span className="metric-label">CONVERSIÓN CHECKOUT → COMPRA</span><div>{pct(f.purchased, f.checkout)}</div><span className="metric-sub">{number(f.checkout)} entradas</span></div>
        <div className="metric"><span className="metric-label">EXPERIENCIAS ATENDIDAS</span><div>{pct(view.satisfaction.completed, view.satisfaction.served)}</div><span className="metric-sub">muestra {number(view.satisfaction.sample)}</span></div>
        <div className="metric"><span className="metric-label">FIDELIDAD MEDIA</span><div>{view.satisfaction.loyaltyMean ?? '—'}</div><span className="metric-sub">{number(view.satisfaction.customers)} clientes propios</span></div>
        <div className="metric"><span className="metric-label">ACUMULADO DE LA PARTIDA</span><div>{number(view.funnel.totals.purchased)}</div><span className="metric-sub">compras / {number(view.funnel.totals.visits)} visitas</span></div>
      </div>
      <div className="exit-reasons"><span className="eyebrow">MOTIVOS DE SALIDA OBSERVADOS</span>{Object.entries(f.reasons).length ? Object.entries(f.reasons).sort((a, b) => b[1] - a[1]).map(([r, v]) => <span key={r}>{TERMINAL_LABELS[r as TerminalReason] ?? r}: <b>{number(v)}</b></span>) : <span className="muted">Sin salidas fallidas en la ventana.</span>}</div>
    </section>
    <section className="panel"><div className="panel-title"><span>CATÁLOGO COMERCIAL</span><span>{PRODUCT_CATALOG.length} OPCIONES</span></div>
      <div className="catalog">{PRODUCT_CATALOG.map(i => <article key={i.id} className={`catalog-item ${catalogId === i.id ? 'selected' : ''}`}><button className="text-button" onClick={() => setCatalogId(i.id)}><b>{i.id}</b> · {i.name}</button>
        <p>Público: {i.audience === 'all' ? 'todos los clientes' : 'clientes nuevos'}. Parámetros: {Object.values(i.parameters).map(p => `${p.label.toLowerCase()} ${p.min}–${p.max} ${p.unit}`).join(' · ')}.</p>
        <ul>{i.effects.map(e => <li key={e}>{e}</li>)}</ul></article>)}</div>
      <form className="scope-form" onSubmit={e => { e.preventDefault(); if (!item) return; void send('product.draft', { companyId: c.id, payload: { catalogId: item.id, percent: Number(values.percent), duration: Number(values.duration), demandMultiplier: Number(values.demandMultiplier), budget: Number(values.budget) } }).then(ok => { if (ok) setValues({ percent: '', duration: '', demandMultiplier: '', budget: '' }); }); }}>
        <label>OPCIÓN<select required value={catalogId} onChange={e => setCatalogId(e.target.value)}><option value="" disabled>Elegir</option>{PRODUCT_CATALOG.map(i => <option key={i.id} value={i.id}>{i.id}</option>)}</select></label>
        {item && (Object.entries(item.parameters) as [keyof typeof values, { label: string; min: number; max: number; unit: string }][]).map(([key, p]) => <label key={key}>{p.label.toUpperCase()} ({p.unit})<input type="number" required min={p.min} max={p.max} step={key === 'demandMultiplier' ? .1 : 1} value={values[key]} onChange={e => setValues({ ...values, [key]: e.target.value })}/></label>)}
        <button className="secondary-button" disabled={!active || !item}>GUARDAR BORRADOR</button>
        {item && values.budget && <span className="muted">Costo de publicación {money(PUBLICATION_BASE_COST + Number(values.budget))}</span>}
      </form>
    </section>
    <section className="panel"><div className="panel-title">BORRADORES Y PROPUESTAS</div>
      <ul className="request-list">{view.drafts.slice().reverse().map(d => <li key={d.id}><button className="text-button" onClick={() => setSelection({ draftId: d.id })}><b>{d.id}</b></button> {d.catalogId} · {d.configuration.percent}% · {d.configuration.duration} s · ×{d.configuration.demandMultiplier} · {money(d.configuration.budget)} · {DRAFT_LABELS[d.status]}{d.changeId && ` · ${d.changeId} ${STATUS_LABELS[s.changes.find(ch => ch.id === d.changeId)?.status ?? 'QA_PENDING']}`}
        {d.status === 'DRAFT' && <button className="primary-button small" disabled={!active} onClick={() => void send('product.submit', { companyId: c.id, payload: { draftId: d.id } })}>ENVIAR A QA</button>}</li>)}{!view.drafts.length && <li className="muted">Sin borradores.</li>}</ul>
      <p className="muted">Enviar a QA congela la configuración. La publicación requiere QA, autorización del CTO y despliegue de DevOps.</p>
    </section>
    <section className="panel"><div className="panel-title">HISTORIAL DE CAMPAÑAS Y CAMBIOS PUBLICADOS</div>
      <ol className="release-history">{view.campaigns.slice().reverse().map(cam => <li key={cam.id}><b>{cam.id}</b> {cam.status} · {cam.percent}% · {cam.duration} s · ×{cam.demandMultiplier} · {money(cam.budget)}{cam.activatedAt !== undefined && ` · ${time(cam.activatedAt)}–${time(cam.endsAt ?? cam.activatedAt)}`}{cam.changeId && ` · ${cam.changeId}`}</li>)}{!view.campaigns.length && <li className="muted">Sin campañas.</li>}</ol>
      <ol className="release-history">{view.published.map(p => <li key={p.changeId}><b>{p.changeId}</b> {p.catalogId} · {p.draftId} · producción v{p.version}</li>)}</ol>
    </section>
  </div>;
}
