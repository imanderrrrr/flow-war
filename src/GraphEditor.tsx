import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, Handle, Position, addEdge, applyNodeChanges, applyEdgeChanges, useReactFlow, type Connection, type Node, type Edge, type NodeProps, type NodeChange, type EdgeChange } from '@xyflow/react';
import { BLOCKS, type Graph, type PrivateCompany, type Role } from '../shared/types';
import { PLAN_PIECES, PLAN_PIECE_TYPES, PLAN_SLOTS, planPublicationCost, type PlanPiece } from '../shared/plan';
import { addPiece, boardSlots, connect, removePiece } from './planBoard';
import type { BlockConfiguration } from '../shared/blocks';
import { send, money, useGame } from './store';
import { Icon } from './icons';

function PixelNode({ data, selected, type }: NodeProps) {
  const fixed=['entry','exit','read','write','payment'].includes(type??'');
  return <div className={`pixel-flow-node ${selected?'selected':''} ${fixed?'fixed':''}`}>
    {type!=='entry'&&<Handle type="target" position={Position.Left}/>}
    <div className="node-type"><Icon name={type==='entry'||type==='exit'?'arrow':type==='auth'||type==='waf'?'shield':'chip'} size={13}/>{fixed?'SERVICE':'MODULE'}</div>
    <strong>{String(data.label)}</strong><span>{data.config?'CONFIGURADO':data.value!=null?`CONFIG · ${data.value}`:type==='entry'?'INBOUND REQUEST':type==='exit'?'HTTP RESPONSE':'PRODUCTION SERVICE'}</span>
    {type!=='exit'&&<Handle type="source" position={Position.Right}/>}
  </div>;
}
export const flowNodeTypes=Object.fromEntries(['entry','exit','read','write','payment',...BLOCKS.backend.map(b=>b.type),...BLOCKS.security.map(b=>b.type)].map(t=>[t,PixelNode]));
const defaultEdgeOptions={ type:'smoothstep', style:{ stroke:'#8e9aaf',strokeWidth:2 } };

function PlanPieceNode({ data, selected, type }: NodeProps) {
  const piece=PLAN_PIECES[type as PlanPiece],mine=Boolean(data.mine);
  return <div className={`plan-node ${selected?'selected':''} ${mine?'mine':'theirs'}`} title={piece.text}>
    {type!=='entry'&&<Handle type="target" position={Position.Left}/>}
    <div className="node-type"><Icon name={type==='security'?'shield':type==='entry'||type==='exit'?'arrow':'chip'} size={13}/>{mine?'TU PIEZA':'OTRO ROL'}</div>
    <strong>{piece.label}</strong><span>{piece.text}</span>
    {type!=='exit'&&<Handle type="source" position={Position.Right}/>}
  </div>;
}
/** An empty solar: it says what the company loses without the piece, never what to do about it.
 * A solar of your own is a real button, so it answers to the keyboard as well as to the mouse. */
function PlanGhostNode({ data }: NodeProps) {
  const piece=PLAN_PIECES[data.piece as PlanPiece],mine=Boolean(data.mine);
  const body=<><div className="node-type"><Icon name="plus" size={13}/>SOLAR VACÍO</div><strong>{piece.label}</strong><span>{String(data.reason)}</span></>;
  if(!mine)return <div className="plan-node ghost theirs">{body}</div>;
  return <button type="button" className="plan-node ghost mine nodrag nopan" onClick={()=>(data.onPlace as ()=>void)?.()}>{body}</button>;
}
/** The server bay is never drawn from the graph: capacity lives in company.servers, which DevOps
 * scales from its own console. The bay shows that truth so the board matches the company. */
function PlanServerNode({ data }: NodeProps) {
  const count=Number(data.count);
  return <div className={`plan-node servers ${data.mine?'mine':'theirs'}`}>
    <div className="node-type"><Icon name="server" size={13}/>{data.mine?'TUS MÁQUINAS':'INFRAESTRUCTURA'}</div>
    <strong>{PLAN_PIECES.server.label} ×{count}</strong><span>{PLAN_PIECES.server.text}</span>
  </div>;
}
export const planNodeTypes={...Object.fromEntries(PLAN_PIECE_TYPES.map(t=>[t,PlanPieceNode])),ghost:PlanGhostNode,servers:PlanServerNode};

