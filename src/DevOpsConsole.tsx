import { useState } from 'react';
import { STATUS_LABELS, type Change } from '../shared/types';
import { MODE_LABELS } from '../shared/observability';
import type { InfraOperation } from '../shared/operations';
import { send, money, useGame } from './store';
import { Icon } from './icons';
import { GraphViewer } from './GraphEditor';
import { PLAN_PIECES } from '../shared/plan';
import { strategyFor, type Strategy, type StrategyChoice } from './consoleState';

const STRATEGIES = { rolling: { label: 'ROLLING', detail: '6 s · cambia servidores uno por uno · capacidad accesible (n−1)/n; con un servidor, 12%' }, restart: { label: 'RESTART REPLACE', detail: '3 s · capacidad de aplicación cero durante el reemplazo' } } as const;
/** Operating costs are fractions of a quetzal per second; rounding them would misstate the expense. */
const rate = (n: number) => `Q${n.toFixed(2)}/s`;
const SERVICE_LABELS: Record<string, string> = { security: 'SEGURIDAD', web: 'TIENDA WEB', checkout: 'CHECKOUT', inventory: 'INVENTARIO', payment: 'PAGOS' };

/** Factual state per server, derived from the engine: instance status, balancer reachability and real capacity. */
function serverState(instance: { id: number; status: string; readyAt?: number }, balancer: boolean, webRate: number, tick: number, reachable: number) {
  if (instance.status === 'STOPPED') return { label: 'DETENIDO', tone: 'bad', available: false };
  if (instance.status === 'RESTARTING') return { label: `REINICIANDO · ${Math.max(0, Math.ceil((instance.readyAt ?? tick) - tick))} s`, tone: 'warn', available: false };
  if (!balancer && instance.id !== 1) return { label: 'SIN TRÁFICO · SIN BALANCEADOR', tone: 'warn', available: false };
  if (webRate <= 0 || reachable === 0) return { label: 'SIN CAPACIDAD', tone: 'bad', available: false };
  return { label: 'ONLINE', tone: 'good', available: true };
}

