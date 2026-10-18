import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { io,type Socket } from 'socket.io-client';
import { initialGraph } from '../server/engine.js';
import type { Command,Result,Snapshot } from '../shared/types.js';

test('real server validates roles, confirms a complete pipeline and deduplicates commands',{timeout:25000},async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'flow-war-test-'));
  const port=19000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_PORT:String(port),FLOW_DATA_DIR:dataDir},stdio:'ignore'});
  const sockets:Socket[]=[];
  try{
    let ready=false;for(let i=0;i<80;i++){try{ready=(await fetch(`${base}/api/health`)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}assert.equal(ready,true);
    const {credentials}=JSON.parse(await readFile(join(dataDir,'access.json'),'utf8'));
    async function connect(role:string,companyId:number|null){
      const cr=credentials.find((c:any)=>c.identity.role===role&&c.identity.companyId===companyId);
      const response=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:cr.code})});assert.equal(response.status,200);
      const cookie=response.headers.get('set-cookie')!.split(';')[0];
      const socket=io(base,{forceNew:true,transports:['websocket'],extraHeaders:{Cookie:cookie}});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',()=>resolve());socket.once('connect_error',reject);});return socket;
    }
    const op=await connect('operator',null),backend=await connect('backend',0),qa=await connect('qa',0),cto=await connect('cto',0),devops=await connect('devops',0),other=await connect('qa',1);
    const run=(socket:Socket,command:Omit<Command,'id'> & {id?:string})=>new Promise<Result>((resolve,reject)=>socket.timeout(3000).emit('command',{...command,id:command.id??crypto.randomUUID()},(err:Error|null,r:Result)=>err?reject(err):resolve(r)));
    const waitState=(socket:Socket,predicate:(s:Snapshot)=>boolean)=>new Promise<Snapshot>((resolve,reject)=>{const timer=setTimeout(()=>{socket.off('snapshot',listener);reject(new Error('Timed out waiting for snapshot'));},6000);const listener=(s:Snapshot)=>{if(predicate(s)){clearTimeout(timer);socket.off('snapshot',listener);resolve(s);}};socket.on('snapshot',listener);});
    assert.equal((await run(op,{type:'room.start'})).ok,true);assert.equal((await run(op,{type:'room.speed',payload:{speed:20}})).ok,true);
    assert.equal((await run(backend,{type:'deploy.start',companyId:0})).code,'FORBIDDEN');
    assert.equal((await run(other,{type:'qa.run',companyId:0})).code,'FORBIDDEN');
    const submit={id:'submit-exactly-once',type:'change.submit',companyId:0,payload:{graph:initialGraph('backend'),revision:0}};
    assert.equal((await run(backend,submit)).ok,true);assert.equal((await run(backend,submit)).ok,true);
    const submitted=await waitState(qa,s=>s.changes.length===1);const id=submitted.changes[0].id;
    assert.equal((await run(qa,{type:'qa.run',companyId:0,changeId:id,payload:{suite:'Concurrencia'}})).ok,true);
    await waitState(qa,s=>s.changes[0]?.reports.length===1);
    assert.equal((await run(qa,{type:'qa.approve',companyId:0,changeId:id})).ok,true);
    assert.equal((await run(cto,{type:'cto.authorize',companyId:0,changeId:id})).ok,true);
    assert.equal((await run(devops,{type:'deploy.start',companyId:0,changeId:id,payload:{strategy:'rolling'}})).ok,true);
    const deployed=await waitState(devops,s=>s.changes[0]?.status==='DEPLOYED');assert.equal(deployed.companies[0].version,2);assert.equal(deployed.companies[0].deployments,1);
    const publicSnapshot=await(await fetch(`${base}/api/snapshot`)).json();assert.equal(publicSnapshot.changes.length,0);assert.equal('drafts' in publicSnapshot.companies[0],false);
    const denied=await fetch(`${base}/api/access`);assert.equal(denied.status,403);
    assert.equal((await fetch(`${base}/.local/access.json`)).status,404);
  }finally{for(const socket of sockets)socket.disconnect();child.kill('SIGTERM');await once(child,'exit').catch(()=>{});await rm(dataDir,{recursive:true,force:true});}
});