/** The service plan: fixed solares, roads the team draws, and each role moving only its own pieces. */
function PlanEditor({ company:c, role, active }: { company: PrivateCompany; role: Role; active: boolean }) {
  const draft=c.planDrafts?.[role];
  const [plan,setPlan]=useState<Graph>(structuredClone(draft?.graph??c.plan));
  const servers=c.servers;
  const [selected,setSelected]=useState<string|null>(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false);
  const [openPiece,setOpenPiece]=useState<'inventory'|'payment'|null>(null);
  // The block editor keeps honouring the workflow's backend lock, as it did when App.tsx opened it.
  const backendLocked=useGame(s=>Boolean(s.snapshot?.operations?.workflow?.backendLock));
  const revision=useRef(draft?.revision??0);
  const reload=useCallback(()=>{const next=draft?.graph??c.plan;setPlan(structuredClone(next));revision.current=draft?.revision??0;setDirty(false);setSelected(null);},[draft,c.plan]);
  // A plan published by another role (or by Claude) never overwrites unsaved local work.
  useEffect(()=>{if(!dirty)reload();},[draft?.revision,c.version]);
  function place(piece:PlanPiece) {
    if(!active||PLAN_PIECES[piece].owner!==role)return;
    setPlan(current=>addPiece(current,piece));setSelected(`plan-${piece}`);setDirty(true);
  }
  // Placed pieces plus a ghost for every empty solar. ReactFlow owns the list so it can measure the
  // nodes: without onNodesChange it never learns their size, and an unmeasured node draws no road.
  const buildNodes=useCallback((current:Graph):Node[]=>{
    const slots=boardSlots(current,role),mineByType=new Map(slots.map(s=>[s.piece as string,s.mine]));
    return [
      ...current.nodes.filter(n=>n.type!=='server').map(n=>({...n,draggable:false,selectable:Boolean(mineByType.get(n.type))&&active,deletable:false,data:{...n.data,mine:mineByType.get(n.type)}})) as Node[],
      ...slots.filter(s=>!s.placed&&s.piece!=='server').map(s=>({id:`ghost-${s.piece}`,type:'ghost',position:s.position,draggable:false,selectable:false,connectable:false,data:{piece:s.piece,reason:s.reason,mine:s.mine&&active,onPlace:()=>place(s.piece)}})) as Node[],
      {id:'plan-server-bay',type:'servers',position:PLAN_SLOTS.server,draggable:false,selectable:false,connectable:false,data:{count:servers,mine:role==='devops'}} as Node,
    ];
  },[role,active,servers]);
  const [nodes,setNodes]=useState<Node[]>(()=>buildNodes(plan));
  useEffect(()=>{setNodes(previous=>buildNodes(plan).map(n=>({...n,measured:previous.find(p=>p.id===n.id)?.measured})));},[plan,buildNodes]);
  const onNodesChange=useCallback((changes:NodeChange[])=>setNodes(ns=>applyNodeChanges(changes,ns)),[]);
  const slots=boardSlots(plan,role);
  const onConnect=useCallback((connection:Connection)=>{if(!connection.source||!connection.target)return;setPlan(current=>connect(current,connection.source!,connection.target!));setDirty(true);},[]);
  async function save(publish=false) {
    setBusy(true);
    const ok=await send(publish?'plan.publish':'plan.save',{companyId:c.id,payload:{graph:plan,revision:revision.current}});
    if(ok){revision.current++;setDirty(false);}
    setBusy(false);
  }
  const node=plan.nodes.find(n=>n.id===selected);
  const piece=node&&PLAN_PIECES[node.type as PlanPiece]?node.type as PlanPiece:undefined;
  const palette=PLAN_PIECE_TYPES.filter(t=>t!=='server'&&PLAN_PIECES[t].owner===role&&!plan.nodes.some(n=>n.type===t));
  const cost=planPublicationCost(c.plan,plan);
  return <section className="node-editor panel plan-editor" style={{'--team':c.color} as CSSProperties}>
    <div className="editor-topbar"><span><Icon name="arena" size={17}/> PLANO DE SERVICIOS</span><span className="eyebrow">{c.assembly.active?'EN MONTAJE · publicás directo':'YA ACEPTA COMPRAS · el plano se cambia por el ciclo'} <i/> BORRADOR <b>r{revision.current}</b> <i/> BASE v{c.version}.0</span></div>
    <div className="editor-body"><aside className="block-palette">
      <div className="palette-heading"><span className="eyebrow">TUS PIEZAS</span><b>{palette.length.toString().padStart(2,'0')}</b></div>
      {palette.map(t=><button draggable={active} disabled={!active} onDragStart={e=>{e.dataTransfer.setData('application/flow-war-plan',t);e.dataTransfer.effectAllowed='copy';}} onClick={()=>place(t)} key={t} className="palette-block plan-piece"><span className="block-grip">⠿</span><Icon name={t==='security'?'shield':'chip'} size={15}/><span>{PLAN_PIECES[t].label}<small>{money(PLAN_PIECES[t].cost)}</small><em>{PLAN_PIECES[t].text}</em></span><Icon name="plus" size={12}/></button>)}
      {!palette.length&&<p className="muted">Ya colocaste todas tus piezas.</p>}
      <div className="palette-total"><span>PUBLICACIÓN</span><b>{money(cost)}</b></div>
    </aside>
    <div className="editor-flow" onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';}} onDrop={e=>{e.preventDefault();const t=e.dataTransfer.getData('application/flow-war-plan');if(t)place(t as PlanPiece);}}>
      <ReactFlow nodes={nodes} edges={plan.edges} onNodesChange={onNodesChange} onConnect={active?onConnect:undefined} onNodeClick={(_,n)=>{if(!n.id.startsWith('ghost-'))setSelected(n.id);}} onPaneClick={()=>setSelected(null)} nodeTypes={planNodeTypes} defaultEdgeOptions={defaultEdgeOptions} fitView fitViewOptions={{padding:.15}} minZoom={.2} maxZoom={1.4} nodesDraggable={false} nodesConnectable={active} elementsSelectable={active} deleteKeyCode={null} colorMode="dark"><Background variant={BackgroundVariant.Dots} color="#344052" gap={20} size={1}/><Controls showInteractive={false}/></ReactFlow>
      <div className="canvas-caption">{plan.nodes.length} PIEZAS <i/> {plan.edges.length} CAMINOS</div>
    </div>
    <aside className="node-inspector"><span className="eyebrow">INSPECTOR DE PIEZA</span>
      {piece?<><div className="inspector-icon"><Icon name={piece==='security'?'shield':'chip'} size={30}/></div>
        <h3>{PLAN_PIECES[piece].label}</h3><span className="inspector-id">{piece.toUpperCase()}</span>
        <p className="piece-text">{PLAN_PIECES[piece].text}</p>
        <div className="inspector-cost"><span>INCORPORACIÓN</span><b>{money(PLAN_PIECES[piece].cost)}</b></div>
        {(piece==='inventory'||piece==='payment')&&<button className="secondary-button" onClick={()=>setOpenPiece(piece)}>ABRIR SU LÓGICA INTERNA<Icon name="arrow" size={14}/></button>}
        {PLAN_PIECES[piece].owner===role&&piece!=='entry'&&<button className="secondary-button danger" disabled={!active} onClick={()=>{setPlan(current=>removePiece(current,node!.id));setSelected(null);setDirty(true);}}>QUITAR PIEZA</button>}</>
      :<div className="inspector-empty"><Icon name="chip" size={34}/><span>SIN SELECCIÓN</span><p className="muted">Tocá un solar vacío para colocar tu pieza, o una pieza puesta para ver qué hace.</p></div>}
    </aside></div>
    <div className="editor-bottom"><span><i className={dirty?'yellow-dot':'green-dot'}/>{dirty?'CAMBIOS LOCALES':'PLANO SINCRONIZADO'}</span>
      <div className="button-row"><button className="secondary-button" disabled={!active||busy} onClick={()=>void save()}>GUARDAR</button>
      <button className="primary-button small" disabled={!active||busy||!c.assembly.active} onClick={()=>void save(true)}>{busy?'PUBLICANDO…':`PUBLICAR · ${money(cost)}`}<Icon name="arrow" size={15}/></button></div></div>
    {openPiece&&<div className="plan-inner-editor"><div className="panel-title"><span>LÓGICA INTERNA DE {PLAN_PIECES[openPiece].label.toUpperCase()}</span><button className="text-button" onClick={()=>setOpenPiece(null)}>VOLVER AL PLANO</button></div><GraphEditor company={c} domain="backend" active={active&&!backendLocked}/></div>}
  </section>;
}
export function GraphViewer({ graph }: { graph: Graph }) {
  return <div className="artifact-graph"><ReactFlow nodes={graph.nodes as Node[]} edges={graph.edges} nodeTypes={flowNodeTypes} defaultEdgeOptions={defaultEdgeOptions} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} minZoom={.15} maxZoom={1} colorMode="dark"><Background color="#28374b" gap={20} size={1}/></ReactFlow></div>;
}
function Editor({ company:c,domain,active }: { company: PrivateCompany; domain:'backend'|'security'; active:boolean }) {
  const draft=c.drafts[domain];
  const snapshot=useGame(s=>s.snapshot);
  const [refresh,setRefresh]=useState(0);
  const [nodes,setNodes]=useState<Node[]>(structuredClone(draft?.graph.nodes??c[domain].nodes).map(n=>({...n,deletable:!['entry','exit','read','write','payment'].includes(n.type)})) as Node[]);
  const [edges,setEdges]=useState<Edge[]>(structuredClone(draft?.graph.edges??c[domain].edges));
  const [selected,setSelected]=useState<string|null>(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false);
  const revision=useRef(draft?.revision??0), counter=useRef(0);
  const {screenToFlowPosition}=useReactFlow();
  const blocks=BLOCKS[domain];
  const onNodesChange=useCallback((changes:NodeChange[])=>{setNodes(ns=>applyNodeChanges(changes,ns));if(changes.some(ch=>ch.type!=='select'&&ch.type!=='dimensions'))setDirty(true);},[]);
  const onEdgesChange=useCallback((changes:EdgeChange[])=>{setEdges(es=>applyEdgeChanges(changes,es));if(changes.some(ch=>ch.type!=='select'))setDirty(true);},[]);
  const onConnect=useCallback((connection:Connection)=>{setEdges(es=>addEdge({...connection,id:crypto.randomUUID()},es.filter(e=>e.source!==connection.source)));setDirty(true);},[]);
  function add(type:string,position?:{x:number;y:number}) { const block=blocks.find(b=>b.type===type);if(!block||!active)return;const id=`${type}-${crypto.randomUUID()}`;setNodes(ns=>[...ns,{id,type,position:position??{x:140+(counter.current%4)*195,y:320+Math.floor(counter.current++/4)*120},data:{label:block.label,value:block.value}}]);setSelected(id);setDirty(true); }
  async function save(submit=false) { setBusy(true);const graph:Graph={nodes:nodes.map(n=>({id:n.id,type:n.type!,position:n.position,data:{label:String(n.data.label),...(n.data.value!=null?{value:Number(n.data.value)}:{}),...(n.data.config?{config:n.data.config as BlockConfiguration}:{}),...(n.data.module?{module:n.data.module as {id:string;version:number}}:{})}})),edges:edges.map(e=>({id:e.id,source:e.source,target:e.target}))};const ok=await send(submit?'change.submit':'draft.save',{companyId:c.id,payload:{graph,revision:revision.current}});if(ok){revision.current++;setDirty(false);}setBusy(false); }
  const [serverAhead,setServerAhead]=useState(false);
  const reload=useCallback(()=>{if(!draft)return;setNodes(structuredClone(draft.graph.nodes).map(n=>({...n,deletable:!['entry','exit','read','write','payment'].includes(n.type)})) as Node[]);setEdges(structuredClone(draft.graph.edges));revision.current=draft.revision;setDirty(false);setServerAhead(false);setRefresh(v=>v+1);},[draft]);
  // A saved revision from the server (for example an order executed by Claude) never overwrites unsaved local work.
  useEffect(()=>{if(draft&&draft.revision>revision.current){if(dirty)setServerAhead(true);else reload();}},[draft?.revision]);
  useEffect(()=>{useGame.getState().setSelection({nodeId:selected??undefined});},[selected]);
  const node=nodes.find(n=>n.id===selected),block=blocks.find(b=>b.type===node?.type);
  const cost=100+nodes.reduce((sum,n)=>sum+(blocks.find(b=>b.type===n.type)?.cost??0),0);
  return <section className="node-editor panel" style={{'--team':c.color} as CSSProperties}><div className="editor-topbar"><span><Icon name={domain==='backend'?'code':'shield'} size={17}/> {domain==='backend'?'ARQUITECTURA DE LÓGICA':'PERÍMETRO DE SEGURIDAD'}</span><span className="eyebrow">purchase-flow · BORRADOR <b>r{revision.current}</b> <i/> BASE v{c.version}.0</span></div><div className="editor-body"><aside className="block-palette"><div className="palette-heading"><span className="eyebrow">PIEZAS DISPONIBLES</span><b>{blocks.length.toString().padStart(2,'0')}</b></div>{blocks.map(b=><button draggable={active} disabled={!active} onDragStart={e=>{e.dataTransfer.setData('application/flow-war',b.type);e.dataTransfer.effectAllowed='move';}} onClick={()=>add(b.type)} key={b.type} className="palette-block"><span className="block-grip">⠿</span><Icon name={domain==='security'?'shield':'chip'} size={15}/><span>{b.label}<small>{money(b.cost)}</small></span><Icon name="plus" size={12}/></button>)}<div className="palette-total"><span>PUBLICACIÓN</span><b>{money(cost)}</b></div></aside><div className="editor-flow" onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move';}} onDrop={e=>{e.preventDefault();add(e.dataTransfer.getData('application/flow-war'),screenToFlowPosition({x:e.clientX,y:e.clientY}));}}><ReactFlow nodes={nodes} edges={edges} onNodesChange={active?onNodesChange:undefined} onEdgesChange={active?onEdgesChange:undefined} onConnect={active?onConnect:undefined} onNodeClick={(_,n)=>setSelected(n.id)} onPaneClick={()=>setSelected(null)} nodeTypes={flowNodeTypes} defaultEdgeOptions={defaultEdgeOptions} fitView fitViewOptions={{padding:.2}} minZoom={.25} maxZoom={1.5} nodesDraggable={active} nodesConnectable={active} deleteKeyCode={active?['Backspace','Delete']:null} colorMode="dark"><Background variant={BackgroundVariant.Dots} color="#344052" gap={20} size={1}/><Controls showInteractive={false}/></ReactFlow><div className="canvas-caption">{nodes.length} NODOS <i/> {edges.length} CONEXIONES</div></div><aside className="node-inspector"><span className="eyebrow">INSPECTOR DE PIEZA</span>{node?<><div className="inspector-icon"><Icon name={domain==='security'?'shield':'chip'} size={30}/></div><h3>{String(node.data.label)}</h3><span className="inspector-id">{node.type?.toUpperCase()}</span>{node.type&&defaults(node.type,Number(node.data.value??1))&&<BlockInspector key={`${node.id}-${refresh}`} node={node} active={active} onChange={config=>{setNodes(ns=>ns.map(n=>n.id===node.id?{...n,data:{...n.data,config}}:n));setDirty(true);}}/>}{block&&<>{node.type==='atomic'&&<><label htmlFor="node-value">{block.unit.toUpperCase()}</label><input id="node-value" type="number" min={1} max={120} value={Number(node.data.value??block.value)} disabled={!active} onChange={e=>{setNodes(ns=>ns.map(n=>n.id===node.id?{...n,data:{...n.data,value:Number(e.target.value)}}:n));setDirty(true);}}/></>}<div className="inspector-cost"><span>INCORPORACIÓN</span><b>{money(block.cost)}</b></div><button className="secondary-button danger" disabled={!active} onClick={()=>{setNodes(ns=>ns.filter(n=>n.id!==node.id));setEdges(es=>es.filter(e=>e.source!==node.id&&e.target!==node.id));setSelected(null);setDirty(true);}}>ELIMINAR PIEZA</button></>}</>:<div className="inspector-empty"><Icon name="chip" size={34}/><span>SIN SELECCIÓN</span></div>}</aside></div><div className="editor-bottom"><span><i className={dirty?'yellow-dot':'green-dot'}/>{dirty?'CAMBIOS LOCALES':'BORRADOR SINCRONIZADO'}{serverAhead&&<> · <b>EL SERVIDOR TIENE LA REVISIÓN r{draft?.revision}</b> <button className="text-button" onClick={reload}>CARGAR REVISIÓN GUARDADA</button></>}</span><div className="button-row"><button className="secondary-button" disabled={!active||busy} onClick={()=>void save()}>GUARDAR</button><button className="primary-button small" disabled={!active||busy} onClick={()=>void save(true)}>{busy?'CONFIRMANDO…':'ENVIAR A SEGURIDAD'}<Icon name="arrow" size={15}/></button></div></div>{snapshot?.operations?.collaboration&&<div className="backend-observations">{Object.entries(snapshot.operations.collaboration.reviews).flatMap(([id,r])=>r.observations.map((o,i)=><p key={`${id}-${i}`}><b>{id} · {o.nodeId}</b> {o.text}</p>))}</div>}</section>;
}
export default function GraphEditor(props:{company:PrivateCompany;domain:'backend'|'security'|'plan';active:boolean;role?:Role}) {
  if(props.domain==='plan')return <ReactFlowProvider><PlanEditor company={props.company} role={props.role??'backend'} active={props.active}/></ReactFlowProvider>;
  return <ReactFlowProvider><Editor company={props.company} domain={props.domain} active={props.active}/></ReactFlowProvider>;
}