export default function DevOpsConsole({ active, change, changes, onSelect }: { active: boolean; change?: Change; changes: Change[]; onSelect: (id: string) => void }) {
  const s = useGame(v => v.snapshot)!, c = s.privateCompany!, infra = s.operations?.infra, w = s.operations?.workflow;
  // Keyed by the change (and by the rollback authorization): the console stays mounted while changes
  // come and go, so a strategy picked for one deploy must never show up preselected on the next.
  const [deployChoice, setDeployChoice] = useState<StrategyChoice>(null), [rollbackChoice, setRollbackChoice] = useState<StrategyChoice>(null);
  const [amount, setAmount] = useState(''), [seconds, setSeconds] = useState(''), [maxServers, setMaxServers] = useState(''), [ops, setOps] = useState<InfraOperation[]>([]);
  const act = (type: string, payload: Record<string, unknown>, changeId?: string) => send(type, { companyId: c.id, ...(changeId ? { changeId } : {}), payload });
  const queues = Object.fromEntries(c.traffic.queues.map(q => [q.id, q])), web = queues.web?.rate ?? 0;
  const reachable = c.infrastructure.instances.filter(i => i.status === 'UP' && (c.balancer || i.id === 1)).length;
  const scope = infra?.scope, deploying = s.changes.find(ch => ch.status === 'DEPLOYING'), rollingBack = infra?.rollbacks.find(r => r.status === 'IN_PROGRESS');
  const rollback = infra?.rollbacks.filter(r => r.status === 'AUTHORIZED').at(-1);
  const strategy = change?.status === 'AUTHORIZED' ? strategyFor(deployChoice, change.id) : '', rollbackStrategy = strategyFor(rollbackChoice, rollback?.id);
  const scaleBlocked = !scope ? 'SIN AUTORIZACIÓN' : !scope.operations.includes('scale') ? 'ESCALAR NO AUTORIZADO' : '';
  const balancerBlocked = !scope ? 'SIN AUTORIZACIÓN' : !scope.operations.includes('balancer') ? 'BALANCEADOR NO AUTORIZADO' : '';
  const runs = w?.runs.filter(r => r.changeId === change?.id) ?? [], decision = w?.decisions.filter(d => d.changeId === change?.id).at(-1);
  return <div className="devops-console">
    <section className="panel infra-panel">
      <div className="panel-title"><span><Icon name="server" size={15}/> INFRAESTRUCTURA EN PRODUCCIÓN</span><span>v{c.version}.0 · {MODE_LABELS[c.serviceMode.mode]}</span></div>
      <div className="infra-visual infra-topology" aria-label="Topología de infraestructura">
        <div className="topology-node"><Icon name="arrow" size={22}/><strong>ENTRADA</strong><span>{Math.round(queues.security?.rate ?? 0)} sol/s seguridad</span></div>
        <div className="infra-connector"/>
        <div className={`balancer-node ${c.balancer ? 'enabled' : ''}`}><Icon name="arena" size={26}/><strong>BALANCEADOR</strong><span>{c.balancer ? 'ACTIVO · REPARTE CARGA' : 'INACTIVO · SOLO APP-01'}</span></div>
        <div className="infra-connector"/>
        <div className="plan-piece-heading"><strong>{PLAN_PIECES.server.label.toUpperCase()}</strong><span>{PLAN_PIECES.server.text}</span></div>
        <div className="servers">{c.infrastructure.instances.map(instance => { const st = serverState(instance, c.balancer, web, s.tick, reachable); const share = st.available && reachable ? 1 / reachable : 0;
          return <div className={`server-node ${st.tone}`} key={instance.id} aria-label={`Servidor ${instance.id}: ${st.label}`}><Icon name="server" size={30}/><b>APP-{String(instance.id).padStart(2, '0')}</b><span className={`server-state ${st.tone}`}>{st.label}</span>
            <small>CAPACIDAD {st.available ? `${(web * share).toFixed(1)} web/s · ${((queues.checkout?.rate ?? 0) * share).toFixed(1)} checkout/s` : '0 sol/s'}</small>
            <small>HOSPEDA tienda web y checkout</small>
            <small>UTILIZACIÓN {st.available ? `${Math.round(c.utilization * 100)}%` : '—'}</small><small>COSTO {rate(0.5)}</small>
            <div className="button-row">{instance.status === 'UP' && <button className="text-button" disabled={!active} onClick={() => void act('infra.restart', { serverId: instance.id, duration: 10 })}>REINICIAR</button>}
              {instance.status === 'UP' && <button className="text-button" disabled={!active} onClick={() => void act('infra.server_stop', { serverId: instance.id })}>DETENER</button>}
              {instance.status === 'STOPPED' && <button className="text-button" disabled={!active} onClick={() => void act('infra.server_start', { serverId: instance.id })}>INICIAR</button>}</div></div>; })}</div>
        <div className="infra-connector"/>
        <div className="services-stack">{c.traffic.queues.filter(q => q.id !== 'security').map(q => <div key={q.id} className={`service-chip ${q.rate > 0 ? 'good' : 'bad'}`}><b>{SERVICE_LABELS[q.id]}</b><span>{q.rate > 0 ? `${q.rate.toFixed(1)} sol/s` : c.infrastructure.stoppedServices.includes(q.id) ? 'DETENIDO' : 'SIN CAPACIDAD'}</span><small>cola {q.depth}/{q.capacity}</small></div>)}</div>
      </div>
      <div className="infra-actions">
        <div className="button-row">
          <button className="secondary-button" disabled={!active || c.servers <= 1 || !!scaleBlocked} onClick={() => void act('infra.scale', { delta: -1 })}>−1 SERVER</button>
          <button className="primary-button small" disabled={!active || !!scaleBlocked || c.servers >= (scope?.maxServers ?? 1)} onClick={() => void act('infra.scale', { delta: 1 })}>+1 SERVER</button>
          <button className="secondary-button" disabled={!active || !!balancerBlocked} onClick={() => void act('infra.balancer', { enabled: !c.balancer })}>{c.balancer ? 'DESACTIVAR' : 'ACTIVAR'} BALANCEADOR</button>
        </div>
        <span className="muted">{scaleBlocked || (c.servers >= (scope?.maxServers ?? 1) ? `MÁXIMO AUTORIZADO ${scope?.maxServers ?? 1}` : '')} {balancerBlocked && `· ${balancerBlocked}`} · {c.servers} APROVISIONADOS · {reachable} ACCESIBLES · COSTO {rate(infra?.costPerSecond ?? c.servers * .5)} · PRESUPUESTO OPERATIVO {money(c.infraBudget)}{c.infraBudget <= 0 ? ' · PRESUPUESTO AGOTADO' : ''}</span>
      </div>
    </section>

    <section className="panel scope-panel">
      <div className="panel-title"><span>ALCANCE PRESUPUESTARIO AUTORIZADO POR CTO</span><span>{scope ? `${scope.id} · vence en ${Math.max(0, Math.ceil(scope.expires - s.tick))} s` : 'SIN AUTORIZACIÓN VIGENTE'}</span></div>
      <p className="scope-summary">{scope ? `Operaciones: ${scope.operations.map(o => o === 'scale' ? 'escalar' : 'balanceador').join(', ') || 'ninguna'} · máximo ${scope.maxServers} servidores · monto ${money(scope.amount)}` : 'DevOps no puede escalar ni configurar el balanceador hasta que el CTO autorice un alcance.'}</p>
      <form className="scope-form" onSubmit={e => { e.preventDefault(); void act('infra.request_budget', { amount: Number(amount), durationSeconds: Number(seconds), maxServers: Number(maxServers), operations: ops }).then(ok => { if (ok) { setAmount(''); setSeconds(''); setMaxServers(''); setOps([]); } }); }}>
        <label>MONTO Q<input type="number" min={1} max={10000} required value={amount} onChange={e => setAmount(e.target.value)}/></label>
        <label>DURACIÓN (S)<input type="number" min={10} max={1500} required value={seconds} onChange={e => setSeconds(e.target.value)}/></label>
        <label>MÁX. SERVIDORES<input type="number" min={1} max={8} required value={maxServers} onChange={e => setMaxServers(e.target.value)}/></label>
        {(['scale', 'balancer'] as const).map(o => <label key={o} className="control-row"><input type="checkbox" checked={ops.includes(o)} onChange={e => setOps(e.target.checked ? [...ops, o] : ops.filter(x => x !== o))}/>{o === 'scale' ? 'ESCALAR' : 'BALANCEADOR'}</label>)}
        <button className="secondary-button" disabled={!active || !ops.length}>SOLICITAR AL CTO</button>
      </form>
      <ul className="request-list">{infra?.requests.slice().reverse().map(r => <li key={r.id}><b>{r.id}</b> {money(r.amount)} · {r.durationSeconds} s · máx. {r.maxServers} · {r.operations.join(', ')} · <span className={r.status === 'AUTHORIZED' ? 'good-text' : r.status === 'REJECTED' ? 'bad-text' : ''}>{r.status === 'REQUESTED' ? 'PENDIENTE' : r.status === 'AUTHORIZED' ? 'AUTORIZADA' : 'RECHAZADA'}</span></li>)}</ul>
    </section>

    <section className="panel staging-panel">
      <div className="panel-title"><span>STAGING · ARTEFACTO PROBADO</span><select aria-label="Cambio en staging" value={change?.id ?? ''} onChange={e => onSelect(e.target.value)}>{!changes.length && <option value="">Sin cambios</option>}{changes.map(ch => <option key={ch.id} value={ch.id}>{ch.id} · {STATUS_LABELS[ch.status]}</option>)}</select></div>
      {change ? <div className="staging-body">
        <dl className="staging-facts">{[['CAMBIO', `${change.id} · ${change.domain}`], ['REVISIÓN', `Backend v${change.implementation?.backendVersion ?? '—'} · Seguridad r${change.implementation?.security?.revision ?? '—'}`], ['VERSIÓN BASE', `v${change.baseVersion}.0 (producción v${c.version}.0)`], ['ESTADO', STATUS_LABELS[change.status]], ['AUTORIZACIÓN CTO', change.status === 'AUTHORIZED' ? `vigente ${Math.max(0, Math.ceil((change.expires ?? 0) - s.tick))} s · reservado ${money(change.reserved)}` : decision ? `${decision.kind} · ${decision.actor}` : 'sin decisión'], ['COSTO DE PUBLICACIÓN', money(change.cost)]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <GraphViewer key={change.id} graph={change.graph} plan={change.domain === 'plan'}/>
        <div className="staging-evidence"><span className="eyebrow">EVIDENCIA QA</span>{runs.length ? runs.map(r => { const report = change.reports.find(x => x.testEvidence?.runId === r.id); return <p key={r.id}><b>{r.id}</b> {r.scenario.suite} · {report ? `${report.requests} solicitudes · ${report.completed} completadas · ${report.rejected} rechazadas · ${report.oversold} sobreventas · ${report.duplicates} cobros duplicados · ${report.latency} ms` : 'en curso'}</p>; }) : change.reports.length ? change.reports.map((r, i) => <p key={i}><b>{r.suite}</b> {r.requests} solicitudes · {r.completed} completadas · {r.oversold} sobreventas</p>) : <p className="muted">Sin pruebas registradas.</p>}</div>
        <p className="muted">Staging ejecuta copias aisladas del motor; no genera dinero, clientes ni ventas de la empresa.</p>
      </div> : <div className="empty-state"><Icon name="server" size={34}/><strong>0 CAMBIOS</strong></div>}
    </section>

    <section className="panel deploy-panel">
      <div className="panel-title"><span>DESPLIEGUE</span><span>{deploying ? `${deploying.id} · DESPLEGANDO` : rollingBack ? `ROLLBACK A v${rollingBack.targetVersion} EN CURSO` : `VERSIÓN ACTIVA v${c.version}.0`}</span></div>
      <div className="deploy-actions">
        <label>ESTRATEGIA<select value={strategy} disabled={change?.status !== 'AUTHORIZED'} onChange={e => change && setDeployChoice({ changeId: change.id, strategy: e.target.value as Strategy })}><option value="" disabled>Elegir estrategia</option>{(Object.keys(STRATEGIES) as (keyof typeof STRATEGIES)[]).map(k => <option key={k} value={k}>{STRATEGIES[k].label}</option>)}</select></label>
        <span className="muted">{strategy ? STRATEGIES[strategy].detail : 'Sin estrategia elegida.'}</span>
        <button className="primary-button small" disabled={!active || change?.status !== 'AUTHORIZED' || !strategy} onClick={() => change && void act('deploy.start', { strategy }, change.id).then(ok => { if (ok) setDeployChoice(null); })}><Icon name="play" size={14}/>{change?.status === 'DEPLOYING' ? 'DESPLEGANDO…' : `DEPLOY ${change?.id ?? ''}`}</button>
      </div>
      <div className="deploy-actions rollback-actions">
        <span><b>ROLLBACK</b> {rollback ? `${rollback.id} · a v${rollback.targetVersion} · ${money(rollback.amount)} · vence en ${Math.max(0, Math.ceil(rollback.expires - s.tick))} s` : 'SIN AUTORIZACIÓN DE ROLLBACK'}</span>
        <label>ESTRATEGIA<select value={rollbackStrategy} onChange={e => rollback && setRollbackChoice({ changeId: rollback.id, strategy: e.target.value as Strategy })} disabled={!rollback}><option value="" disabled>Elegir estrategia</option>{(Object.keys(STRATEGIES) as (keyof typeof STRATEGIES)[]).map(k => <option key={k} value={k}>{STRATEGIES[k].label}</option>)}</select></label>
        <button className="secondary-button" disabled={!active || !rollback || !rollbackStrategy} onClick={() => rollback && void act('deploy.rollback', { strategy: rollbackStrategy, authorizationId: rollback.id }).then(ok => { if (ok) setRollbackChoice(null); })}>EJECUTAR ROLLBACK</button>
      </div>
      <ol className="release-history">{infra?.releases.slice().reverse().map(r => <li key={`${r.version}-${r.at}`}><b>v{r.version}.0</b> {r.kind === 'initial' ? 'inicial' : r.kind === 'deploy' ? `deploy ${r.changeId}` : `rollback a v${r.rollbackOf}`} · {Math.floor(r.at)} s</li>)}</ol>
    </section>
  </div>;
}
