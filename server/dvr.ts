import type {Express,Request} from 'express';
import type {DatabaseSync} from 'node:sqlite';
import type {Identity,GameState} from '../shared/types.js';
import type {Observation} from '../shared/observability.js';
import {historyAccess,historyPoints,reconstruct} from './history.js';
import {project} from './engine.js';
export function visibleFact(f:Observation,identity:Identity):Observation{
 if(identity.role==='operator')return f;
 const {defects,modules,attackKind,...data}=f.data;return{...f,data};
}
export function installDvr(app:Express,db:DatabaseSync,identityFor:(req:Request)=>Identity|null){
 app.get('/api/dvr/games',(req,res)=>{res.setHeader('Cache-Control','no-store');if(!identityFor(req))return res.sendStatus(403);res.json(db.prepare("SELECT generation,start,tick,duration,status,version FROM history_games WHERE status='FINISHED' ORDER BY generation DESC").all());});
 app.get('/api/dvr/:generation',(req,res)=>{
 res.setHeader('Cache-Control','no-store');const identity=identityFor(req);try{
 const generation=Number(req.params.generation);if(!Number.isSafeInteger(generation)||generation<0)return res.sendStatus(400);
 const meta=historyAccess(db,generation,identity),companyId=Number(req.query.companyId??identity!.companyId??0);
 if(!Number.isInteger(companyId)||companyId<0||companyId>4)return res.sendStatus(400);
 if(identity!.role!=='operator'&&companyId!==identity!.companyId)return res.sendStatus(403);
 const points=historyPoints(db,generation).map(p=>({...p,companies:p.companies.filter(c=>identity!.role==='operator'||c.id===companyId)}));
 const rows=db.prepare("SELECT body FROM history_events WHERE generation=? AND (companyId=? OR companyId IS NULL) AND kind NOT IN ('request.settled','slack.message','communication.accepted','telemetry.sample','customer.migrated') ORDER BY seq LIMIT 3000").all(generation,companyId) as {body:string}[];
 const migrations=db.prepare("SELECT min(seq) AS id,min(at) AS at,count(*) AS count FROM history_events WHERE generation=? AND companyId=? AND kind='customer.migrated' GROUP BY CAST(at/10 AS INTEGER)").all(generation,companyId)as{id:number;at:number;count:number}[];
 const markers=[...rows.map(r=>visibleFact(JSON.parse(r.body),identity!)),...migrations.map(r=>({id:r.id,at:r.at,companyId,kind:'migration.group',data:{count:r.count},refs:[]}))].sort((a,b)=>a.id-b.id);
 const at=Number(req.query.at??meta.tick),g=reconstruct(db,generation,at),c=g.companies[companyId],snapshot=project(g,identity);
 // Corporate public metrics remain public; conversations, modules and decisions stay tenant-scoped.
 const historical={company:snapshot.companies[companyId],backend:c.backend,security:c.security,product:c.product,infrastructure:c.infrastructure,crisis:c.crisis,mode:c.serviceMode,changes:snapshot.changes.filter(ch=>ch.companyId===companyId),slack:g.slack.messages.filter(m=>m.companyId===companyId)};
 res.json({meta,at:g.tick,points,markers,historical,unserved:g.unserved,population:g.companies.reduce((s,c)=>s+c.customers,0)+g.unserved});
 }catch(e){res.status(403).json({error:(e as Error).message});}
 });
 app.get('/api/dvr/:generation/requests/:id',(req,res)=>{
 res.setHeader('Cache-Control','no-store');const identity=identityFor(req);try{const generation=Number(req.params.generation);historyAccess(db,generation,identity);
 const row=db.prepare("SELECT body FROM history_events WHERE generation=? AND kind='request.settled' AND json_extract(body,'$.data.requestId')=? AND (?=1 OR companyId=?) ORDER BY seq LIMIT 1").get(generation,req.params.id,identity!.role==='operator'?1:0,identity!.companyId) as {body:string}|undefined;
 if(!row)return res.sendStatus(404);const fact=JSON.parse(row.body)as Observation;
 if(identity!.role!=='operator')return res.json({fact:visibleFact(fact,identity!),causality:'Solo referencias directas registradas; la proximidad temporal no demuestra causalidad.'});
 const g=reconstruct(db,generation,fact.at),c=g.companies[fact.companyId!],release=c.runtime.releases[Number(fact.data.version)];
 const artifacts=release?.modules.map(m=>({module:m,change:g.changes.find(ch=>ch.id===m.changeId&&ch.companyId===c.id),decisions:g.actions.audit.filter(a=>a.companyId===c.id&&a.refs.includes(m.changeId))}))??[];
 res.json({fact,releaseVersion:fact.data.version,artifacts,causality:'Artefacto y versión congelados en la solicitud. Los códigos de activación son evidencia directa; las pérdidas sin vínculo explícito no se atribuyen a un defecto.'});
 }catch(e){res.status(403).json({error:(e as Error).message});}
 });
}
