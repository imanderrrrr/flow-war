import type {DatabaseSync} from 'node:sqlite';
import type {Identity} from '../shared/types.js';
import type {Observation} from '../shared/observability.js';
import {historyAccess,historyPoints,reconstruct} from './history.js';
import {project} from './engine.js';
import {postmortem} from './postmortem.js';
import {visibleFact,visibleMetrics} from './projections.js';
export type DvrQuery={kind:'games'|'frame'|'chat'|'metrics'|'request';identity:Identity;generation:number;companyId:number;at?:number;before?:number;requestId?:string};
export class DvrError extends Error {constructor(public status:number,message:string){super(message);}}
/** Runs inside a read transaction on the worker's independent read-only connection. */
export function queryDvr(db:DatabaseSync,q:DvrQuery):unknown {
 const {identity,generation,companyId}=q;
 if(q.kind==='games')return db.prepare("SELECT * FROM history_games WHERE status IN ('FINISHED','ABORTED') ORDER BY generation DESC").all().filter(row=>row.dvrEnabled!==0);
 if(!Number.isSafeInteger(generation)||generation<0)throw new DvrError(400,'Generación inválida.');
 const meta=historyAccess(db,generation,identity);
 if(!Number.isInteger(companyId)||companyId<0||companyId>4)throw new DvrError(400,'Empresa inválida.');
 if(identity.role!=='operator'&&companyId!==identity.companyId)throw new DvrError(403,'Empresa no autorizada.');
 if(q.kind==='chat'){
  const at=q.at??meta.tick,before=q.before??Number.MAX_SAFE_INTEGER;
  if(!Number.isFinite(at)||at<meta.start||at>meta.tick||!Number.isSafeInteger(before)||before<1)throw new DvrError(400,'Intervalo inválido.');
  const rows=db.prepare("SELECT body FROM slack_messages WHERE generation=? AND companyId=? AND seq<? AND json_extract(body,'$.at')<=? ORDER BY seq DESC LIMIT 80").all(generation,companyId,before,at)as{body:string}[];
  return {messages:rows.map(r=>JSON.parse(r.body)).reverse()};
 }
 if(q.kind==='metrics')return visibleMetrics(postmortem(db,generation,companyId,reconstruct(db,generation,meta.tick)),identity);
 if(q.kind==='request'){
  const row=db.prepare("SELECT body FROM history_events WHERE generation=? AND kind='request.settled' AND json_extract(body,'$.data.requestId')=? AND (?=1 OR companyId=?) ORDER BY seq LIMIT 1").get(generation,q.requestId??'',identity.role==='operator'?1:0,identity.companyId)as{body:string}|undefined;
  if(!row)throw new DvrError(404,'No existe evidencia autorizada para esa solicitud.');
  const fact=JSON.parse(row.body)as Observation;
  if(identity.role!=='operator')return {fact:visibleFact(fact,identity),causality:'Solo referencias directas registradas; la proximidad temporal no demuestra causalidad.'};
  const g=reconstruct(db,generation,fact.at),c=g.companies[fact.companyId!],release=c.runtime.releases[Number(fact.data.version)];
  const artifacts=release?.modules.map(m=>({module:m,change:g.changes.find(ch=>ch.id===m.changeId&&ch.companyId===c.id),decisions:g.actions.audit.filter(a=>a.companyId===c.id&&a.refs.includes(m.changeId))}))??[];
  return {fact,releaseVersion:fact.data.version,artifacts,causality:'Artefacto y versión congelados en la solicitud. Los códigos de activación son evidencia directa; las pérdidas sin vínculo explícito no se atribuyen a un defecto.'};
 }
 const points=historyPoints(db,generation).map(p=>({...p,companies:p.companies.filter(c=>identity.role==='operator'||c.id===companyId)}));
 const rows=db.prepare("SELECT body FROM history_events WHERE generation=? AND (companyId=? OR companyId IS NULL) AND kind NOT IN ('request.settled','slack.message','communication.accepted','telemetry.sample','customer.migrated') ORDER BY seq LIMIT 3000").all(generation,companyId)as{body:string}[];
 const migrations=db.prepare("SELECT min(seq) AS id,min(at) AS at,count(*) AS count FROM history_events WHERE generation=? AND companyId=? AND kind='customer.migrated' GROUP BY CAST(at/10 AS INTEGER)").all(generation,companyId)as{id:number;at:number;count:number}[];
 const markers=[...rows.map(r=>visibleFact(JSON.parse(r.body),identity)),...migrations.map(r=>({id:r.id,at:r.at,companyId,kind:'migration.group',data:{count:r.count},refs:[]}))].sort((a,b)=>a.id-b.id);
 const g=reconstruct(db,generation,q.at??meta.tick),c=g.companies[companyId],snapshot=project(g,identity);
 const historical={company:snapshot.companies[companyId],backend:c.backend,security:c.security,product:c.product,infrastructure:c.infrastructure,crisis:c.crisis,mode:c.serviceMode,changes:snapshot.changes.filter(ch=>ch.companyId===companyId),slack:g.slack.messages.filter(m=>m.companyId===companyId)};
 return {meta,at:g.tick,points,markers,historical,unserved:g.unserved,population:g.companies.reduce((s,c)=>s+c.customers,0)+g.unserved};
}
