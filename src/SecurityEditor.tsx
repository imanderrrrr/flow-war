import { useEffect, useState } from 'react';
import type { ProtectionRule } from '../shared/collaboration';
import { ReactFlow, Background } from '@xyflow/react';
import type { Change, PrivateCompany } from '../shared/types';
import { send, useGame } from './store';
import { requestClaude } from './ClaudeAssistant';
import { flowNodeTypes } from './GraphEditor';

/** Neutral list of the controls the engine implements, in alphabetical order, with no suggested values. */
const CONTROLS=[{kind:'authenticated',label:'Auth'},{kind:'bot',label:'Bot Detection'},{kind:'origin',label:'IP Block'},{kind:'rate',label:'Rate Limit'},{kind:'owner',label:'Role Check'},{kind:'input',label:'WAF'}] as const;
function ControlEditor({change,nodeId,company,active,rules,revision}:{change:Change;nodeId:string;company:PrivateCompany;active:boolean;rules:ProtectionRule[];revision:number}){
  const has=(kind:string)=>rules.some(r=>r.kind===kind),rate=rules.find(r=>r.kind==='rate') as Extract<ProtectionRule,{kind:'rate'}>|undefined;
  const [enabled,setEnabled]=useState<Record<string,boolean>>(Object.fromEntries(CONTROLS.map(c=>[c.kind,has(c.kind)])));
  const [origins,setOrigins]=useState(rules.filter(r=>r.kind==='origin').map(r=>(r as {origin:string}).origin).join(', '));
  const [limit,setLimit]=useState(rate?String(rate.limit):''),[windowSeconds,setWindowSeconds]=useState(rate?String(rate.windowSeconds):''),[groupBy,setGroupBy]=useState(rate?.groupBy??'');
  function compose():ProtectionRule[]|string{
    const list:ProtectionRule[]=[];
    for(const c of CONTROLS){if(!enabled[c.kind])continue;
      if(c.kind==='origin'){const values=origins.split(/[,\s]+/).filter(Boolean);if(!values.length||values.some(v=>!/^sim-\d{1,3}$/.test(v)))return 'IP Block requiere orígenes sim-N.';for(const origin of values)list.push({kind:'origin',origin});}
      else if(c.kind==='rate'){if(!limit||!windowSeconds||!groupBy)return 'Rate Limit requiere límite, ventana y agrupación.';list.push({kind:'rate',limit:Number(limit),windowSeconds:Number(windowSeconds),groupBy:groupBy as 'origin'|'customer'});}
      else list.push({kind:c.kind});}
    return list;
  }
  const [message,setMessage]=useState('');
  return <fieldset className="control-editor" disabled={!active}><legend>CONTROLES DEL BLOQUE</legend>
    {CONTROLS.map(c=><label key={c.kind} className="control-row"><input type="checkbox" checked={!!enabled[c.kind]} onChange={e=>setEnabled({...enabled,[c.kind]:e.target.checked})}/>{c.label}</label>)}
    {enabled.origin&&<label>ORÍGENES BLOQUEADOS<input value={origins} placeholder="sim-N" onChange={e=>setOrigins(e.target.value)}/></label>}
    {enabled.rate&&<div className="button-row"><label>LÍMITE<input type="number" min={1} max={10000} value={limit} onChange={e=>setLimit(e.target.value)}/></label><label>VENTANA (S)<input type="number" min={1} max={300} value={windowSeconds} onChange={e=>setWindowSeconds(e.target.value)}/></label><label>AGRUPAR POR<select value={groupBy} onChange={e=>setGroupBy(e.target.value as typeof groupBy)}><option value="" disabled>Elegir</option><option value="origin">Origen</option><option value="customer">Cliente</option></select></label></div>}
    <button className="secondary-button" type="button" onClick={async()=>{const next=compose();if(typeof next==='string'){setMessage(next);return;}setMessage('');if(await send('security.configure',{companyId:company.id,payload:{changeId:change.id,nodeId,revision,rules:next}}))setMessage('Controles guardados en el borrador.');}}>GUARDAR CONTROLES</button>
    {message&&<p role="status">{message}</p>}
  </fieldset>;
}
function BlockInspector({change,nodeId,company,active}:{change:Change;nodeId:string;company:PrivateCompany;active:boolean}){
  const s=useGame(s=>s.snapshot)!,draft=s.operations?.collaboration?.reviews[change.id],saved=draft?.blocks[nodeId];
  const [text,setText]=useState(saved?.text??''),[observation,setObservation]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const node=change.graph.nodes.find(n=>n.id===nodeId)!;
  async function save(){setBusy(true);setMessage('');let interpretationId:string|undefined;
    if(text.trim())try{const result=await requestClaude({kind:'security.compile',text,changeId:change.id,nodeId});interpretationId=result.id;if(!result.executable)setMessage('La implementación contiene instrucciones que todavía no pueden interpretarse como comportamiento ejecutable.');}catch(e){setMessage(`${(e as Error).message} El texto puede guardarse como borrador sin interpretar.`);}
    const ok=await send('security.save',{companyId:company.id,payload:{changeId:change.id,nodeId,text,revision:draft?.revision??0,...(interpretationId?{interpretationId}:{})}});if(ok&&!text.trim())setMessage('Borrador guardado.');setBusy(false);
  }
  return <aside className="node-inspector security-inspector"><span className="eyebrow">PROTECCIÓN DE:</span><h3>{node.data.label}</h3><span className="inspector-id">{node.id} · {node.type}</span><p className="muted">Operación {change.graph.nodes.indexOf(node)+1} de {change.graph.nodes.length} · purchase-flow v{change.implementation?.backendVersion}</p><label>INSTRUCCIONES<textarea aria-label={`Protección de ${node.data.label}`} value={text} maxLength={4000} disabled={!active||busy} onChange={e=>setText(e.target.value)}/></label><div className="button-row"><button className="secondary-button" disabled={!active||busy} onClick={()=>{setText(saved?.text??'');setMessage('');}}>CANCELAR</button><button className="primary-button small" disabled={!active||busy} onClick={()=>void save()}>{busy?'GUARDANDO…':'GUARDAR BORRADOR'}</button></div>{message&&<p role="status">{message}</p>}<ControlEditor change={change} nodeId={nodeId} company={company} active={active} rules={saved?.rules??[]} revision={draft?.revision??0}/><label>OBSERVACIÓN PARA BACKEND<textarea aria-label="Observación para Backend" value={observation} maxLength={4000} disabled={!active} onChange={e=>setObservation(e.target.value)}/></label><button className="secondary-button" disabled={!active||!observation.trim()} onClick={async()=>{if(await send('security.correction',{companyId:company.id,payload:{changeId:change.id,nodeId,text:observation}}))setObservation('');}}>SOLICITAR CORRECCIÓN A BACKEND</button>{draft?.observations.filter(o=>o.nodeId===nodeId).map((o,i)=><p key={i}>{o.author}: {o.text}</p>)}</aside>;
}
export default function SecurityEditor({company,active}:{company:PrivateCompany;active:boolean}){
  const s=useGame(s=>s.snapshot)!,changes=s.changes.filter(ch=>ch.implementation),[id,setId]=useState(''),[nodeId,setNodeId]=useState(''),[confirm,setConfirm]=useState(false);
  const change=changes.find(ch=>ch.id===id)??changes[0],draft=change&&s.operations?.collaboration?.reviews[change.id];
  const editable=active&&change?.status==='SECURITY_PENDING';
  if(!change)return <section className="panel"><div className="panel-title">REVISIÓN DE SEGURIDAD</div><p className="empty-state">Esperando una implementación de Backend.</p></section>;
  const node=change.graph.nodes.find(n=>n.id===nodeId);
  return <SecuritySelection changeId={change.id} nodeId={node?.id}><section className="panel node-editor"><div className="editor-topbar"><b>BACKEND → SEGURIDAD</b><select aria-label="Versión Backend a revisar" value={change.id} onChange={e=>{setId(e.target.value);setNodeId('');setConfirm(false);}}>{changes.map(ch=><option value={ch.id} key={ch.id}>{ch.id} · purchase-flow v{ch.implementation!.backendVersion} · {ch.status}</option>)}</select></div><div className="security-editor-body"><div className="editor-flow"><ReactFlow nodes={change.graph.nodes} edges={change.graph.edges} nodeTypes={flowNodeTypes} fitView nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} onNodeClick={(_,n)=>{setNodeId(n.id);setConfirm(false);}} colorMode="dark"><Background gap={20} color="#344052"/></ReactFlow></div>{node?<BlockInspector key={`${change.id}-${node.id}-${draft?.revision??0}`} change={change} nodeId={node.id} company={company} active={!!editable}/>:<aside className="node-inspector"><p>Selecciona un bloque para trabajar en su protección.</p></aside>}</div><div className="editor-bottom"><span>REVISIÓN r{draft?.revision??0} · {change.implementation!.backendAuthor}</span>{confirm?<div className="button-row"><span>Entregar las instrucciones guardadas para pruebas QA.</span><button className="secondary-button" onClick={()=>setConfirm(false)}>CANCELAR</button><button className="primary-button small" disabled={!editable} onClick={async()=>{if(await send('security.submit',{companyId:company.id,payload:{changeId:change.id,revision:draft?.revision??0}}))setConfirm(false);}}>CONFIRMAR ENTREGA A QA</button></div>:<button className="primary-button small" disabled={!editable} onClick={()=>setConfirm(true)}>ENTREGAR REVISIÓN</button>}</div></section></SecuritySelection>;
}
function SecuritySelection({changeId,nodeId,children}:{changeId:string;nodeId?:string;children:React.ReactNode}){
  useEffect(()=>{useGame.getState().setSelection({changeId,nodeId});},[changeId,nodeId]);
  return <>{children}</>;
}
