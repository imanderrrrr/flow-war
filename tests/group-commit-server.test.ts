import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {io,type Socket} from 'socket.io-client';
import type {Result} from '../shared/types.js';

type Client={socket:Socket;cookie:string;companyId:number|null};
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function room(){
 const dir=mkdtempSync(join(tmpdir(),'flow-group-commit-')),probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
 const base=`http://127.0.0.1:${port}`;let child:ChildProcess|undefined,stderr='';
 // The benchmark preload releases commands at declared ticks, so the whole set reaches the server in one batch.
 const launch=(preloads:string[],env:Record<string,string>={})=>{stderr='';child=spawn(process.execPath,[...preloads.flatMap(p=>['--require',resolve(p)]),'--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(port),FLOW_PERF_PROBE:join(dir,'probe.json'),...env},stdio:['ignore','ignore','pipe']});child.stderr!.on('data',b=>stderr+=b);return child;};
 const ready=async()=>{for(let i=0;;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}assert(i<300,`startup: ${stderr.slice(-500)}`);await delay(30);}};
 const credentials=()=>JSON.parse(readFileSync(join(dir,'access.json'),'utf8')).credentials as {code:string;identity:{role:string;companyId:number|null}}[];
 const login=async(role:string,companyId:number|null):Promise<Client>=>{const c=credentials().find(c=>c.identity.role===role&&c.identity.companyId===companyId)!,r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:c.code})});assert(r.ok);const cookie=r.headers.get('set-cookie')!.split(';')[0];return {cookie,companyId,socket:io(base,{autoConnect:false,forceNew:true,reconnection:false,transports:['websocket'],extraHeaders:{Cookie:cookie}})};};
 const connect=async(c:Client)=>{const connected=new Promise<void>((resolve,reject)=>{c.socket.once('connect',resolve);c.socket.once('connect_error',reject);});c.socket.connect();await connected;};
 const send=(c:Client,type:string,payload?:Record<string,unknown>,id:string=crypto.randomUUID())=>new Promise<Result>((res,rej)=>c.socket.timeout(10000).emit('command',{id,type,payload,companyId:c.companyId??undefined},(err:Error|null,r:Result)=>err?rej(err):res(r)));
 const schedule=(c:Client,at:number,order:number,type:string,payload:Record<string,unknown>,id:string)=>new Promise<{result?:Result;tick?:number;error?:string}>(res=>c.socket.timeout(10000).emit('command',{id,type,payload,companyId:c.companyId??undefined},{benchmarkAt:at,benchmarkOrder:order},(err:Error|null,result:Result,meta?:{benchmarkTick:number})=>res(err?{error:err.message}:{result,tick:meta?.benchmarkTick})));
 const tick=async(c:Client)=>(await (await fetch(base+'/api/snapshot',{headers:{Cookie:c.cookie}})).json()).tick as number;
 const read=<T>(fn:(db:DatabaseSync)=>T)=>{const db=new DatabaseSync(join(dir,'game.sqlite'),{readOnly:true});try{return fn(db);}finally{db.close();}};
 const close=async(clients:Client[])=>{for(const c of clients)c.socket.disconnect();if(child&&child.exitCode===null&&child.signalCode===null){const end=once(child,'exit');child.kill('SIGTERM');await end;}rmSync(dir,{recursive:true,force:true});};
 return {launch,ready,login,connect,send,schedule,tick,read,close,get child(){return child!;},get stderr(){return stderr;}};
}
const chat=(text:string)=>({channel:'equipo-interno',text,refs:[]});

