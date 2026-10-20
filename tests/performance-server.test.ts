import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {io,type Socket} from 'socket.io-client';
import {attachState} from '../shared/live-client.js';
import {receiveState,type ClientState,type StatePacket} from '../shared/sync.js';
import type {Snapshot,Result} from '../shared/types.js';
for(const enabled of [false,true])test(`real server DVR ${enabled?'ON':'OFF'}: crash recovery, sequence loss, resync authorization and logout`,{timeout:25000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-modes-test-')),probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));const base=`http://127.0.0.1:${port}`;
 const launch=()=>spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(port)},stdio:'ignore'});let child=launch();const sockets:Socket[]=[];
 const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms)),until=async(fn:()=>boolean)=>{for(let i=0;!fn();i++){assert(i<300,'condition timeout');await delay(20);}};
 const ready=async()=>{for(let i=0;;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}assert(i<150);await delay(30);}};
 const send=(socket:Socket,type:string,payload?:Record<string,unknown>,id:string=crypto.randomUUID())=>new Promise<Result>((res,rej)=>socket.timeout(5000).emit('command',{id,type,payload,companyId:(socket as any).dataCompany},(err:Error|null,r:Result)=>err?rej(err):res(r)));
 try{await ready();const creds=JSON.parse(readFileSync(join(dir,'access.json'),'utf8')).credentials;
 const login=async(role:string,companyId:number|null)=>{const cr=creds.find((c:any)=>c.identity.role===role&&c.identity.companyId===companyId),r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:cr.code})});assert(r.ok);const cookie=r.headers.get('set-cookie')!.split(';')[0];const socket=io(base,{autoConnect:false,forceNew:true,reconnection:false,transports:['websocket'],extraHeaders:{Cookie:cookie}});(socket as any).dataCompany=companyId??undefined;sockets.push(socket);return{socket,cookie};};
 const teacher=await login('operator',null),student=await login('backend',0),foreign=await login('qa',1);let latest:Snapshot|undefined,clears=0;
 for(const e of [teacher,foreign]){attachState(e.socket);const connected=new Promise<void>(r=>e.socket.once('connect',r));e.socket.connect();await connected;}
 let state:ClientState|undefined,drop=true,gap=false,fulls=0;
 student.socket.on('disconnect',()=>{latest=undefined;state=undefined;clears++;});
 student.socket.on('state:clear',()=>{latest=undefined;state=undefined;clears++;});
 student.socket.on('state:update',(packet:StatePacket,ack:Function)=>{if(packet.kind==='delta'&&drop){drop=false;ack({stream:packet.stream,seq:packet.seq});return;}const result=receiveState(state,packet);state=result.state;if(result.resync){latest=undefined;gap=true;student.socket.emit('state:resync');return;}if(result.applied){latest=state!.snapshot;if(packet.kind==='full')fulls++;}ack({stream:packet.stream,seq:packet.seq});});
 let connected=new Promise<void>(r=>student.socket.once('connect',r));student.socket.connect();await connected;await until(()=>!!latest);assert.equal(latest!.dvrEnabled,false,'new server defaults to light mode');assert((await send(teacher.socket,'room.dvr',{enabled})).ok);assert.equal((await send(foreign.socket,'room.dvr',{enabled:!enabled})).ok,false);
 assert((await send(teacher.socket,'room.start')).ok);assert((await send(teacher.socket,'room.speed',{speed:20})).ok);await until(()=>gap&&fulls>=2&&!!latest&&latest.tick>=2);assert.equal(latest!.privateCompany!.id,0);assert(latest!.changes.every(c=>c.companyId===0));
 const message={channel:'equipo-interno',text:'mensaje durable sintético',refs:[]};assert((await send(student.socket,'chat.send',message,'survives-crash')).ok);assert((await send(teacher.socket,'room.pause')).ok);for(const e of [teacher,student,foreign])e.socket.disconnect();let ended=once(child,'exit');child.kill('SIGKILL');await ended;
 let db=new DatabaseSync(join(dir,'game.sqlite'),{readOnly:true});const committed=JSON.parse((db.prepare('SELECT state FROM game').get() as any).state);db.close();child=launch();await ready();db=new DatabaseSync(join(dir,'game.sqlite'),{readOnly:true});const restored=JSON.parse((db.prepare('SELECT state FROM game').get() as any).state);db.close();for(const key of ['companies','market','changes','actions','slack','generation','tick','dvrEnabled'])assert.deepEqual(restored[key],committed[key],key);assert.equal(restored.dvrEnabled,enabled);
 for(const e of [teacher,student,foreign]){connected=new Promise<void>(r=>e.socket.once('connect',r));e.socket.connect();await connected;}await until(()=>!!latest);assert((await send(student.socket,'chat.send',message,'survives-crash')).ok);assert((await send(teacher.socket,'room.finish')).ok);
 const headers={Cookie:teacher.cookie},reply=await fetch(base+'/api/dvr/0?at=0',{headers});assert.equal(reply.status,enabled?200:409);if(!enabled)assert.equal((await reply.json()).code,'DVR_NOT_RECORDED');assert.equal((await fetch(base+'/api/dvr/0?companyId=0',{headers:{Cookie:foreign.cookie}})).status,403);
 for(let i=0;i<5;i++)assert.equal((await send(student.socket,'infra.scale',{delta:1})).code,'FORBIDDEN');await until(()=>latest?.identity===null);assert.equal(latest!.privateCompany,undefined);assert((await send(teacher.socket,'employee.correct',{employeeId:'0-backend',justification:'Corrección sintética para comprobar revocaciones sucesivas.'})).ok);await until(()=>latest?.privateCompany?.id===0);assert.equal((await send(student.socket,'infra.scale',{delta:1})).code,'FORBIDDEN');await until(()=>latest?.identity===null);assert.equal(latest!.privateCompany,undefined);assert((await send(teacher.socket,'employee.correct',{employeeId:'0-backend',justification:'Segunda corrección sintética para completar la prueba.'})).ok);await until(()=>latest?.privateCompany?.id===0);
 const old=latest;const logout=await fetch(base+'/api/logout',{method:'POST',headers:{Cookie:student.cookie}});assert(logout.ok);await until(()=>!student.socket.connected&&latest===undefined);assert(clears>=2);assert(old?.privateCompany);student.socket.connect();await until(()=>!!latest);assert.equal(latest!.identity,null);assert.equal(latest!.privateCompany,undefined);student.socket.emit('state:resync');await delay(300);assert.equal(latest!.slack,undefined);assert.equal((await send(student.socket,'room.dvr',{enabled:true})).code,'FORBIDDEN');
 }finally{for(const socket of sockets)socket.disconnect();if(child.exitCode===null&&child.signalCode===null){const end=once(child,'exit');child.kill('SIGTERM');await end;}rmSync(dir,{recursive:true,force:true});}
});
