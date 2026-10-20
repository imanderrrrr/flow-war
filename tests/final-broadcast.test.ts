import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {io,type Socket} from '../shared/live-client.js';
import type {Snapshot,Result} from '../shared/types.js';

test('final broadcast: bursts preserve every durable command and the latest private snapshot',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-final-broadcast-')),probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
 const base=`http://127.0.0.1:${port}`,child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(port)},stdio:'ignore'}),sockets:Socket[]=[],latest=new Map<Socket,Snapshot>();
 const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 try{
  for(let i=0;;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}assert(i<100);await delay(50);}
  const credentials=JSON.parse(readFileSync(join(dir,'access.json'),'utf8')).credentials;
  const chosen=[credentials.find((c:any)=>c.identity.role==='operator'),...Array.from({length:5},(_,companyId)=>credentials.find((c:any)=>c.identity.role==='backend'&&c.identity.companyId===companyId)),undefined];
  for(const credential of chosen){let cookie='';if(credential){const res=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:credential.code})});assert(res.ok);cookie=res.headers.get('set-cookie')!.split(';')[0];}
   const socket=io(base,{forceNew:true,autoConnect:false,transports:['websocket'],extraHeaders:{Cookie:cookie}});sockets.push(socket);socket.on('snapshot',s=>latest.set(socket,s));const connected=new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});socket.connect();await connected;
  }
  const send=(socket:Socket,type:string,payload?:Record<string,unknown>,companyId?:number,id=crypto.randomUUID())=>new Promise<Result>((res,rej)=>socket.timeout(5000).emit('command',{id,type,payload,companyId},(error:Error|null,result:Result)=>error?rej(error):res(result)));
  assert((await send(sockets[0],'room.dvr',{enabled:true})).ok);
  assert((await send(sockets[0],'room.start')).ok);
  const messages=Array.from({length:25},(_,i)=>({socket:sockets[i%5+1],companyId:i%5,id:crypto.randomUUID(),payload:{channel:'equipo-interno',text:`burst ${i}`,refs:[]}}));
  const results=await Promise.all(messages.map(m=>send(m.socket,'chat.send',m.payload,m.companyId,m.id)));assert(results.every(r=>r.ok));
  assert((await send(sockets[0],'room.pause')).ok);
  for(let i=0;;i++){if(sockets.every(s=>latest.get(s)?.status==='PAUSED'))break;assert(i<100);await delay(20);}
  for(let c=0;c<5;c++){const snapshot=latest.get(sockets[c+1])!;assert.equal(snapshot.privateCompany?.id,c);const human=snapshot.slack!.filter(m=>m.source==='human');assert.equal(human.length,5);assert(human.every(m=>m.companyId===c));}
  assert.equal(latest.get(sockets[6])!.slack,undefined);
  const db=new DatabaseSync(join(dir,'game.sqlite'),{readOnly:true});try{assert.equal(db.prepare("SELECT count(*) AS n FROM slack_messages WHERE json_extract(body,'$.source')='human'").get()!.n,25);assert.equal(db.prepare("SELECT count(*) AS n FROM history_events WHERE kind='communication.accepted'").get()!.n,25);for(const m of messages)assert(db.prepare('SELECT 1 FROM commands WHERE id=?').get(m.id));}finally{db.close();}
 }finally{for(const s of sockets)s.disconnect();if(child.exitCode===null&&child.signalCode===null){const end=once(child,'exit');child.kill('SIGTERM');await end;}rmSync(dir,{recursive:true,force:true});}
});
