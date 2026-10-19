import {Worker} from 'node:worker_threads';
import type {DvrQuery} from './dvr-query.js';
export class DvrBusy extends Error {constructor(public status=503,message='El DVR está ocupado. Espera un momento y vuelve a intentarlo.'){super(message);}}
type Task={id:number;query:DvrQuery;resolve:(value:any)=>void;reject:(error:Error)=>void;signal?:AbortSignal;abort?:()=>void;timer?:ReturnType<typeof setTimeout>};
type Slot={worker:Worker;task?:Task;stopping?:boolean};
export type PoolOptions={workers?:number;queue?:number;perUser?:number;heapMiB?:number;timeoutMs?:number};
/** CPU, SQLite reads, replay and response construction all stay off the simulation thread. */
export class DvrPool {
 private slots:Slot[]=[];private queue:Task[]=[];private sequence=0;private closed=false;
 readonly limits:{workers:number;queue:number;perUser:number;heapMiB:number;timeoutMs:number};
 constructor(private path:string,options:PoolOptions={}){
  this.limits={workers:options.workers??2,queue:options.queue??8,perUser:options.perUser??2,heapMiB:options.heapMiB??512,timeoutMs:options.timeoutMs??15000};
  for(const [key,min,max]of [['workers',1,4],['queue',0,32],['perUser',1,4],['heapMiB',64,1024],['timeoutMs',100,60000]]as const){const n=this.limits[key];if(!Number.isInteger(n)||n<min||n>max)throw Error(`Límite DVR inválido: ${key}`);}
 }
 run(query:DvrQuery,signal?:AbortSignal):Promise<any>{
  if(this.closed)return Promise.reject(new DvrBusy());
  if(signal?.aborted)return Promise.reject(new DvrBusy(499,'Consulta cancelada.'));
  const tasks=[...this.queue,...this.slots.flatMap(s=>s.task?[s.task]:[])];
  if(tasks.filter(t=>t.query.identity.id===query.identity.id).length>=this.limits.perUser)return Promise.reject(new DvrBusy(429));
  if(this.slots.length>=this.limits.workers&&this.slots.every(s=>s.task||s.stopping)&&this.queue.length>=this.limits.queue)return Promise.reject(new DvrBusy());
  return new Promise((resolve,reject)=>{
   const task:Task={id:++this.sequence,query:structuredClone(query),resolve,reject,signal};
   task.abort=()=>this.cancel(task,new DvrBusy(499,'Consulta cancelada.'));
   signal?.addEventListener('abort',task.abort,{once:true});
   task.timer=setTimeout(()=>this.cancel(task,new DvrBusy(503,'La consulta excedió el tiempo disponible. Intenta un intervalo menor.')),this.limits.timeoutMs);
   this.queue.push(task);this.pump();
  });
 }
 private create():Slot{
  const worker=new Worker(new URL('./dvr-worker.mjs',import.meta.url),{workerData:{path:this.path},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:this.limits.heapMiB,maxYoungGenerationSizeMb:32,stackSizeMb:4}}),slot:Slot={worker};this.slots.push(slot);
  worker.on('message',message=>{if(!slot.task||message.id!==slot.task.id)return;const task=slot.task;slot.task=undefined;this.finish(task,message.error?new DvrBusy(message.error.status,message.error.message):undefined,message.result);worker.unref();this.pump();});
  worker.on('error',()=>this.fail(slot));worker.on('exit',()=>this.fail(slot));worker.unref();return slot;
 }
 private pump(){
  while(this.queue.length){const slot=this.slots.find(s=>!s.task&&!s.stopping)??(this.slots.length<this.limits.workers?this.create():undefined);if(!slot)return;slot.task=this.queue.shift()!;slot.worker.ref();slot.worker.postMessage({id:slot.task.id,query:slot.task.query});}
 }
 private finish(task:Task,error?:Error,result?:any){clearTimeout(task.timer);if(task.abort)task.signal?.removeEventListener('abort',task.abort);if(error)task.reject(error);else task.resolve(result);}
 private fail(slot:Slot){if(!this.slots.includes(slot))return;this.slots=this.slots.filter(s=>s!==slot);if(slot.task)this.finish(slot.task,new DvrBusy(503,'La consulta histórica falló. Puedes volver a intentarlo.'));void slot.worker.terminate();this.pump();}
 private cancel(task:Task,error:Error){
  const index=this.queue.indexOf(task);if(index>=0){this.queue.splice(index,1);this.finish(task,error);return;}
  const slot=this.slots.find(s=>s.task===task);if(!slot)return;
  // Keep the slot occupied until terminate resolves: cancellation must not oversubscribe CPU/memory.
  slot.task=undefined;slot.stopping=true;this.finish(task,error);
  void slot.worker.terminate().finally(()=>{this.slots=this.slots.filter(s=>s!==slot);this.pump();});
 }
 async close(){this.closed=true;for(const t of this.queue.splice(0))this.finish(t,new DvrBusy());const slots=this.slots.splice(0);await Promise.all(slots.map(async s=>{if(s.task)this.finish(s.task,new DvrBusy());await s.worker.terminate();}));}
 /** Operational state used by tests/admin, never carries simulation objects. */
 get stats(){return {workers:this.slots.length,running:this.slots.filter(s=>s.task).length,queued:this.queue.length,limits:this.limits};}
}
