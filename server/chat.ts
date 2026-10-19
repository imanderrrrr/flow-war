import type { Command, GameState, Identity, Result } from '../shared/types.js';
import { CHANNELS } from '../shared/observability.js';
import { employeeFor, stableDigest } from './discipline.js';
import { addSlackMessage } from './flowslack.js';
import { observe } from './observability.js';
export function postChat(g:GameState,identity:Identity|null,command:Command,receivedAt:number):Result{
 if(!identity||identity.companyId===null||command.companyId!==identity.companyId||typeof command.id!=='string'||!command.id||command.id.length>100)return{ok:false,code:'FORBIDDEN',error:'Canal no autorizado.'};
 const employee=employeeFor(g,identity);if(!employee||employee.companyId!==identity.companyId||employee.role!==identity.role||employee.status!=='ACTIVE')return{ok:false,code:'FORBIDDEN',error:'Empleado no autorizado.'};
 const p=command.payload??{},digest=stableDigest(command),key=`${identity.id}:${command.id}`,prior=g.slack.receipts[key];
 if(prior)return prior.digest===digest?{ok:true,refs:[prior.id]}:{ok:false,code:'ID_CONFLICT',error:'ID de mensaje ya utilizado.'};
 if(g.status==='FINISHED')return{ok:false,code:'READ_ONLY',error:'Partida finalizada: canales en modo lectura.'};
 if(Object.keys(p).some(k=>!['channel','text','refs'].includes(k))||!['general','equipo-interno'].includes(String(p.channel))||!CHANNELS.includes(p.channel as any)||typeof p.text!=='string'||p.text.length>1000||!p.text.trim())return{ok:false,code:'INVALID',error:'Mensaje o canal inválido (máximo 1,000 caracteres).'};
 const refs=p.refs??[];if(!Array.isArray(refs)||refs.length>5||refs.some(ref=>typeof ref!=='string'||(!g.changes.some(ch=>ch.id===ref&&ch.companyId===identity.companyId)&&!Object.values(g.companies[identity.companyId!].runtime.modules).flat().some(m=>`${m.id}@${m.version}`===ref))))return{ok:false,code:'FORBIDDEN',error:'Referencia de artefacto no autorizada.'};
 if(Object.keys(g.slack.receipts).length>=12000)return{ok:false,code:'LIMIT',error:'Límite de mensajes de la partida alcanzado.'};
 const buckets=[{key:`employee:${identity.id}`,max:6},{key:`company:${identity.companyId}`,max:30}].map(({key,max})=>{let b=g.slack.buckets[key];if(!b||receivedAt-b.at>=10000)b=g.slack.buckets[key]={at:receivedAt,count:0};return{b,max};});
 if(buckets.some(({b,max})=>b.count>=max))return{ok:false,code:'RATE_LIMIT',error:'Límite temporal de mensajes alcanzado.'};
 for(const {b}of buckets)b.count++;
 const text=p.text.replace(/[<>\u0000-\u0008\u000b-\u001f\u007f]/g,'').trim();if(!text)return{ok:false,code:'INVALID',error:'Mensaje vacío.'};
 const mentions=[...new Set(text.match(/@[\p{L}\p{N}_-]+/gu)??[])].slice(0,12).filter(m=>Object.values(g.actions.employees).some(e=>e.companyId===identity.companyId&&[e.id,e.role,({security:'seguridad',product:'producto'}as Record<string,string>)[e.role]].filter(Boolean).some(name=>name.toLowerCase()===m.slice(1).toLowerCase())));
 const cause=observe(g,'communication.accepted',identity.companyId,{actorId:identity.id,role:identity.role,channel:p.channel},refs);
 const message=addSlackMessage(g,{companyId:identity.companyId,channel:p.channel as 'general'|'equipo-interno',source:'human',author:identity.id,role:identity.role,receivedAt,cause:cause.id,dedup:key,text,refs,mentions});
 g.slack.receipts[key]={digest,id:message.id};return{ok:true,refs:[message.id]};
}
