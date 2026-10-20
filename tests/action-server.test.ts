import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { io, type Socket } from '../shared/live-client.js';
import type { Command, Identity, Result, Snapshot } from '../shared/types.js';
import { DEFAULT_TEST } from '../shared/actions.js';

test('4A real authenticated server executes structured artifacts and recovers expulsion, pending restart and deduplication', {timeout:30000}, async()=>{
  const directory=await mkdtemp(join(tmpdir(),'flow-war-actions-server-')),listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
  const base=`http://127.0.0.1:${port}`,sockets:Socket[]=[];let child:ChildProcess|undefined;
  const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
  async function boot(){child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_PORT:String(port),FLOW_DATA_DIR:directory},stdio:'ignore'});for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/health`)).ok)return;}catch{}await delay(50);}throw new Error('Server not ready');}
  async function socket(cookie:string){const s=io(base,{forceNew:true,transports:['websocket'],extraHeaders:{Cookie:cookie}});sockets.push(s);await new Promise<void>((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
  const run=(s:Socket,c:Omit<Command,'id'> & {id?:string})=>new Promise<Result>((resolve,reject)=>s.timeout(3000).emit('command',{...c,id:c.id??crypto.randomUUID()},(err:Error|null,r:Result)=>err?reject(err):resolve(r)));
  const snapshot=async(cookie:string)=>await(await fetch(`${base}/api/snapshot`,{headers:{Cookie:cookie}})).json() as Snapshot;
  async function wait(cookie:string,predicate:(s:Snapshot)=>boolean){for(let i=0;i<160;i++){const s=await snapshot(cookie);if(predicate(s))return s;await delay(40);}throw new Error('Snapshot condition not reached');}
  try {
    await boot();const credentials=JSON.parse(await readFile(join(directory,'access.json'),'utf8')).credentials as {code:string;identity:Identity}[];
    async function login(role:Identity['role']){const code=credentials.find(c=>c.identity.role===role&&(role==='operator'||c.identity.companyId===0))!.code;const response=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie')!.split(';')[0];return {socket:await socket(cookie),cookie};}
    const op=await login('operator'),backend=await login('backend'),qa=await login('qa'),cto=await login('cto'),devops=await login('devops');
    await run(op.socket,{type:'room.start'});await run(op.socket,{type:'room.speed',payload:{speed:20}});
    const action={version:1,id:'artifact-once',companyId:0,source:'agent',type:'module.create',parameters:{name:'Descuento',configuration:{kind:'discount',percent:20,audience:'new',stackable:false},dependencies:[]}};
    assert.equal((await run(backend.socket,{type:'action.execute',payload:{action}})).ok,true);assert.equal((await run(backend.socket,{type:'action.execute',payload:{action}})).ok,true);
    const prepared=await snapshot(backend.cookie),ch=prepared.changes[0];assert.equal(prepared.operations?.modules.length,1);assert.equal(prepared.companies[0].version,1);assert.ok(!JSON.stringify(prepared).includes('defects'));
    assert.equal((await run(qa.socket,{type:'qa.execute',companyId:0,payload:{changeId:ch.id,scenario:DEFAULT_TEST}})).ok,true);await wait(qa.cookie,s=>s.changes[0].reports.length===1);
    assert.equal((await snapshot(qa.cookie)).changes[0].status,'QA_PENDING');await run(qa.socket,{type:'qa.approve',companyId:0,changeId:ch.id});await run(cto.socket,{type:'cto.authorize',companyId:0,changeId:ch.id});await run(devops.socket,{type:'deploy.start',companyId:0,changeId:ch.id,payload:{strategy:'rolling'}});await wait(devops.cookie,s=>s.changes[0].status==='DEPLOYED');
    await run(op.socket,{type:'room.speed',payload:{speed:1}});await run(devops.socket,{id:'pending-restart',type:'infra.restart_all',companyId:0,payload:{duration:20}});
    for(let i=0;i<5;i++){const cmd={id:`violation-${i}`,type:'infra.restart_all',companyId:0,payload:{duration:10}};assert.equal((await run(backend.socket,cmd)).code,'FORBIDDEN');assert.equal((await run(backend.socket,cmd)).code,'FORBIDDEN');}
    assert.equal((await snapshot(backend.cookie)).privateCompany,undefined);assert.equal((await snapshot(op.cookie)).operations!.employees.find(e=>e.id==='0-backend')!.status,'EXPELLED');await run(op.socket,{type:'room.pause'});
    sockets.forEach(s=>s.disconnect());await stop();await boot();
    const restored=await snapshot(devops.cookie);assert.equal(restored.status,'PAUSED');assert.equal(restored.operations!.modules.length,1);assert.equal(restored.operations!.employees.find(e=>e.role==='backend')!.violations.length,5);assert.equal(restored.companies[0].infrastructure.instances[0].status,'RESTARTING');
    const be=await socket(backend.cookie),ops=await socket(op.cookie),de=await socket(devops.cookie);
    assert.equal((await run(be,{type:'module.create',companyId:0,payload:action.parameters})).code,'EXPELLED');
    assert.equal((await run(de,{id:'pending-restart',type:'infra.restart_all',companyId:0,payload:{duration:20}})).ok,true);
    const deniedLogin=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:credentials.find(c=>c.identity.id==='0-backend')!.code})});assert.equal(deniedLogin.status,403);
    assert.equal((await run(ops,{type:'employee.correct',payload:{employeeId:'0-backend',justification:'Corrección administrativa comprobada en la prueba de integración.'}})).ok,true);
    assert.equal((await snapshot(backend.cookie)).operations!.employees.find(e=>e.role==='backend')!.status,'ACTIVE');
  } finally {sockets.forEach(s=>s.disconnect());await stop();await rm(directory,{recursive:true,force:true});}
});
