import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {io,type Socket} from 'socket.io-client';import type {Command,Result,Snapshot} from '../shared/types.js';
test('authenticated FlowSlack delivers to teammates, denies cross-company queries, and survives restart',{timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'flow5-server-')),port=22000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`,sockets:Socket[]=[];
 const start=()=>spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(port)},stdio:'ignore'});let child=start();
 const ready=async()=>{for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error('server unavailable');};
 try{await ready();const {credentials}=JSON.parse(await readFile(join(dir,'access.json'),'utf8'));
 const login=async(companyId:number,role:string)=>{const c=credentials.find((c:any)=>c.identity.companyId===companyId&&c.identity.role===role);const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:c.code})});assert(r.ok);const cookie=r.headers.get('set-cookie')!.split(';')[0],socket=io(base,{forceNew:true,transports:['websocket'],extraHeaders:{Cookie:cookie}});sockets.push(socket);await once(socket,'connect');return{cookie,socket};};
 const sender=await login(0,'security'),receiver=await login(0,'backend'),other=await login(1,'backend');
 const delivered=new Promise<Snapshot>(resolve=>receiver.socket.on('snapshot',(s:Snapshot)=>{if(s.slack?.some(m=>m.text==='@Backend mensaje persistente'))resolve(s);}));
 const command:Command={id:'human-stable',type:'chat.send',companyId:0,payload:{channel:'equipo-interno',text:'@Backend mensaje persistente',refs:[]}};
 const send=(c:Command)=>new Promise<Result>(resolve=>sender.socket.emit('command',c,resolve));assert((await send(command)).ok);assert((await send(command)).ok);await delivered;
 assert.equal((await fetch(base+'/api/flowslack?companyId=0&channel=equipo-interno',{headers:{Cookie:other.cookie}})).status,403);
 assert.equal((await fetch(base+'/api/flowslack')).status,403);
 const own=await(await fetch(base+'/api/flowslack?channel=equipo-interno',{headers:{Cookie:receiver.cookie}})).json();assert.equal(own.messages.length,1);
 const foreign=await(await fetch(base+'/api/flowslack?channel=equipo-interno',{headers:{Cookie:other.cookie}})).json();assert.equal(foreign.messages.length,0);
 for(const socket of sockets)socket.disconnect();const exited=once(child,'exit');child.kill('SIGTERM');await exited;child=start();await ready();const retained=await(await fetch(base+'/api/flowslack?channel=equipo-interno',{headers:{Cookie:receiver.cookie}})).json();assert.equal(retained.messages.length,1);assert.equal(retained.messages[0].id,own.messages[0].id);
 }finally{for(const socket of sockets)socket.disconnect();if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}await rm(dir,{recursive:true,force:true});}
});
