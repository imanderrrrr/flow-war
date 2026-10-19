import type { GameState } from '../shared/types.js';
import type { Observation, Channel, SlackMessage } from '../shared/observability.js';
import { observe } from './observability.js';
export const ALERT_POLICY = { version:'symptoms-1', minimumResults:5, errorRate:.2, queueDepth:40, latencyMs:3000, interval:10, groupSeconds:20 } as const;
function add(g:GameState,m:Omit<SlackMessage,'id'|'sequence'|'at'|'mentions'> & {mentions?:string[]}) {
 const sequence=++g.slack.sequence;
 const message:SlackMessage={...m,id:`g${g.generation}-S${sequence}`,sequence,at:g.tick,mentions:m.mentions??[]};
 g.slack.messages.push(message);
 // Bounded live window per tenant; SQLite retains the full immutable conversation.
 const own=g.slack.messages.filter(x=>x.companyId===m.companyId);
 if(own.length>80){const remove=new Set(own.slice(0,-80).map(x=>x.id));g.slack.messages=g.slack.messages.filter(x=>!remove.has(x.id));}
 observe(g,'slack.message',m.companyId,{message},[message.id]); return message;
}
export {add as addSlackMessage};
function auto(g:GameState,f:Observation,channel:Channel,key:string,text:string,author='Sistema') {
 if(f.companyId===null)return;
 const groupKey=`${f.companyId}:${key}`,group=g.slack.groups[groupKey]??={count:0,emitted:0,at:-100};
 group.count++;
 if(g.tick-group.at<ALERT_POLICY.groupSeconds){g.slack.sampledCount++;return;}
 group.at=g.tick;
 const grouped=group.count-group.emitted;group.emitted=group.count;
 add(g,{companyId:f.companyId,channel,source:channel==='soporte-clientes'?'customer':'system',author,cause:f.id,dedup:`fact:${f.id}`,text:`${text}${grouped>1?` (${grouped} acontecimientos equivalentes registrados desde la muestra anterior).`:''}`,refs:f.refs});g.slack.automaticCount++;
}
function variant(g:GameState,f:Observation){let h=g.seed;for(const c of String(f.data.requestId??f.data.customerId??f.kind).replace(/C\d+/g,'C'))h=(Math.imul(h,31)+c.charCodeAt(0))>>>0;return h%2;}
export function slackFact(g:GameState,f:Observation){
 if(f.kind==='request.settled'&&f.companyId!==null&&f.data.trafficClass==='legitimate'&&f.data.customerId){
 const r=f.data.result as {status:string;reason:string};if(['ROOM_FINISHED','COMPANY_ELIMINATED'].includes(r.reason))return;
 const v=variant(g,f),author=`Cliente ${f.data.customerId}`;
 if(r.reason==='DEADLINE')auto(g,f,'soporte-clientes','timeout',v?'Mi solicitud venció antes de recibir una respuesta.':'Intenté completar mi operación y terminó por tiempo de espera.',author);
 else if(Number(f.data.duplicates)>0)auto(g,f,'soporte-clientes','duplicate','Mi operación aparece registrada más de una vez.',author);
 else if(r.status!=='COMPLETED')auto(g,f,'soporte-clientes',`failure:${r.reason}`,['MAINTENANCE','ORDERS_PAUSED'].includes(r.reason)?'Intenté utilizar el servicio y respondió temporalmente indisponible.':v?'Mi solicitud fue rechazada o falló; no pude completarla.':'No logré completar mi operación en la plataforma.',author);
 else if(Number(f.data.latencyMs)>3000)auto(g,f,'soporte-clientes','slow','Mi operación terminó, pero tardó más de tres segundos.',author);
 }
 if(f.kind==='customer.migrated'&&f.companyId!==null){const to=f.data.to as number|null;auto(g,f,'soporte-clientes','migration',to===null?'Dejé de utilizar esta plataforma.':`Dejé ${g.companies[f.companyId].name} y ahora utilizo ${g.companies[to].name}.`,`Cliente ${f.data.customerId}`);}
 if(f.kind==='maintenance.changed'&&f.companyId!==null){const mode=f.data.to;add(g,{companyId:f.companyId,channel:'alertas-sistema',source:'system',author:'Sistema',cause:f.id,dedup:`fact:${f.id}`,text:mode==='OPERATING'?'[SISTEMA] La recepción de nuevas solicitudes fue restablecida por DevOps.':mode==='FULL_MAINTENANCE'?'[SISTEMA] La plataforma inició mantenimiento total por orden de DevOps.':'[SISTEMA] DevOps suspendió las nuevas operaciones transaccionales.',refs:f.refs});}
 if(f.kind==='telemetry.sample'&&f.companyId!==null){const d=f.data;
 if(Number(d.results)>=ALERT_POLICY.minimumResults&&Number(d.errorRate)>=ALERT_POLICY.errorRate)auto(g,f,'alertas-sistema','errors',`[ERROR] ${d.errors} de ${d.results} respuestas legítimas fallaron en la ventana observada. Política ${ALERT_POLICY.version}.`);
 if(Number(d.queue)>ALERT_POLICY.queueDepth)auto(g,f,'alertas-sistema','queue',`[WARN] Cola observada: ${d.queue} solicitudes pendientes.`);
 if(Number(d.latencyMs)>ALERT_POLICY.latencyMs)auto(g,f,'alertas-sistema','latency',`[WARN] Latencia media observada: ${d.latencyMs} ms.`);
 if(Number(d.unavailable)>=1)auto(g,f,'alertas-sistema','unavailable','[CRITICAL] El servicio no tuvo capacidad disponible durante la ventana observada.');
 }
}
export function sampleTelemetry(g:GameState){if(Math.round(g.tick*10)%100!==0)return;for(const c of g.companies){if(c.eliminated)continue;const m=c.traffic.metrics;observe(g,'telemetry.sample',c.id,{policy:ALERT_POLICY.version,results:m.legitimateTerminated,errors:m.errors,errorRate:m.errorRate,latencyMs:m.latencyMs,queue:c.queue,unavailable:m.unavailable,generated:c.traffic.totals.generated,capacity:c.traffic.services.web.rate});}}