function defaults(type:string,value:number):BlockConfiguration|undefined {
  switch(type){
    case 'lock':return {kind:'lock',resource:'stock',ttlMs:value,acquisitionMs:0};
    case 'retry':return {kind:'retry',maxAttempts:value,delayMs:500,condition:'payment_timeout'};
    case 'cache':return {kind:'cache',ttlSeconds:value,capacity:16,invalidateOnWrite:false};
    case 'idempotency':return {kind:'idempotency',ttlSeconds:value,scope:'purchase'};
    case 'queue':return {kind:'queue',capacity:value,resource:'stock'};
    case 'validation':return {kind:'validation',minimum:value,rejectInvalidInput:true};
  }
}
function BlockInspector({node,active,onChange}:{node:Node;active:boolean;onChange:(c:BlockConfiguration)=>void}){
  const config=(node.data.config??defaults(node.type!,Number(node.data.value??1))) as BlockConfiguration;
  const choices:Record<string,string[]>={resource:config.kind==='lock'?['stock','payment']:['stock'],condition:['payment_timeout'],scope:['purchase']};
  const labels:Record<string,string>={resource:'RECURSO',ttlMs:'TTL (MS)',acquisitionMs:'ADQUISICIÓN (MS)',maxAttempts:'INTENTOS',delayMs:'ESPERA (MS)',condition:'CONDICIÓN',ttlSeconds:'TTL (S)',capacity:'CAPACIDAD',invalidateOnWrite:'INVALIDAR AL ESCRIBIR',scope:'ÁMBITO',minimum:'MÍNIMO',rejectInvalidInput:'VALIDAR ENTRADA'};
  return <div className="block-configuration">{Object.entries(config).filter(([key])=>key!=='kind').map(([key,value])=><label key={key}>{labels[key]??key}{typeof value==='boolean'?<select disabled={!active} value={String(value)} onChange={e=>onChange({...config,[key]:e.target.value==='true'} as BlockConfiguration)}><option value="true">Sí</option><option value="false">No</option></select>:typeof value==='number'?<input type="number" value={value} disabled={!active} onChange={e=>onChange({...config,[key]:Number(e.target.value)} as BlockConfiguration)}/>:<select disabled={!active} value={value} onChange={e=>onChange({...config,[key]:e.target.value} as BlockConfiguration)}>{(choices[key]??[value]).map(v=><option key={v}>{v}</option>)}</select>}</label>)}</div>;
}
