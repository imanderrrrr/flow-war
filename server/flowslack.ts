import type { GameState, TerminalReason } from '../shared/types.js';
import type { Observation, Channel, SlackMessage } from '../shared/observability.js';
import { observe } from './observability.js';
import { isPlanReason } from '../shared/plan.js';
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
 add(g,{companyId:f.companyId,channel,source:channel==='soporte-clientes'?'customer':'system',author,cause:f.id,dedup:`fact:${f.id}`,text:`${text}${grouped>1?` (se repitió ${grouped} veces)`:''}`,refs:f.refs});g.slack.automaticCount++;
}
function variant(g:GameState,f:Observation){let h=g.seed;for(const c of String(f.data.requestId??f.data.customerId??f.kind).replace(/C\d+/g,'C'))h=(Math.imul(h,31)+c.charCodeAt(0))>>>0;return h%2;}
export function slackFact(g:GameState,f:Observation){
 if(f.kind==='request.settled'&&f.companyId!==null&&f.data.trafficClass==='legitimate'&&f.data.customerId){
 const r=f.data.result as {status:string;reason:string};if(['ROOM_FINISHED','ROOM_INTERRUPTED','COMPANY_ELIMINATED'].includes(r.reason))return;
 const v=variant(g,f),author=`Cliente ${f.data.customerId}`;
 // A billing or confirmation hole does not fail on availability, so its complaint is emitted on its own terms.
 if(f.data.auditedAs==='uncharged'){auto(g,f,'soporte-clientes','billing',v?'no me recibe el pago':'me descontaron y la compra no aparece',author);return;}
 if(f.data.auditedAs==='confirmation'){auto(g,f,'soporte-clientes','confirmation',v?'me dice que falló pero ya me cobraron':'¿entonces la tengo o no la tengo?',author);return;}
 // Customers write like people, and say when it used to work: that contrast is what makes a team look.
 if(r.reason==='DEADLINE')auto(g,f,'soporte-clientes','timeout',v?'llevo un rato esperando y nunca me respondió':'se queda cargando y al final no pasa nada',author);
 else if(Number(f.data.duplicates)>0)auto(g,f,'soporte-clientes','duplicate',v?'me aparece cobrada dos veces, ¿pueden revisar?':'hice una sola compra y me figura repetida',author);
 else if(r.reason==='OUT_OF_STOCK')auto(g,f,'soporte-clientes','failure:OUT_OF_STOCK',v?'no pude completar mi compra y la necesitaba':'hace un rato me dejaba comprar y ahora dice que no hay',author);
 // A service the company has not built yet never let the customer in, so the complaint says that
 // and not that something fell halfway: what the team reads is what the customer actually lived.
 else if(isPlanReason(r.reason as TerminalReason))auto(g,f,'soporte-clientes',`failure:${r.reason}`,r.reason==='NO_STOREFRONT'?(v?'entré y no cargó nada, ¿están abiertos?':'me quedé esperando la página y nunca apareció'):r.reason==='NO_INVENTORY'?(v?'no me dice si les queda stock':'quería saber si hay disponible y no aparece por ningún lado'):(v?'no me deja comprar, no hay dónde pagar':'llego hasta el pedido y no puedo terminar la compra'),author);
 else if(r.status!=='COMPLETED')auto(g,f,'soporte-clientes',`failure:${r.reason}`,['MAINTENANCE','ORDERS_PAUSED'].includes(r.reason)?'no me deja entrar, ¿están caídos?':v?'me deja a medias y se cae, llevo tres intentos':'¿les pasa algo? no logro terminar la compra',author);
 else if(Number(f.data.latencyMs)>3000)auto(g,f,'soporte-clientes','slow',v?'tardísimo, casi lo dejo':'antes era instantáneo, ahora se tarda un montón',author);
 }
 if(f.kind==='customer.migrated'&&f.companyId!==null){const to=f.data.to as number|null;auto(g,f,'soporte-clientes','migration',to===null?'Dejé de utilizar esta plataforma.':`Dejé ${g.companies[f.companyId].name} y ahora utilizo ${g.companies[to].name}.`,`Cliente ${f.data.customerId}`);}
 if(f.kind==='maintenance.changed'&&f.companyId!==null){const mode=f.data.to;add(g,{companyId:f.companyId,channel:'alertas-sistema',source:'system',author:'Sistema',cause:f.id,dedup:`fact:${f.id}`,text:mode==='OPERATING'?'[SISTEMA] DevOps volvió a abrir el servicio.':mode==='FULL_MAINTENANCE'?'[SISTEMA] DevOps puso la plataforma en mantenimiento total.':'[SISTEMA] DevOps suspendió las compras nuevas.',refs:f.refs});}
 if(f.kind==='telemetry.sample'&&f.companyId!==null){const d=f.data;
 if(Number(d.results)>=ALERT_POLICY.minimumResults&&Number(d.errorRate)>=ALERT_POLICY.errorRate)auto(g,f,'alertas-sistema','errors',`[ERROR] Fallaron ${d.errors} de ${d.results} solicitudes de clientes.`);
 if(Number(d.queue)>ALERT_POLICY.queueDepth)auto(g,f,'alertas-sistema','queue',`[AVISO] ${d.queue} solicitudes esperando en cola.`);
 if(Number(d.latencyMs)>ALERT_POLICY.latencyMs)auto(g,f,'alertas-sistema','latency',`[AVISO] Las respuestas tardan ${d.latencyMs} ms en promedio.`);
 if(Number(d.unavailable)>=1)auto(g,f,'alertas-sistema','unavailable','[CRÍTICO] El servicio se quedó sin capacidad.');
 }
}
export function sampleTelemetry(g:GameState){if(Math.round(g.tick*10)%100!==0)return;for(const c of g.companies){if(c.eliminated)continue;const m=c.traffic.metrics;observe(g,'telemetry.sample',c.id,{policy:ALERT_POLICY.version,results:m.legitimateTerminated,errors:m.errors,errorRate:m.errorRate,latencyMs:m.latencyMs,queue:c.queue,unavailable:m.unavailable,generated:c.traffic.totals.generated,capacity:c.traffic.services.web.rate});}}
