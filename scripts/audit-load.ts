import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir,cpus} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {io,type Socket} from 'socket.io-client';
import {createGame,applyCommand,step} from '../server/engine.js';
import {createGameWriter} from '../server/storage.js';
import type {Command,Result,Snapshot} from '../shared/types.js';
const mode=process.env.FLOW_AUDIT_LABEL??'after',dir=mkdtempSync(join(tmpdir(),'flow-audit-load-')),port=24000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
const db=new DatabaseSync(join(dir,'game.sqlite'));db.exec('PRAGMA journal_mode=WAL;CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');
const write=createGameWriter(db),g=createGame(1200),op={id:'operator',role:'operator',companyId:null} as const;
applyCommand(g,op,{id:'start',type:'room.start'});write(g);for(let i=0;i<1200;i++){step(g);if(i%100===0)write(g);}applyCommand(g,op,{id:'finish',type:'room.finish'});write(g);applyCommand(g,op,{id:'reset',type:'room.reset'});write(g);db.close();
const preload=join(dir,'metrics.cjs'),metricsFile=join(dir,'metrics.json');
writeFileSync(preload,`const {monitorEventLoopDelay}=require('node:perf_hooks');const fs=require('node:fs');const h=monitorEventLoopDelay({resolution:10});h.enable();let heap=0;const t=setInterval(()=>heap=Math.max(heap,process.memoryUsage().heapUsed),20);t.unref();process.on('exit',()=>fs.writeFileSync(${JSON.stringify(metricsFile)},JSON.stringify({eventLoop:{p50:h.percentile(50)/1e6,p95:h.percentile(95)/1e6,p99:h.percentile(99)/1e6,max:h.max/1e6},heapMaxMiB:heap/1024**2})));`);
const child=spawn(process.execPath,['--require',preload,'--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(port)},stdio:['ignore','ignore','pipe']});let stderr='';child.stderr!.on('data',b=>stderr+=b);const sockets:Socket[]=[];
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const pct=(v:number[])=>{const a=[...v].sort((a,b)=>a-b);return Object.fromEntries([.5,.95,.99].map(p=>['p'+p*100,a[Math.floor((a.length-1)*p)]??null]));};
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await delay(50);}
 const {credentials}=JSON.parse(readFileSync(join(dir,'access.json'),'utf8'));
 const login=async(role:string,companyId:number|null)=>{const code=credentials.find((c:any)=>c.identity.role===role&&c.identity.companyId===companyId).code;const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const cookie=r.headers.get('set-cookie')!.split(';')[0];const socket=io(base,{forceNew:true,transports:['websocket'],extraHeaders:{Cookie:cookie}});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return{socket,cookie};};
 const teacher=await login('operator',null),student=await login('backend',0),mate=await login('qa',0);let snapshots=0,chatDeliveries=0,lastTick=0;const intervals:number[]=[],gaps:number[]=[];let last=performance.now();
 mate.socket.on('snapshot',(s:Snapshot)=>{snapshots++;const now=performance.now();intervals.push(now-last);last=now;if(s.tick>lastTick){gaps.push(now-(lastTick?last:now));lastTick=s.tick;}chatDeliveries=Math.max(chatDeliveries,s.slack?.filter(m=>m.source==='human').length??0);});
 const send=(socket:Socket,type:string,payload?:Record<string,unknown>)=>new Promise<Result>((resolve,reject)=>socket.timeout(15000).emit('command',{id:crypto.randomUUID(),type,companyId:0,payload} satisfies Command,(err:Error|null,result:Result)=>err?reject(err):resolve(result)));
 await send(teacher.socket,'room.start');const commands:number[]=[],chats:number[]=[],queries:number[]=[],statuses:Record<string,number>={};let errors=0,cancelled=0;
 const start=performance.now();
 const actions=(async()=>{for(let i=0;i<24;i++){const at=performance.now();const r=await send(teacher.socket,'room.speed',{speed:1});commands.push(performance.now()-at);if(!r.ok)errors++;await delay(180);}})();
 const chat=(async()=>{for(let i=0;i<3;i++){const at=performance.now();const r=await send(student.socket,'chat.send',{channel:'equipo-interno',text:`carga-${i}`,refs:[]});chats.push(performance.now()-at);if(!r.ok)errors++;await delay(1500);}})();
 const lane=async()=>{for(let i=0;i<12;i++){const at=performance.now();const r=await fetch(base+`/api/dvr/0?companyId=0&at=${119.9-(i%3)/10}`,{headers:{Cookie:teacher.cookie}});await r.text();queries.push(performance.now()-at);statuses[r.status]=(statuses[r.status]??0)+1;await delay(100);}};
 await Promise.all([actions,chat,lane(),lane()]);
 // Real obsolete HTTP queries; cancellation must free worker capacity in the corrected server.
 for(let i=0;i<8;i++){const controller=new AbortController();const pending=fetch(base+`/api/dvr/0?companyId=0&at=${118.9-i/10}`,{headers:{Cookie:teacher.cookie},signal:controller.signal}).catch(e=>{if(e.name==='AbortError')cancelled++;else errors++;});await delay(20);controller.abort();await pending;}
 await send(teacher.socket,'room.pause');for(const s of sockets)s.disconnect();const exited=once(child,'exit');child.kill('SIGTERM');await exited;
 const metrics=JSON.parse(readFileSync(metricsFile,'utf8'));
 writeFileSync(`docs/benchmarks/audit-fixes/load-${mode}.json`,JSON.stringify({label:mode,hardware:{node:process.version,cpu:cpus()[0]?.model},durationMs:performance.now()-start,connections:3,queryConcurrency:2,queries:queries.length,queryStatus:statuses,reconstructionHttpMs:pct(queries),commandAckMs:pct(commands),chatAckMs:pct(chats),snapshots,chatDeliveries,finalTick:lastTick,snapshotCadenceMs:{...pct(intervals),max:Math.max(...intervals)},cancelled,errors,...metrics},null,2));
 console.log(readFileSync(`docs/benchmarks/audit-fixes/load-${mode}.json`,'utf8'));
}finally{for(const s of sockets)s.disconnect();if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}rmSync(dir,{recursive:true,force:true});if(child.exitCode)console.error(stderr.slice(-2000));}
