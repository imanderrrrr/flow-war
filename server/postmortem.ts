import type {DatabaseSync} from 'node:sqlite';
import type {GameState} from '../shared/types.js';
import {historyPoints} from './history.js';
type Incident={firstFailure:number;detectedAt:number|null;mitigatedAt:number|null;recoveredAt:number|null;mttrSeconds:number|null;definitiveCorrectionAt:number|null;status:'UNRESOLVED'|'RECOVERED';evidence:string[]};
export function postmortem(db:DatabaseSync,generation:number,companyId:number,g:GameState){
 const c=g.companies[companyId];
 const failures=db.prepare("SELECT at,json_extract(body,'$.data.requestId') AS requestId FROM history_events WHERE generation=? AND companyId=? AND kind='request.settled' AND json_extract(body,'$.data.trafficClass')='legitimate' AND json_extract(body,'$.data.result.status')!='COMPLETED' AND json_extract(body,'$.data.result.reason') NOT IN ('ROOM_FINISHED','COMPANY_ELIMINATED') ORDER BY seq").all(generation,companyId) as {at:number;requestId:string}[];
 const telemetry=(db.prepare("SELECT body FROM history_events WHERE generation=? AND companyId=? AND kind IN ('telemetry.sample','maintenance.changed') ORDER BY seq").all(generation,companyId) as {body:string}[]).map(r=>JSON.parse(r.body));
 const incidents:Incident[]=[];let index=0,incident:Incident|undefined,healthySince:number|undefined;
 for(const e of telemetry){
 if(!incident&&index<failures.length&&failures[index].at<=e.at){const f=failures[index];incident={firstFailure:f.at,detectedAt:null,mitigatedAt:null,recoveredAt:null,mttrSeconds:null,definitiveCorrectionAt:null,status:'UNRESOLVED',evidence:[f.requestId]};incidents.push(incident);}
 if(!incident)continue;
 if(e.kind==='maintenance.changed'&&e.data.to!=='OPERATING'){incident.mitigatedAt??=e.at;healthySince=undefined;continue;}
 if(e.kind!=='telemetry.sample')continue;
 const d=e.data;
 if(d.errors>0||d.unavailable>0){incident.detectedAt??=e.at;healthySince=undefined;}
 else if(d.results>=5&&d.errorRate===0&&d.unavailable===0){healthySince??=e.at;if(e.at-healthySince>=10){incident.recoveredAt=e.at;incident.mttrSeconds=Math.round((e.at-incident.firstFailure)*10)/10;incident.status='RECOVERED';while(index<failures.length&&failures[index].at<=e.at)index++;incident=undefined;healthySince=undefined;}}
 }
 if(!incident&&index<failures.length){const f=failures[index];incidents.push({firstFailure:f.at,detectedAt:null,mitigatedAt:null,recoveredAt:null,mttrSeconds:null,definitiveCorrectionAt:null,status:'UNRESOLVED',evidence:[f.requestId]});}
 // Count only actual negative ledger deltas on a request that recorded activation.
 // Multiple activated defects remain a shared cause set, never multiply the loss.
 const losses=db.prepare("SELECT count(*) AS requests,coalesce(sum(max(0,-json_extract(body,'$.data.result.capitalDelta'))),0) AS directLoss FROM history_events WHERE generation=? AND companyId=? AND kind='request.settled' AND json_array_length(json_extract(body,'$.data.defects'))>0 AND json_extract(body,'$.data.result.capitalDelta')<0").get(generation,companyId) as {requests:number;directLoss:number};
 const activated=db.prepare("SELECT count(*) AS count FROM history_events WHERE generation=? AND companyId=? AND kind='request.settled' AND json_array_length(json_extract(body,'$.data.defects'))>0").get(generation,companyId) as {count:number};
 const changes=g.changes.filter(ch=>ch.companyId===companyId),audit=g.actions.audit.filter(a=>a.companyId===companyId&&a.ok);
 const tested=changes.filter(ch=>ch.reports.some(r=>!r.obsolete));
 const discovered=Object.values(c.runtime.modules).flat().filter(m=>m.defects.length&&changes.find(ch=>ch.id===m.changeId)?.reports.some(r=>r.testEvidence&&!r.testEvidence.passed));
 const points=historyPoints(db,generation),capacitySamples=points.map(p=>p.companies.find(c=>c.id===companyId)).filter(Boolean);
 return{policy:'forensics-1',incidents,mttrPolicy:'Primer fallo legítimo confirmado → dos muestras operativas consecutivas sin errores, separadas por 10 s y con al menos 5 resultados. Mantenimiento solo registra mitigación. Corrección definitiva no se infiere.',
 badQuality:{directNegativeLedgerWithActivation:Math.round(losses.directLoss*100)/100,requestsWithDirectLoss:losses.requests,activatedRequests:activated.count,attribution:'Conjunto compartido de activaciones por solicitud. No es pérdida incremental de un defecto: descuentos configurados también pueden producir margen negativo. Sin contrafactual no se atribuye todo el delta al bug.',unattributedLostRevenue:c.lostRevenue},
 pipeline:{changes:changes.length,tested:tested.length,approvedByQa:audit.filter(a=>a.type==='qa.approve').length,authorized:audit.filter(a=>a.type==='cto.authorize').length,published:changes.filter(ch=>ch.status==='DEPLOYED').length,rejected:changes.filter(ch=>['QA_REJECTED','CTO_REJECTED'].includes(ch.status)).length,defectiveArtifactsWithObservedFailedTests:discovered.length,executedSuites:[...new Set(tested.flatMap(ch=>ch.reports.filter(r=>!r.obsolete).map(r=>r.suite)))],coverage:'Suites realmente ejecutadas. Un resultado verde no implica ausencia de defectos.'},
 cto:{authorizedOperatingCapital:audit.filter(a=>a.type==='cto.budget').reduce((sum,a)=>sum+Number(a.effects.find(e=>e.startsWith('infraBudget.delta:'))?.split(':')[1]??0),0),operatingCapitalInitiallyAllocated:g.duration*.5,remainingOperatingBudget:c.infraBudget,reservedForChanges:c.reserved,publicationCost:changes.filter(ch=>ch.status==='DEPLOYED').reduce((sum,ch)=>sum+ch.cost,0),servers:c.servers,observedCapital:c.capital,observedRevenue:c.revenue,meanObservedQueue:capacitySamples.length?capacitySamples.reduce((s,p)=>s+p!.queue,0)/capacitySamples.length:0},
 unresolvedDefinitiveCorrection:'No se determina automáticamente una reparación definitiva a partir del cese de solicitudes.'};
}
