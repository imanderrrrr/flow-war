import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, Handle, Position, addEdge, applyNodeChanges, applyEdgeChanges, useReactFlow, type Connection, type Node, type Edge, type NodeProps, type NodeChange, type EdgeChange } from '@xyflow/react';
import { BLOCKS, type Graph, type PrivateCompany } from '../shared/types';
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
  useEffect(()=>{if(draft&&draft.revision>revision.current){setNodes(structuredClone(draft.graph.nodes) as Node[]);setEdges(structuredClone(draft.graph.edges));revision.current=draft.revision;setDirty(false);setRefresh(v=>v+1);}},[draft?.revision]);
  const node=nodes.find(n=>n.id===selected),block=blocks.find(b=>b.type===node?.type);
  const cost=100+nodes.reduce((sum,n)=>sum+(blocks.find(b=>b.type===n.type)?.cost??0),0);
  return <section className="node-editor panel" style={{'--team':c.color} as CSSProperties}><div className="editor-topbar"><span><Icon name={domain==='backend'?'code':'shield'} size={17}/> {domain==='backend'?'ARQUITECTURA DE LÓGICA':'PERÍMETRO DE SEGURIDAD'}</span><span className="eyebrow">purchase-flow · BORRADOR <b>r{revision.current}</b> <i/> BASE v{c.version}.0</span></div><div className="editor-body"><aside className="block-palette"><div className="palette-heading"><span className="eyebrow">PIEZAS DISPONIBLES</span><b>{blocks.length.toString().padStart(2,'0')}</b></div>{blocks.map(b=><button draggable={active} disabled={!active} onDragStart={e=>{e.dataTransfer.setData('application/flow-war',b.type);e.dataTransfer.effectAllowed='move';}} onClick={()=>add(b.type)} key={b.type} className="palette-block"><span className="block-grip">⠿</span><Icon name={domain==='security'?'shield':'chip'} size={15}/><span>{b.label}<small>{money(b.cost)}</small></span><Icon name="plus" size={12}/></button>)}<div className="palette-total"><span>PUBLICACIÓN</span><b>{money(cost)}</b></div></aside><div className="editor-flow" onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move';}} onDrop={e=>{e.preventDefault();add(e.dataTransfer.getData('application/flow-war'),screenToFlowPosition({x:e.clientX,y:e.clientY}));}}><ReactFlow nodes={nodes} edges={edges} onNodesChange={active?onNodesChange:undefined} onEdgesChange={active?onEdgesChange:undefined} onConnect={active?onConnect:undefined} onNodeClick={(_,n)=>setSelected(n.id)} onPaneClick={()=>setSelected(null)} nodeTypes={flowNodeTypes} defaultEdgeOptions={defaultEdgeOptions} fitView fitViewOptions={{padding:.2}} minZoom={.25} maxZoom={1.5} nodesDraggable={active} nodesConnectable={active} deleteKeyCode={active?['Backspace','Delete']:null} colorMode="dark"><Background variant={BackgroundVariant.Dots} color="#344052" gap={20} size={1}/><Controls showInteractive={false}/></ReactFlow><div className="canvas-caption">{nodes.length} NODOS <i/> {edges.length} CONEXIONES</div></div><aside className="node-inspector"><span className="eyebrow">INSPECTOR DE PIEZA</span>{node?<><div className="inspector-icon"><Icon name={domain==='security'?'shield':'chip'} size={30}/></div><h3>{String(node.data.label)}</h3><span className="inspector-id">{node.type?.toUpperCase()}</span>{node.type&&defaults(node.type,Number(node.data.value??1))&&<BlockInspector key={`${node.id}-${refresh}`} node={node} active={active} onChange={config=>{setNodes(ns=>ns.map(n=>n.id===node.id?{...n,data:{...n.data,config}}:n));setDirty(true);}}/>}{block&&<>{node.type==='atomic'&&<><label htmlFor="node-value">{block.unit.toUpperCase()}</label><input id="node-value" type="number" min={1} max={120} value={Number(node.data.value??block.value)} disabled={!active} onChange={e=>{setNodes(ns=>ns.map(n=>n.id===node.id?{...n,data:{...n.data,value:Number(e.target.value)}}:n));setDirty(true);}}/></>}<div className="inspector-cost"><span>INCORPORACIÓN</span><b>{money(block.cost)}</b></div><button className="secondary-button danger" disabled={!active} onClick={()=>{setNodes(ns=>ns.filter(n=>n.id!==node.id));setEdges(es=>es.filter(e=>e.source!==node.id&&e.target!==node.id));setSelected(null);setDirty(true);}}>ELIMINAR PIEZA</button></>}</>:<div className="inspector-empty"><Icon name="chip" size={34}/><span>SIN SELECCIÓN</span></div>}</aside></div><div className="editor-bottom"><span><i className={dirty?'yellow-dot':'green-dot'}/>{dirty?'CAMBIOS LOCALES':'BORRADOR SINCRONIZADO'}</span><div className="button-row"><button className="secondary-button" disabled={!active||busy} onClick={()=>void save()}>GUARDAR</button><button className="primary-button small" disabled={!active||busy} onClick={()=>void save(true)}>{busy?'CONFIRMANDO…':'ENVIAR A SEGURIDAD'}<Icon name="arrow" size={15}/></button></div></div>{snapshot?.operations?.collaboration&&<div className="backend-observations">{Object.entries(snapshot.operations.collaboration.reviews).flatMap(([id,r])=>r.observations.map((o,i)=><p key={`${id}-${i}`}><b>{id} · {o.nodeId}</b> {o.text}</p>))}</div>}</section>;
}
export default function GraphEditor(props:{company:PrivateCompany;domain:'backend'|'security';active:boolean}) {return <ReactFlowProvider><Editor {...props}/></ReactFlowProvider>;}

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
