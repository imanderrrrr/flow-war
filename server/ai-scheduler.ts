export type RequestStatus={id:string;actor:string;companyId:number;state:'QUEUED'|'RUNNING'|'COMPLETED'|'FAILED'|'CANCELLED'|'TIMEOUT';queuedAt:number;startedAt?:number;finishedAt?:number;waitMs?:number;durationMs?:number;code?:string};
type Task={status:RequestStatus;run:(signal:AbortSignal)=>Promise<unknown>;resolve:(v:any)=>void;reject:(e:Error)=>void;controller:AbortController;timer?:ReturnType<typeof setTimeout>};
export class ScheduleError extends Error{constructor(public code:string){super(code);}}
const cap=(name:string,fallback:number,max:number)=>{const n=Number(process.env[name]??fallback);return Number.isInteger(n)&&n>=1&&n<=max?n:fallback;};
/** Five company queues plus one for the teacher's room screen, so room orders never take a company's slot. */
export const ROOM_SLOT=5;const SLOTS=6;
export class AiScheduler{
  private queues:Task[][]=Array.from({length:SLOTS},()=>[]);private active=0;private companies=new Map<number,number>();private tasks=new Map<string,Task>();private cursor=0;
  /** perCompany bounds the calls one company can hold, so a burst from one team never takes every slot. */
  constructor(public capacity=cap('FLOW_AI_CONCURRENCY',5,20),private queueLimit=cap('FLOW_AI_QUEUE_LIMIT',30,120),private timeout=cap('FLOW_AI_TIMEOUT_MS',30000,120000),public perCompany=cap('FLOW_AI_COMPANY_CONCURRENCY',2,10)){}
  schedule<T>(id:string,actor:string,companyId:number,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    if(!Number.isInteger(companyId)||companyId<0||companyId>=SLOTS)throw new ScheduleError('FORBIDDEN');
    if([...this.tasks.values()].some(t=>t.status.actor===actor&&['QUEUED','RUNNING'].includes(t.status.state)))throw new ScheduleError('AI_BUSY');
    if(this.queues.flat().length>=this.queueLimit||this.queues[companyId].length>=6)throw new ScheduleError('AI_QUEUE_FULL');
    const key=`${actor}:${id}`;this.tasks.delete(key);
    // Completed metadata is bounded; durable proposal/conversation audit lives in the game transaction.
    for(const [k,t]of this.tasks)if(this.tasks.size>=200&&!['QUEUED','RUNNING'].includes(t.status.state))this.tasks.delete(k);
    return new Promise<T>((resolve,reject)=>{const task:Task={status:{id,actor,companyId,state:'QUEUED',queuedAt:Date.now()},run,resolve,reject,controller:new AbortController()};
      this.tasks.set(key,task);this.queues[companyId].push(task);task.timer=setTimeout(()=>this.stop(task,'TIMEOUT'),this.timeout);this.pump();});
  }
  status(actor:string,id?:string){return [...this.tasks.values()].filter(t=>t.status.actor===actor&&(!id||t.status.id===id)).map(t=>({...t.status}));}
  metrics(){return {capacity:this.capacity,perCompany:this.perCompany,active:this.active,queues:this.queues.map(q=>q.length),recent:[...this.tasks.values()].map(t=>({...t.status}))};}
  cancel(actor:string,id:string){const task=this.tasks.get(`${actor}:${id}`);if(!task)return false;this.stop(task,'CANCELLED');return true;}
  private stop(t:Task,state:'CANCELLED'|'TIMEOUT'){
    if(!['QUEUED','RUNNING'].includes(t.status.state))return;
    const queued=t.status.state==='QUEUED';t.status.state=state;t.status.finishedAt=Date.now();clearTimeout(t.timer);t.controller.abort();
    if(queued)this.queues[t.status.companyId]=this.queues[t.status.companyId].filter(x=>x!==t);
    t.reject(new ScheduleError(state));this.pump();
  }
  private pump(){
    while(this.active<this.capacity){let task:Task|undefined;
      for(let i=0;i<SLOTS;i++){const company=(this.cursor+i)%SLOTS;if((this.companies.get(company)??0)<this.perCompany&&this.queues[company].length){task=this.queues[company].shift();this.cursor=(company+1)%5;break;}}
      if(!task)return;const t=task;this.active++;this.companies.set(t.status.companyId,(this.companies.get(t.status.companyId)??0)+1);t.status.state='RUNNING';t.status.startedAt=Date.now();t.status.waitMs=t.status.startedAt-t.status.queuedAt;
      // A cancelled provider retains its concurrency slot until it settles. An uncooperative transport cannot cause unlimited calls.
      void Promise.resolve().then(()=>t.run(t.controller.signal)).then(value=>{if(t.status.state==='RUNNING'){t.status.state='COMPLETED';t.resolve(value);}},err=>{if(t.status.state==='RUNNING'){t.status.state='FAILED';t.status.code=String(err?.code??'PROVIDER_ERROR');t.reject(err);}}).finally(()=>{clearTimeout(t.timer);t.status.finishedAt??=Date.now();t.status.durationMs=t.status.finishedAt-t.status.startedAt!;this.active--;const held=(this.companies.get(t.status.companyId)??1)-1;if(held>0)this.companies.set(t.status.companyId,held);else this.companies.delete(t.status.companyId);this.pump();});
    }
  }
}
