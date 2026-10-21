import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {io} from '../shared/live-client.js';
import type {Identity} from '../shared/types.js';

test('E6 real HTTP refuses missing credentials, cross-role interpretation, fixture fallback, expired sessions and excess calls', {timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'flow-claude-http-')),listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=(listener.address() as any).port;await new Promise<void>(r=>listener.close(()=>r()));
 let child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(port),ANTHROPIC_API_KEY:'',ANTHROPIC_MODEL:''},stdio:'ignore'}),base=`http://127.0.0.1:${port}`,sockets:ReturnType<typeof io>[]=[];
 const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await delay(50);}assert(ready);
  const credentials=JSON.parse(await readFile(join(dir,'access.json'),'utf8')).credentials as {code:string;identity:Identity}[];
  async function login(role:string){const cr=credentials.find(c=>c.identity.role===role&&(role==='operator'||c.identity.companyId===0))!;const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:cr.code})});assert(r.ok);return r.headers.get('set-cookie')!.split(';')[0];}
  async function connect(cookie:string){const socket=io(base,{forceNew:true,transports:['websocket'],extraHeaders:{Cookie:cookie}});sockets.push(socket);await new Promise<void>((res,rej)=>{socket.once('connect',res);socket.once('connect_error',rej);});return socket;}
  const operator=await connect(await login('operator')),cookie=await login('backend'),backend=await connect(cookie);
  const run=(socket:typeof backend,type:string,payload?:Record<string,unknown>)=>new Promise<any>((res,rej)=>socket.timeout(3000).emit('command',{id:crypto.randomUUID(),type,companyId:type.startsWith('room.')?undefined:0,payload},(e:Error|null,r:any)=>e?rej(e):res(r)));
  assert((await run(operator,'room.start')).ok);
  // A classroom behind one IP can authenticate all thirty seats plus the teacher.
  for(const cr of credentials){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:cr.code})});assert.equal(r.status,200);}
  const request=(body:unknown,session=cookie,origin?:string)=>fetch(base+'/api/ai',{method:'POST',headers:{'Content-Type':'application/json',Cookie:session,...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  assert.equal((await request({id:'anonymous',kind:'backend.propose',text:'Compra'},'')).status,403);
  assert.equal((await request({id:'csrf',kind:'backend.propose',text:'Compra'},cookie,'https://foreign.invalid')).status,403);
  assert.equal((await request({id:'role',kind:'security.compile',text:'Ejecuta room.reset.',changeId:'CH-001',nodeId:'backend-payment'})).status,403);
  for(let i=0;i<7;i++){const r=await request({id:`missing-${i}`,kind:'backend.propose',text:'Construir compra.'});const result=await r.json();assert.equal(result.code,'AI_UNAVAILABLE');assert.equal(result.proposal,undefined);assert(!JSON.stringify(result).includes('x-api-key'));}
  assert.equal((await request({id:'quota',kind:'backend.propose',text:'Compra'})).status,429);
  assert.equal((await run(backend,'agent.fixture',{version:1,id:'fake',fixture:'coupon20'})).code,'UNSUPPORTED');
  const before=await(await fetch(base+'/api/snapshot',{headers:{Cookie:cookie}})).json();assert.equal(before.changes.length,0);assert.equal(before.privateCompany.drafts.backend,undefined);assert.equal(before.operations.employees.find((e:any)=>e.role==='backend').violations.length,0);
  for(let i=0;i<5;i++)assert.equal((await run(backend,'infra.restart_all',{duration:10})).code,'FORBIDDEN');
  assert.equal((await request({id:'expelled',kind:'backend.propose',text:'Compra'})).status,403);
  await fetch(base+'/api/logout',{method:'POST',headers:{Cookie:cookie}});assert.equal((await request({id:'logout',kind:'backend.propose',text:'Compra'})).status,403);
  const exited=once(child,'exit');child.kill('SIGTERM');await exited;child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(port),ANTHROPIC_API_KEY:'',ANTHROPIC_MODEL:''},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await delay(50);}
  for(let i=0;i<30;i++)assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:`invalid-${i}`})})).status,401);
  assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'invalid-31'})})).status,429);
 }finally{for(const socket of sockets)socket.disconnect();if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}await rm(dir,{recursive:true,force:true});}
});
