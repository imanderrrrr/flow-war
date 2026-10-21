import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {createGame} from '../server/engine.js';
import {serializeGame} from '../server/persistence.js';
import {io} from '../shared/live-client.js';
import {DEFAULT_TEST} from '../shared/actions.js';
import {command,advanceGame,reviewForQa} from './helpers.js';

test('E7 authenticated HTTP evidence, private history, diagnostics and failed-request recovery enforce company, role and generation', {timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'flow-team-http-')),listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=(listener.address() as any).port;await new Promise<void>(r=>listener.close(()=>r()));const base=`http://127.0.0.1:${port}`;
 const g=createGame(1500,7357,0,false);g.status='RUNNING';command(g,'backend','change.submit',{graph:g.companies[0].backend,revision:0});reviewForQa(g);command(g,'qa','qa.execute',{changeId:g.changes[0].id,scenario:{...DEFAULT_TEST,requests:2,concurrency:2,stock:1}});advanceGame(g,2);const run=g.companies[0].runtime.workflow!.runs[0];
 g.companies[0].runtime.conversations=[{id:'private',actor:'0-qa',role:'qa',generation:0,companyId:0,messages:[{id:'1',requestId:'1',role:'user',text:'QA private original',at:0,refs:[]}]}];
 const db=new DatabaseSync(join(dir,'game.sqlite'));db.exec('CREATE TABLE game(id INTEGER PRIMARY KEY,state TEXT NOT NULL)');db.prepare('INSERT INTO game VALUES(1,?)').run(serializeGame(g));db.close();
 const credentials=[{code:'operator-test',identity:{id:'operator',role:'operator',companyId:null}},...Array.from({length:2},(_,companyId)=>['qa','cto'].map(role=>({code:`${companyId}-${role}-test`,identity:{id:`${companyId}-${role}`,role,companyId}}))).flat()];await writeFile(join(dir,'access.json'),JSON.stringify({credentials}));
 let child:ReturnType<typeof spawn>,sockets:ReturnType<typeof io>[]=[];
 const launch=async()=>{child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(port),ANTHROPIC_API_KEY:'',ANTHROPIC_MODEL:''},stdio:'ignore'});for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error('server not ready');};
 const stop=async()=>{for(const s of sockets)s.disconnect();sockets=[];if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}};
 const login=async(code:string)=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});assert(r.ok);return r.headers.get('set-cookie')!.split(';')[0];};
 const get=(path:string,cookie='')=>fetch(base+path,{headers:{Cookie:cookie}});
 try{await launch();const qa=await login('0-qa-test'),rival=await login('1-qa-test'),cto=await login('0-cto-test'),operator=await login('operator-test');
 const op=io(base,{forceNew:true,transports:['websocket'],extraHeaders:{Cookie:operator}});sockets.push(op);await new Promise<void>((res,rej)=>{op.once('connect',res);op.once('connect_error',rej);});await new Promise<void>((res,rej)=>op.timeout(3000).emit('command',{id:'start',type:'room.start'},(e:Error|null,r:any)=>e?rej(e):r.ok?res():rej(new Error(r.error))));
 const detail=await get(`/api/qa/runs/${run.id}`,qa);assert(detail.ok);assert.equal((await detail.json()).report.testEvidence.outcomes.length,2);assert.equal((await get(`/api/qa/runs/${run.id}`,rival)).status,404);assert.equal((await get(`/api/qa/runs/${run.id}`)).status,403);
 const snapshot=await(await get('/api/snapshot',qa)).json();assert.equal(snapshot.changes[0].reports[0].testEvidence.events.length,0);assert.equal(snapshot.changes[0].reports[0].testEvidence.outcomeCount,2);
 assert.equal((await get('/api/ai/conversation/private',qa)).status,200);assert.equal((await get('/api/ai/conversation/private',cto)).status,404);assert.equal((await get('/api/ai/conversation/private',rival)).status,404);
 assert.equal((await get('/api/ai/status')).status,403);assert.equal((await(await get('/api/ai/status',operator)).json()).provider.state,'MISSING_CREDENTIALS');
 assert.equal((await fetch(base+'/api/ai/diagnose',{method:'POST',headers:{Cookie:qa,'Content-Type':'application/json'},body:'{}'})).status,403);assert.equal((await fetch(base+'/api/ai/diagnose',{method:'POST',headers:{Cookie:operator,'Content-Type':'application/json'},body:'{}'})).status,503);
 const attempt=await fetch(base+'/api/ai',{method:'POST',headers:{Cookie:qa,'Content-Type':'application/json'},body:JSON.stringify({id:'failed-intent',kind:'qa.interpret',text:'Dos compradores, una unidad.',changeId:g.changes[0].id,threadId:'private'})});assert.equal((await attempt.json()).code,'AI_UNAVAILABLE');
 assert((await(await get('/api/ai/conversation/private',qa)).json()).messages.some((m:any)=>m.text==='Dos compradores, una unidad.'));
 await stop();await launch();const status=await(await get('/api/ai/status',qa)).json();assert.equal(status.requests.find((r:any)=>r.id==='failed-intent').state,'FAILED');const recovered=await(await get('/api/snapshot',qa)).json();assert.equal(recovered.changes[0].reports.length,1);assert.equal(recovered.privateCompany.reserved,0);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
