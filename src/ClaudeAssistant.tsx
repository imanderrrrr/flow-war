import { useState } from 'react';
import type { AiInput } from '../shared/collaboration';
import { GraphViewer } from './GraphEditor';
import { send } from './store';

export async function requestClaude(input:Omit<AiInput,'id'>){
  const response=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,id:crypto.randomUUID()})});
  const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error??'Claude no está disponible.');return data.proposal;
}
export default function ClaudeAssistant({kind,companyId,changeId,nodeId,active,onAccepted}:{kind:'backend.propose'|'security.propose';companyId:number;changeId?:string;nodeId?:string;active:boolean;onAccepted?:()=>void}){
  const [open,setOpen]=useState(false),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[proposal,setProposal]=useState<any>();
  async function generate(){setBusy(true);setError('');try{setProposal(await requestClaude({kind,text,...(changeId?{changeId,nodeId}:{})}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function decide(accept:boolean){if(await send(accept?'ai.accept':'ai.reject',{companyId,payload:{proposalId:proposal.id}})){setProposal(undefined);if(accept){onAccepted?.();setOpen(false);}}}
  return <div className="claude-assistant"><button className="secondary-button claude-button" disabled={!active||busy} onClick={()=>setOpen(!open)} aria-label="Solicitar asistencia de Claude"><span aria-hidden="true">✳</span> CLAUDE</button>{open&&<div className="claude-draft"><label>SOLICITUD A CLAUDE<textarea aria-label="Solicitud a Claude" maxLength={4000} value={text} onChange={e=>setText(e.target.value)}/></label><button className="secondary-button" disabled={!active||busy||!text.trim()||!!proposal} onClick={()=>void generate()}>{busy?'PREPARANDO…':'PREPARAR BORRADOR'}</button>{error&&<p role="alert">{error}</p>}{proposal&&<><b>BORRADOR DE IA · {proposal.provider}</b>{proposal.graph?<><GraphViewer graph={proposal.graph}/><ol>{proposal.graph.nodes.map((n:any)=><li key={n.id}>{n.data.label} · {n.type} · {n.data.value}</li>)}</ol></>:<p className="proposal-text">{proposal.text}</p>}<div className="button-row"><button className="secondary-button" disabled={!active} onClick={()=>void decide(false)}>RECHAZAR</button><button className="primary-button small" disabled={!active} onClick={()=>void decide(true)}>ACEPTAR EN BORRADOR</button></div></>}</div>}</div>;
}
