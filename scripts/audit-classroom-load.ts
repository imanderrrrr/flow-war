import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,spawnSync,execFileSync,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,statSync,readdirSync} from 'node:fs';
import {tmpdir,cpus,totalmem,freemem,platform,release} from 'node:os';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {io,type Socket} from 'socket.io-client';
import {createGame,applyCommand,step,initialGraph} from '../server/engine.js';
import {createGameWriter} from '../server/storage.js';
import {serializeGame} from '../server/persistence.js';
import {clearBuffer,checkpoint} from '../server/observability.js';
import {adminSchema,exportGeneration,storageUsage} from '../server/history-admin.js';
import {acquireStorageLease} from '../server/storage-lease.js';
import {queryDvr} from '../server/dvr-query.js';
import {assertMarket} from '../server/market.js';
import {crisisVisual} from '../shared/crisis.js';
import {marketScenario} from './market-scenarios.js';
import type {Identity,Snapshot,Result,Command,Graph} from '../shared/types.js';

const arg=(name:string,fallback:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')??fallback;
const duration=Number(arg('duration','1200')),speed=Number(arg('speed','20')),historyDuration=Number(arg('history-duration',String(duration))),label=arg('label',`${duration}s-${speed}x`);
assert([1200,1500].includes(duration)&&[1,20].includes(speed)&&[1200,1500].includes(historyDuration));assert(/^[a-zA-Z0-9-]+$/.test(label));
const root='docs/benchmarks/final-hardening',output=`${root}/classroom-${label}.json`;mkdirSync(root,{recursive:true});assert(!existsSync(output),'Use a new label; evidence must not be overwritten');
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources=['server','shared'].flatMap(d=>readdirSync(d).filter(f=>f.endsWith('.ts')||f.endsWith('.mjs')).map(f=>`${d}/${f}`)).concat(['scripts/audit-classroom-load.ts','scripts/audit-classroom-probe.cjs','scripts/market-scenarios.ts']).sort();
const sourceHash=()=>createHash('sha256').update(sources.map(f=>f+'\n'+readFileSync(f,'utf8')).join('\n')).digest('hex'),initialHash=sourceHash();
const metadata={sha,sourceDigest:initialHash,sourceFiles:sources,sourceDirty:execFileSync('git',['status','--porcelain','--',...sources],{encoding:'utf8'}).trim(),date:new Date().toISOString(),node:process.version,os:`${platform()} ${release()}`,cpu:cpus()[0]?.model,cores:cpus().length,totalRamBytes:totalmem(),freeRamBytes:freemem(),workers:2,parameters:{duration,speed,historyDuration,seed:8,population:5000,initialReputation:34,oneXWarmupSeconds:10,dvrConcurrency:2},clients:27,students:25,authenticatedSessions:26,publicConnections:1};
const dir=mkdtempSync(join(tmpdir(),'flow-classroom-')),path=join(dir,'game.sqlite'),archive=join(dir,'independent.sqlite'),control=join(dir,'control.json');
const started=performance.now(),report:any={...metadata,scenarios:{},commands:[],dvr:[],security:{},errors:[],segments:[],limitations:['Local loopback; Node Socket.IO clients do not render 27 browser UIs.','The 34-point reputation is an explicit pre-start scenario condition for all five companies. No live engine state is mutated.','Total process RSS includes worker memory; worker heap samples are not additive RSS.','SIGKILL telemetry is explicitly flushed immediately before killing; crash tail may omit the last sampling interval.']};
let child:ChildProcess|undefined,segment=0,stderr='',finished=false,checkpointCount=0;
const entries:{socket:Socket;identity:Identity|null;cookie:string;latest?:Snapshot;stamp?:number;deliveries:Set<string>;lastArrival?:number}[]=[];
const ack:number[]=[],chatAck:number[]=[],chatDelivery:number[]=[],snapshotLatency:number[]=[],snapshotCadence:number[]=[],snapshotSizes:number[]=[];
const sent=new Map<string,{at:number;companyId:number;observers:Set<string>;refs?:string[];command:Command}>();let snapshots=0,disconnects=0,reconnects=0,timeouts=0,leaks=0,workerFailureObserved=false;
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const pct=(v:number[])=>{const a=[...v].sort((a,b)=>a-b);return{n:a.length,p50:a[Math.ceil(a.length*.5)-1]??null,p95:a[Math.ceil(a.length*.95)-1]??null,p99:a[Math.ceil(a.length*.99)-1]??null,max:a.at(-1)??null};};
const restricted=new Set(['trafficClass','attackKind','securityAllowed','breach','effectCodes','defectLoss','contractPrice','execution','releaseOnInterrupt','fraudRate']);
function noInternal(v:any){if(!v||typeof v!=='object')return;for(const [key,value]of Object.entries(v)){assert(!restricted.has(key),`restricted diagnostic: ${key}`);noInternal(value);}}
function publicState(s:Snapshot){return JSON.stringify({tick:s.tick,generation:s.generation,status:s.status,companies:s.companies.map(c=>({id:c.id,customers:c.customers,capital:c.capital,reputation:c.reputation})),unserved:s.unserved});}
async function until(predicate:()=>boolean,description:string,timeout=30000){const at=performance.now();while(!predicate()){assert(performance.now()-at<timeout,description);if(child?.exitCode!==null&&child?.exitCode!==undefined)throw Error(`server exited: ${description}`);await delay(25);}}
async function freePort(){const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));return port;}
const port=await freePort(),base=`http://127.0.0.1:${port}`;
function get(url:string,e?:typeof entries[number]){return fetch(base+url,{headers:{Cookie:e?.cookie??''}});}
async function launch(){segment++;child=spawn(process.execPath,['--require',resolve('scripts/audit-classroom-probe.cjs'),'--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(port),FLOW_DVR_WORKERS:'2',FLOW_PROBE_OUTPUT:join(dir,`probe-${segment}.json`),FLOW_PROBE_CONTROL:control},stdio:['ignore','ignore','pipe']});child.stderr!.on('data',b=>stderr+=String(b));
 const at=performance.now();for(;;){try{if((await get('/api/health')).ok)break;}catch{}assert(child.exitCode===null,`startup exit ${child.exitCode}: ${stderr.slice(-1500)}`);assert(performance.now()-at<15000,'server readiness');await delay(50);}}
async function stop(signal:'SIGTERM'|'SIGKILL'){if(!child||child.exitCode!==null||child.signalCode!==null)return;const end=once(child,'exit');child.kill(signal);const [code,sig]=await end;await delay(100);const file=join(dir,`probe-${segment}.json`);report.segments.push({segment,exitCode:code,signal:sig,...(existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{missing:true})});}
async function flushProbe(failWorker=false){const id=randomUUID();writeFileSync(control,JSON.stringify({id,failWorker}));await until(()=>{const f=join(dir,`probe-${segment}.json`);return existsSync(f)&&JSON.parse(readFileSync(f,'utf8')).lastControl===id;},'probe control not acknowledged',5000);}
async function connect(e:typeof entries[number]){const p=new Promise<void>((res,rej)=>{e.socket.once('connect',res);e.socket.once('connect_error',rej);});e.socket.connect();await p;}
async function send(e:typeof entries[number],type:string,payload?:Record<string,unknown>,changeId?:string,id:string=randomUUID(),purpose='work',companyId=e.identity?.companyId??undefined){const cmd:Command={id,type,payload,changeId,companyId},t=performance.now();const result=await new Promise<Result>((res,rej)=>e.socket.timeout(15000).emit('command',cmd,(err:Error|null,r:Result)=>{if(err){timeouts++;rej(Error(`${type}: ACK timeout`));}else res(r);}));const ms=performance.now()-t;if(type==='chat.send')chatAck.push(ms);else ack.push(ms);report.commands.push({identity:e.identity?.id??'public',type,id,atTick:e.latest?.tick,purpose,ok:result.ok,code:result.code??null,error:result.error??null,ms});return result;}
function requireOk(r:Result){assert(r.ok,r.error);return r;}
async function waitTick(tick:number){await until(()=>teacher.latest!.tick>=tick||teacher.latest!.status==='FINISHED',`tick ${tick}`,Math.max(30000,(tick-(teacher?.latest?.tick??0))*1000/speed*2));}
let teacher:typeof entries[number],student:typeof entries[number];
const member=(companyId:number,role:string)=>entries.find(e=>e.identity?.companyId===companyId&&e.identity.role===role)!;
function atomicGraph(){const graph=initialGraph('backend'),edge=graph.edges.find(e=>e.target==='backend-write')!;graph.nodes.push({id:'classroom-atomic',type:'atomic',position:{x:0,y:0},data:{label:'atomic',value:1}});graph.edges=graph.edges.filter(e=>e!==edge);graph.edges.push({id:'atomic-in',source:edge.source,target:'classroom-atomic'},{id:'atomic-out',source:'classroom-atomic',target:edge.target});return graph;}
function securityGraph(){const graph:Graph={nodes:['entry','auth','waf','bot','exit'].map((type,i)=>({id:`security-${type}`,type,position:{x:i*100,y:0},data:{label:type,...(type==='bot'?{value:100}:{})}})),edges:[]};for(let i=1;i<graph.nodes.length;i++)graph.edges.push({id:`security-edge-${i}`,source:graph.nodes[i-1].id,target:graph.nodes[i].id});return graph;}
async function pipeline(companyId:number,domain:'backend'|'security'){
 const actor=member(companyId,domain),qa=member(companyId,'qa'),cto=member(companyId,'cto'),devops=member(companyId,'devops');
 requireOk(await send(actor,'change.submit',{graph:domain==='backend'?atomicGraph():securityGraph(),revision:0}));
 const snap=await(await get('/api/snapshot',actor)).json() as Snapshot,change=snap.changes.find(c=>c.companyId===companyId&&c.domain===domain)!;assert(change,'new change must exist');
 requireOk(await send(qa,'qa.run',{suite:domain==='backend'?'Concurrencia':'Seguridad'},change.id));
 await until(()=>qa.latest?.changes.some(c=>c.id===change.id&&c.status==='QA_PENDING'&&c.reports.length>0)??false,`QA completion ${companyId}/${domain}`,30000);
 requireOk(await send(qa,'qa.approve',{},change.id));requireOk(await send(cto,'cto.authorize',{},change.id));requireOk(await send(devops,'deploy.start',{strategy:'rolling'},change.id));
 await until(()=>devops.latest?.changes.find(c=>c.id===change.id)?.status==='DEPLOYED',`deployment ${companyId}/${domain}`,30000);
}
let progress:ReturnType<typeof setInterval>|undefined;
try{
 // Historical workload is built with the production engine and role pipeline,
 // every tick and all 5,000 people. No precomputed or synthetic replay output.
 const prepAt=performance.now(),db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL;CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');adminSchema(db);const write=createGameWriter(db),scenario=marketScenario(historyDuration,'A-equivalent',8),history=scenario.game;
 for(const c of history.companies)c.reputation=34;clearBuffer(history);checkpoint(history,serializeGame,true);write(history);
 for(let i=0;history.status==='RUNNING';i++){scenario.decide();step(history);if(i%100===0)write(history);}
 assert.equal(history.tick,historyDuration);assertMarket(history);write(history);
 const archived=exportGeneration(db,0,archive),expected=new Map<string,unknown>();
 const ats=[.5,10.5,historyDuration-.5,historyDuration];
 const ids=[{id:'operator',role:'operator',companyId:null},{id:'0-backend',role:'backend',companyId:0}] as Identity[];
 for(const identity of ids)for(const at of ats)expected.set(`${identity.id}:${at}`,JSON.parse(JSON.stringify(queryDvr(db,{kind:'frame',identity,generation:0,companyId:0,at}))));
 const receipt=(db.prepare('SELECT id FROM request_receipts WHERE generation=0 AND companyId=0 LIMIT 1').get() as {id:string}).id;
 const foreignReceipt=(db.prepare('SELECT id FROM request_receipts WHERE generation=0 AND companyId=1 LIMIT 1').get() as {id:string}).id;
 const historyDigest=()=>createHash('sha256').update(JSON.stringify(db.prepare('SELECT generation,seq,body FROM history_events WHERE generation=0 ORDER BY seq').all())).digest('hex');const savedHistoryDigest=historyDigest();
 const active=createGame(duration,8,1);for(const c of active.companies)c.reputation=34;clearBuffer(active);checkpoint(active,serializeGame,true);write(active);
 const visualBefore=serializeGame(active),visualAt=performance.now();for(let i=0;i<10000;i++)for(const c of active.companies)crisisVisual({...c.crisis,active:true,enteredAt:0},600);report.visual={calls:50000,totalMs:performance.now()-visualAt,economyUnchanged:serializeGame(active)===visualBefore,scope:'Pure derived visual function, not browser FPS; server does not run paper animation.'};assert(report.visual.economyUnchanged);
 report.scenarios.preparation={wallMs:performance.now()-prepAt,historicalTicks:historyDuration*10,historicalStatus:history.status,archiveDigest:archived.digest,expectedFrames:expected.size};
 await launch();const credentials=JSON.parse(readFileSync(join(dir,'access.json'),'utf8')).credentials as {code:string;identity:Identity}[];
 for(const cr of [...credentials.filter(c=>c.identity.role!=='product'),undefined]){
  let cookie='';if(cr){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:cr.code})});assert.equal(r.status,200);assert.deepEqual((await r.json()).identity,cr.identity);cookie=r.headers.get('set-cookie')!.split(';')[0];}
  const socket=io(base,{forceNew:true,autoConnect:false,reconnection:false,transports:['websocket'],extraHeaders:{Cookie:cookie}}),entry:typeof entries[number]={socket,identity:cr?.identity??null,cookie,deliveries:new Set()};entries.push(entry);
  socket.on('audit:stamp',s=>entry.stamp=s.at);socket.on('disconnect',()=>disconnects++);
  socket.on('snapshot',(s:Snapshot)=>{try{snapshots++;const now=performance.now();snapshotSizes.push(Buffer.byteLength(JSON.stringify(s)));if(entry.stamp!==undefined)snapshotLatency.push(performance.timeOrigin+now-entry.stamp);if(entry.lastArrival!==undefined)snapshotCadence.push(now-entry.lastArrival);entry.lastArrival=now;entry.latest=s;
   assert.deepEqual(s.identity,entry.identity);assert.equal(s.companies.reduce((n,c)=>n+c.customers,0)+s.unserved,5000);
   if(entry.identity?.role!=='operator'){
    if(snapshots<60||snapshots%97===0)noInternal(s);
    if(entry.identity?.companyId!=null){assert.equal(s.privateCompany?.id,entry.identity.companyId);assert(s.changes.every(c=>c.companyId===entry.identity!.companyId));for(const m of s.slack??[])if(m.companyId!==entry.identity.companyId){leaks++;assert.fail('cross-company delivery');}}
    else assert.equal(s.slack,undefined);
   }
   for(const m of s.slack??[]){const pending=sent.get(m.dedup);if(!pending)continue;assert.equal(m.companyId,pending.companyId);if(!entry.deliveries.has(m.dedup)){entry.deliveries.add(m.dedup);pending.observers.add(entry.identity!.id);chatDelivery.push(now-pending.at);}}
  }catch(e){report.errors.push((e as Error).message);}});
  await connect(entry);await until(()=>!!entry.latest,'initial snapshot',10000);
 }
 assert.equal(entries.length,27);teacher=entries.find(e=>e.identity?.role==='operator')!;student=member(0,'backend');const projector=entries.find(e=>!e.identity)!;
 assert.equal(new Set(entries.filter(e=>e.identity).map(e=>e.identity!.id)).size,26);assert(entries.every(e=>e.latest?.status==='LOBBY'));assert.equal(new Set(entries.map(e=>publicState(e.latest!))).size,1);
 report.scenarios.A={connections:entries.length,uniqueAuthenticatedIdentities:26,rolesPerCompany:['backend','security','qa','cto','devops'],lobbyCoherent:true,initialPopulation:5000,initialCustomersPerCompany:[1000,1000,1000,1000,1000]};
 const otherPort=await freePort(),second=spawnSync(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(otherPort)},encoding:'utf8',timeout:5000});assert.equal(second.status,1);assert.match(second.stderr,/usando el almacenamiento/);
 const admin=credentials.find(c=>c.identity.role==='operator')!,studentCode=credentials.find(c=>c.identity.id==='0-backend')!;
 const cli=(code:string,args:string[])=>spawnSync(process.execPath,['--import','tsx','scripts/history-admin.ts',...args],{env:{...process.env,FLOW_DATA_DIR:dir,FLOW_ADMIN_CODE:code},encoding:'utf8',timeout:10000});
 assert.equal(cli(admin.code,['preview']).status,1);assert.equal(cli(admin.code,['verify',archive]).status,0);assert.equal(cli(studentCode.code,['verify',archive]).status,1);assert.equal(cli(studentCode.code,['delete','0','--confirm-generation','0']).status,1);
 assert.equal((await get('/api/access',student)).status,403);assert.equal((await get('/api/requests/'+receipt)).status,403);assert.equal((await get('/api/requests/'+foreignReceipt,student)).status,404);noInternal(await(await get('/api/requests/'+receipt,student)).json());
 assert.equal((await get('/api/dvr/0?companyId=1&at=10.5',student)).status,403);assert.equal((await get('/api/dvr/0')).status,403);assert.equal((await get('/access.json')).status,404);assert.equal((await get('/game.sqlite')).status,404);
 assert.equal((await send(student,'room.reset',undefined,undefined,randomUUID(),'expected-denial')).ok,false);assert.equal((await send(projector,'room.start',undefined,undefined,randomUUID(),'expected-denial')).ok,false);
 report.security={secondServerDenied:true,liveMaintenanceDenied:true,authorizedIndependentArchiveReadable:true,studentArchiveDenied:true,studentDeletionDenied:true,studentAccessDenied:true,foreignReceiptDenied:true,foreignDvrDenied:true,unauthenticatedDvrDenied:true,localSecretsNotServed:true};
 requireOk(await send(teacher,'room.start'));await until(()=>entries.every(e=>e.latest!.status==='RUNNING'),'all clients started');assert(teacher.latest!.companies.every(c=>c.traffic.totals.generated>0));report.scenarios.A.firstTrafficGenerated=true;
 const activeAt=performance.now();await delay(10000);report.scenarios.oneXWarmup={wallMs:performance.now()-activeAt,simulatedSeconds:teacher.latest!.tick,speed:1};requireOk(await send(teacher,'room.speed',{speed}));
 progress=setInterval(()=>console.log(JSON.stringify({label,phase:'active',tick:teacher.latest?.tick,status:teacher.latest?.status,snapshots,commands:report.commands.length,queries:report.dvr.length,wallSeconds:(performance.now()-activeAt)/1000})),15000);
 // Five concurrent teams use their own credentialed sockets and real pipeline.
 await Promise.all(Array.from({length:5},(_,c)=>pipeline(c,'backend')));
 await Promise.all(Array.from({length:5},(_,c)=>pipeline(c,'security')));
 for(let c=0;c<5;c++){requireOk(await send(member(c,'cto'),'cto.budget',{amount:1000}));for(let i=0;i<3;i++)requireOk(await send(member(c,'devops'),'infra.scale',{delta:1}));requireOk(await send(member(c,'devops'),'infra.balancer',{enabled:true}));}
 // 125 original messages plus 125 identical retries, delivered to all five
 // students in their own company. Repeated full snapshots are not duplicates.
 const chatAt=performance.now();for(let round=0;round<5;round++){
  await Promise.all(entries.filter(e=>e.identity?.companyId!=null).map(async e=>{const id=`classroom-chat-${round}-${e.identity!.id}`,payload={channel:'equipo-interno',text:`Coordinación ${round+1}: ${e.identity!.role}`,refs:[]},cmd:Command={id,type:'chat.send',companyId:e.identity!.companyId!,payload};const key=`${e.identity!.id}:${id}`;sent.set(key,{at:performance.now(),companyId:e.identity!.companyId!,observers:new Set(),command:cmd});const result=requireOk(await send(e,'chat.send',payload,undefined,id));sent.get(key)!.refs=result.refs;assert.deepEqual(await send(e,'chat.send',payload,undefined,id,'retry'),result);}));
 }
 await until(()=>[...sent.values()].every(m=>m.observers.size===5),'every acknowledged message delivered to all authorized students');
 for(let c=0;c<5;c++){const e=member(c,'backend'),res=await get('/api/flowslack?channel=equipo-interno',e),messages=(await res.json()).messages;assert.equal(messages.length,25);assert.equal(new Set(messages.map((m:any)=>m.id)).size,25);assert(messages.every((m:any)=>m.companyId===c));assert(messages.every((m:any,i:number)=>!i||m.sequence>messages[i-1].sequence));assert.equal((await get(`/api/flowslack?companyId=${(c+1)%5}`,e)).status,403);}
 student.socket.disconnect();await connect(student);reconnects++;requireOk(await send(student,'chat.send',sent.values().next().value!.command.payload,undefined,'classroom-chat-0-0-backend','reconnect-retry'));
 report.scenarios.C={messages:125,identicalRetries:125,authorizedRecipientDeliveries:625,wallMs:performance.now()-chatAt,orderVerified:true,zeroDuplicateRows:true,reconnected:true};
 for(let c=0;c<5;c++){const devops=member(c,'devops');requireOk(await send(devops,'infra.maintenance',{mode:'ORDERS_PAUSED'}));requireOk(await send(devops,'infra.maintenance',{mode:'OPERATING'}));requireOk(await send(devops,'infra.stop',{service:'web'}));requireOk(await send(devops,'infra.recover',{service:'web'}));requireOk(await send(devops,'infra.restart',{serverId:1,duration:1}));}
 report.scenarios.B={pipelineCompanies:5,architectureQaAuthorizationDeployment:true,securityPipeline:true,scaling:true,maintenance:true,stopRecoverRestart:true};
 // Confirmed work, an in-flight QA job, active requests, SIGKILL and same-cookie
 // reconnection. The saved state, rather than a stale client frame, is oracle.
 const pending=requireOk(await send(student,'module.create',{name:'Pendiente ante cierre',configuration:{kind:'inventory',minimum:3},dependencies:[]}));
 const current=await(await get('/api/snapshot',student)).json() as Snapshot,newChange=current.changes.find(c=>c.name==='Pendiente ante cierre')!;assert(newChange);requireOk(await send(member(0,'qa'),'qa.run',{suite:'Concurrencia'},newChange.id));
 const committed=JSON.parse((db.prepare('SELECT state FROM game WHERE id=1').get() as {state:string}).state);assert(committed.changes.some((c:any)=>c.id===newChange.id&&c.status==='QA_RUNNING'));
 await flushProbe();for(const e of entries)e.socket.disconnect();await stop('SIGKILL');await launch();
 const recovered=JSON.parse((db.prepare('SELECT state FROM game WHERE id=1').get() as {state:string}).state);assert.equal(recovered.status,'PAUSED');assert.equal(recovered.generation,1);assert.equal(recovered.tick,committed.tick);assert.deepEqual(recovered.market,committed.market);assert.deepEqual(recovered.changes,committed.changes);
 for(const e of entries){await connect(e);reconnects++;}
 const originalChat=sent.get('0-backend:classroom-chat-0-0-backend')!;assert.deepEqual((await send(student,'chat.send',originalChat.command.payload,undefined,originalChat.command.id,'post-crash-retry')).refs,originalChat.refs);
 requireOk(await send(teacher,'room.start'));await until(()=>teacher.latest!.changes.find(c=>c.id===newChange.id)?.status==='QA_PENDING','pending QA survives and resumes',30000);
 report.scenarios.G={signal:'SIGKILL',persistedTick:committed.tick,recoveredPaused:true,marketExact:true,pendingQaPreserved:true,pendingQaResumed:true,sessionReconnects:27,confirmedChatDeduplicated:true,pendingCommandResult:pending.ok};
 const background=(async()=>{let i=0;while(teacher.latest!.status!=='FINISHED'){await delay(2000);if(String(teacher.latest!.status)==='FINISHED')break;const e=member(i++%5,'cto');await send(e,'cto.prioritize',{incident:i%2?'security':'concurrency'},undefined,randomUUID(),'background');}})();
 await waitTick(900);
 await flushProbe(true);
 // A genuine worker termination is armed externally; first pair may return a
 // documented 503, and the next pair must reconstruct exactly in replacement.
 const query=async(e:typeof entries[number],at:number,purpose='exact-frame')=>{const t=performance.now(),res=await get(`/api/dvr/0?companyId=0&at=${at}`,e),body=await res.json();report.dvr.push({identity:e.identity!.id,purpose,at,status:res.status,ms:performance.now()-t});if(res.status===200){assert.deepEqual(body,expected.get(`${e.identity!.id}:${at}`));}else{assert.equal(res.status,503);assert.equal(purpose,'worker-failure');workerFailureObserved=true;}return res.status;};
 await Promise.all([query(teacher,ats[2],'worker-failure'),query(student,ats[2],'worker-failure')]);assert(workerFailureObserved,'injected worker failure must surface honestly');
 for(let round=0;round<12;round++){
  await Promise.all([query(teacher,ats[round%4]),query(student,ats[(round+1)%4])]);
  if(round<11)await waitTick(Math.min(duration-10,900+round*20));
 }
 let aborted=0;for(let i=0;i<8;i++){const controller=new AbortController(),p=fetch(`${base}/api/dvr/0?companyId=0&at=${ats[2]}`,{headers:{Cookie:teacher.cookie},signal:controller.signal}).catch(e=>{assert.equal(e.name,'AbortError');aborted++;});await delay(20);controller.abort();await p;}
 const requests=Array.from({length:3},()=>get(`/api/dvr/0?companyId=0&at=${ats[2]}`,teacher));const saturated=await Promise.all(requests);assert(saturated.some(r=>r.status===429));for(const r of saturated)await r.arrayBuffer();
 for(const endpoint of ['/api/dvr/0/metrics?companyId=0','/api/dvr/0/chat?companyId=0',`/api/dvr/0/requests/${receipt}`]){const t=performance.now(),res=await get(endpoint,student);assert.equal(res.status,200);noInternal(await res.json());report.dvr.push({purpose:'authorized-auxiliary',endpoint: endpoint.includes('/requests/')?'/api/dvr/0/requests/:id':endpoint,status:res.status,ms:performance.now()-t});}
 report.scenarios.E={twoConcurrentLanes:true,exactFrames:report.dvr.filter((q:any)=>q.status===200&&q.purpose==='exact-frame').length,workerFailureObserved,workerRecovery:true,clientAborts:aborted,saturation429:saturated.filter(r=>r.status===429).length};
 await until(()=>teacher.latest!.status==='FINISHED','complete classroom game',(duration-teacher.latest!.tick+10)*1000/speed*3);await background;clearInterval(progress);progress=undefined;
 const final=await(await get('/api/snapshot',teacher)).json() as Snapshot;await until(()=>entries.every(e=>e.latest?.status==='FINISHED'),'final distribution');assert.equal(new Set(entries.map(e=>publicState(e.latest!))).size,1);assert.equal(final.tick,duration);
 const finalState=JSON.parse((db.prepare('SELECT state FROM game WHERE id=1').get() as {state:string}).state);assertMarket(finalState);assert.equal(historyDigest(),savedHistoryDigest);
 const humanRows=db.prepare("SELECT companyId,id,body FROM slack_messages WHERE generation=1 AND json_extract(body,'$.source')='human' ORDER BY id").all();assert.equal(humanRows.length,125);assert.equal(new Set(humanRows.map(r=>r.id)).size,125);
 const crises=db.prepare("SELECT kind,companyId,count(*) AS n FROM history_events WHERE generation=1 AND kind IN ('crisis.entered','crisis.exited','maintenance.changed') GROUP BY kind,companyId ORDER BY kind,companyId").all();assert.equal(new Set(crises.filter(r=>r.kind==='crisis.entered').map(r=>r.companyId)).size,5);assert(crises.some(r=>r.kind==='crisis.exited'));
 report.scenarios.D={crisisCompanies:5,crisisAndRecoveryFacts:crises,visualEconomyUnchanged:report.visual.economyUnchanged,liveMutations:0};
 report.scenarios.F={simulatedSeconds:final.tick,realActiveWallSeconds:(performance.now()-activeAt)/1000,mainSpeed:speed,initialOneXSeconds:report.scenarios.oneXWarmup.simulatedSeconds,finalStatus:final.status,initialPopulation:5000,finalPopulation:final.companies.reduce((s,c)=>s+c.customers,0)+final.unserved,historyUnchanged:true,terminalRequestsSettled:finalState.companies.every((c:any)=>!Object.values(c.traffic.requests).some((r:any)=>!r.result))};assert(report.scenarios.F.terminalRequestsSettled);
 report.storage={beforeShutdown:storageUsage(db,path),walAutocheckpointPages:db.prepare('PRAGMA wal_autocheckpoint').get(),perGenerationLogicalBytes:db.prepare('SELECT generation,count(*) AS receipts,coalesce(sum(length(CAST(receipt AS BLOB))+coalesce(length(details),0)),0) AS receiptLogicalBytes FROM request_receipts GROUP BY generation').all(),integrity:db.prepare('PRAGMA integrity_check').get(),automaticCheckpointCount:'not instrumented; SQLite default threshold reported'};
 for(const e of entries)e.socket.disconnect();await stop('SIGTERM');
 const releaseStorage=acquireStorageLease(db);try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');checkpointCount++;report.storage.afterCheckpoint=storageUsage(db,path);assert.equal(db.prepare('SELECT count(*) AS n FROM storage_lease').get()!.n,1);}finally{releaseStorage();}assert.equal(db.prepare('SELECT count(*) AS n FROM storage_lease').get()!.n,0);db.close();
 assert.equal(sourceHash(),initialHash,'source changed while measuring');assert.equal(leaks,0);assert.equal(timeouts,0);assert.equal(report.errors.length,0,JSON.stringify(report.errors));assert(report.segments.every((s:any)=>s.hookedStep&&s.hookedQueue));
 report.result='passed';report.exitCode=0;finished=true;
}catch(error){report.result='failed';report.exitCode=1;report.errors.push((error as Error).stack);process.exitCode=1;}
finally{
 if(progress)clearInterval(progress);for(const e of entries)e.socket.disconnect();if(child?.exitCode===null&&child.signalCode===null)await stop('SIGTERM');
 report.wallMs=performance.now()-started;report.socket={snapshots,sizeBytes:pct(snapshotSizes),deliveryMs:pct(snapshotLatency),cadenceMs:pct(snapshotCadence),maximumConnections:Math.max(0,...report.segments.map((s:any)=>s.maxConnections??0)),disconnects,reconnects,timeouts,commandAckMs:pct(ack)};
 report.flowSlack={sent:sent.size,authorizedDeliveries:chatDelivery.length,ackMs:pct(chatAck),deliveryMs:pct(chatDelivery),crossCompanyDeliveries:leaks,confirmedMessageLoss:finished?0:null,duplicateApplications:finished?0:null};report.explicitCheckpoints=checkpointCount;
 report.budgets={eventLoopP99Below150:report.segments.every((s:any)=>s.eventLoop?.p99<150),engineIntervalP95Below200:report.segments.every((s:any)=>s.engineIntervalMs?.p95<200),commandAckP95Below150:(pct(ack).p95??Infinity)<150,scope:'Investigative budgets on local loopback; crossing one is reported, never hidden or relaxed.'};
 // No access.json, cookies, live SQLite or stdout containing credentials is saved.
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');if(stderr)writeFileSync(`${root}/classroom-${label}-stderr.txt`,stderr.replaceAll(dir,'<temporary-data-dir>'));
 console.log(JSON.stringify({output,result:report.result,exitCode:report.exitCode,wallSeconds:report.wallMs/1000,commandAck:report.socket.commandAckMs,budgets:report.budgets,errors:report.errors}));rmSync(dir,{recursive:true,force:true});
}
