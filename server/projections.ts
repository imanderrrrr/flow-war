import type {PurchaseRequest,TrafficReceipt,RequestResult,Identity} from '../shared/types.js';
import type {Observation} from '../shared/observability.js';

function pick(value: Record<string, any>, keys: readonly string[]) {
 return Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,structuredClone(value[key])]));
}
export function visibleResult(result: RequestResult) {
 return pick(result,['status','reason','at','revenue','lostRevenue','capitalDelta','service','operation']) as Omit<RequestResult,'defectLoss'>;
}
/** An explicit wire contract: unknown engine fields are private by default. */
export function visibleRequest(request: PurchaseRequest | TrafficReceipt) {
 const value=pick(request,['id','intentId','companyId','customerId','executionVersion','type','arrivalAt','admittedAt','startedAt','finishedAt','latencyMs','deadline','status','quantity','committed','oversold','paid','duplicates','retryCount','transaction','stage','service']);
 value.path=request.path.map(node=>({id:node.id,type:node.type,...('data' in node && node.data.value!==undefined?{value:node.data.value}: 'value' in node?{value:node.value}:{})}));
 value.journey=pick(request.journey,['from','to','at','duration']);
 if ('waits' in request) value.waits=request.waits.map(wait=>pick(wait,['service','enteredAt','exitedAt','position','exit']));
 if ('trace' in request) value.trace=request.trace.map(event=>pick(event,['type','at','stock','version']));
 if (request.result) value.result=visibleResult(request.result);
 return value;
}
export function visibleFact(f: Observation, identity: Identity): Observation {
 if(identity.role==='operator')return f;
 const keys: Record<string,string[]>={
  'request.settled':['requestId','customerId','type','version','transaction','duplicates','oversold','latencyMs'],
  'action.confirmed':['type','actor','ok','effects'],
  'maintenance.changed':['from','to','actor','policy'],
  'crisis.threshold':['from','to','threshold'],
  'crisis.entered':['reputation','episode','policy'],
  'crisis.exited':['reputation','episode','threshold'],
  'generation.interrupted':['generation','tick','previousStatus','reason','receivedAt'],
  'server.recovered':['status'],
  'customer.migrated':['id','from','to','at','reason','color','customerId'],
  'migration.group':['count'],
  'telemetry.sample':['policy','results','errors','errorRate','latencyMs','queue','unavailable','generated','capacity'],
 };
 const data=pick(f.data,keys[f.kind]??['text','tone']);
 if(f.kind==='request.settled'&&f.data.result)data.result=visibleResult(f.data.result as RequestResult);
 return {id:f.id,at:f.at,companyId:f.companyId,kind:f.kind,refs:[...f.refs],data};
}
export function visibleMetrics<T extends {badQuality:any;pipeline:any;cto:any;incidents:any;policy:string;mttrPolicy:string;unresolvedDefinitiveCorrection:string}>(metrics:T,identity:Identity) {
 if(identity.role==='operator')return metrics;
 return {
  policy:metrics.policy,incidents:metrics.incidents,mttrPolicy:metrics.mttrPolicy,
  badQuality:{demonstratedDefectCost:null,unattributedLostRevenue:metrics.badQuality.unattributedLostRevenue,costPolicy:'La atribución interna de defectos está reservada al docente. Consulta tus resultados operativos y pruebas.'},
  pipeline:pick(metrics.pipeline,['changes','tested','approvedByQa','authorized','published','rejected','executedSuites','coverage']),
  cto:metrics.cto,unresolvedDefinitiveCorrection:metrics.unresolvedDefinitiveCorrection,
 };
}