test('group commit: SIGKILL inside a batch commits nothing, answers nothing, and the same IDs apply exactly once after restart',{timeout:60000},async()=>{
 const r=await room();const clients:Client[]=[];
 try{
  r.launch(['scripts/performance-probe.cjs','tests/group-commit-kill.cjs'],{FLOW_GROUP_COMMIT:'1',FLOW_TEST_KILL_AT_ROW:'4'});await r.ready();
  const teacher=await r.login('operator',null);clients.push(teacher);for(let c=0;c<5;c++)clients.push(await r.login('backend',c));for(const c of clients)await r.connect(c);
  assert((await r.send(teacher,'room.speed',{speed:20})).ok);assert((await r.send(teacher,'room.start')).ok);
  const at=Math.ceil(await r.tick(teacher))+10,batch=clients.slice(1).flatMap((c,i)=>[0,1].map(j=>({c,id:`crash-${i}-${j}`,text:`lote ${i}.${j}`})));
  const exited=once(r.child,'exit'),answers=batch.map((m,k)=>r.schedule(m.c,at,k,'chat.send',chat(m.text),m.id));
  const [,signal]=await exited;assert.equal(signal,'SIGKILL',r.stderr.slice(-500));
  for(const answer of await Promise.all(answers))assert.equal(answer.result,undefined,'no command of the batch is acknowledged');
  const committed=r.read(db=>{
   assert.equal(db.prepare("SELECT count(*) AS n FROM commands WHERE id LIKE 'crash-%'").get()!.n,0);
   assert.equal(db.prepare("SELECT count(*) AS n FROM slack_messages WHERE json_extract(body,'$.source')='human'").get()!.n,0);
   return JSON.parse((db.prepare('SELECT state FROM game').get() as {state:string}).state);
  });
  // A periodic persist may commit tick `at` itself just before the batch is released at that tick.
  assert(committed.tick<=at,'the durable state predates the batch');
  assert(!Object.keys(committed.slack.receipts).some(key=>key.includes(':crash-')),'no receipt of the batch is durable');
  assert(!committed.slack.messages.some((m:{source:string})=>m.source==='human'),'no message of the batch is durable');
  r.launch([]);await r.ready();
  const restored=r.read(db=>JSON.parse((db.prepare('SELECT state FROM game').get() as {state:string}).state));
  for(const key of ['generation','tick','companies','market','changes','actions','slack','dvrEnabled'])assert.deepEqual(restored[key],committed[key],`recovery ${key}`);
  for(const c of clients)await r.connect(c);
  const results=await Promise.all(batch.map(m=>r.send(m.c,'chat.send',chat(m.text),m.id)));assert(results.every(x=>x.ok),JSON.stringify(results));
  assert.deepEqual(await Promise.all(batch.map(m=>r.send(m.c,'chat.send',chat(m.text),m.id))),JSON.parse(JSON.stringify(results)),'resent IDs return the committed results');
  r.read(db=>{
   assert.equal(db.prepare("SELECT count(*) AS n FROM commands WHERE id LIKE 'crash-%'").get()!.n,10);
   assert.equal(db.prepare("SELECT count(*) AS n FROM slack_messages WHERE json_extract(body,'$.source')='human'").get()!.n,10,'each message exactly once');
  });
 }finally{await r.close(clients);}
});

for(const mode of ['1','0'])test(`scheduled commands are applied, committed and acknowledged at their declared tick (FLOW_GROUP_COMMIT=${mode})`,{timeout:60000},async()=>{
 const r=await room();const clients:Client[]=[];
 try{
  r.launch(['scripts/performance-probe.cjs'],{FLOW_GROUP_COMMIT:mode});await r.ready();
  const teacher=await r.login('operator',null);clients.push(teacher);for(let c=0;c<5;c++)clients.push(await r.login('backend',c),await r.login('devops',c));for(const c of clients)await r.connect(c);
  assert((await r.send(teacher,'room.dvr',{enabled:true})).ok);assert((await r.send(teacher,'room.speed',{speed:20})).ok);assert((await r.send(teacher,'room.start')).ok);
  const first=Math.ceil(await r.tick(teacher))+10,plan:{c:Client;at:number;id:string;type:string;payload:Record<string,unknown>}[]=[];
  for(const at of [first,first+1,first+3])for(const c of clients.slice(1))plan.push({c,at,id:`at-${at}-${c.companyId}-${plan.length}`,...(c.companyId!==null&&plan.length%2?{type:'infra.scale',payload:{delta:1}}:{type:'chat.send',payload:chat(`tick ${at}`)})});
  const answers=await Promise.all(plan.map((p,k)=>r.schedule(p.c,p.at,k,p.type,p.payload,p.id)));
  answers.forEach((a,k)=>{assert.equal(a.error,undefined);assert.equal(a.tick,plan[k].at,`${plan[k].id} acknowledged at its tick`);assert(a.result,plan[k].id);});
  const applied=r.read(db=>new Map((db.prepare('SELECT at,body FROM history_inputs').all() as {at:number;body:string}[]).map(row=>[JSON.parse(row.body).command.id as string,row.at])));
  for(const p of plan)assert.equal(applied.get(p.id),p.at,`${p.id} applied at its declared tick`);
 }finally{await r.close(clients);}
});
