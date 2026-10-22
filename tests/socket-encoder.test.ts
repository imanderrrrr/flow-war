import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Server,type Socket as ServerSocket} from 'socket.io';
import {io as connect,type Socket} from 'socket.io-client';
import {StateUpdateEncoder,stateUpdateParser,standardEncoder,socketIoParser} from '../server/socket-encoder.js';
import {SnapshotSync} from '../server/snapshot-sync.js';
import {applyCommand,createGame,project,step} from '../server/engine.js';
import {compactCompanies} from '../shared/snapshot-codec.js';
import {receiveState,type ClientState,type StatePacket} from '../shared/sync.js';
import type {Identity,Snapshot} from '../shared/types.js';

const operator:Identity={id:'operator',role:'operator',companyId:null};

test('socket encoder uses the CommonJS socket.io-parser instance that socket.io itself loads',()=>{
 const stock=new Server() as unknown as {encoder:object};
 assert(stock.encoder instanceof socketIoParser.Encoder,'same Encoder class as the socket.io default');assert(!(stock.encoder instanceof StateUpdateEncoder));
 assert.equal(stateUpdateParser.Decoder,socketIoParser.Decoder);
});

test('state:update encoder emits the same bytes as the stock Encoder for real SnapshotSync packets, ACKs and binary events',{timeout:30000},async()=>{
 const g=createGame(1200,8);applyCommand(g,operator,{id:'go',type:'room.start'});
 const http=createServer(),io=new Server(http,{parser:stateUpdateParser}),encoder=io.encoder as unknown as {encode(packet:any):unknown[]};assert(encoder instanceof StateUpdateEncoder);
 const counts={full:0,delta:0,ack:0,binary:0,other:0};
 // Every packet the server writes is also encoded by a stock Encoder; outputs must match part by part.
 const encode=encoder.encode.bind(encoder);
 encoder.encode=(packet:any)=>{
  const expected=standardEncoder().encode(packet),actual=encode(packet);assert.deepEqual(actual,expected,`packet ${packet.data?.[0]}`);
  if(packet.data?.[0]==='state:update')counts[packet.data[1].kind as 'full'|'delta']++;else if(packet.type===socketIoParser.PacketType.ACK)counts.ack++;else if(actual.length>1)counts.binary++;else counts.other++;
  return actual;
 };
 const identities=[operator,{id:'0-backend',role:'backend',companyId:0},{id:'1-qa',role:'qa',companyId:1},{id:'3-cto',role:'cto',companyId:3},null] as (Identity|null)[];
 const servers=new Map<string,{socket:ServerSocket;sync:SnapshotSync;identity:Identity|null}>();
 io.on('connection',socket=>{const identity=socket.handshake.auth.identity??null;servers.set(identity?.id??'public',{socket,sync:new SnapshotSync(socket),identity});socket.on('command',(_c:unknown,ack:(r:unknown)=>void)=>ack({ok:true,refs:['r-1']}));});
 http.listen(0,'127.0.0.1');await once(http,'listening');const port=(http.address() as {port:number}).port;
 const clients:Socket[]=[],states=new Map<Socket,ClientState|undefined>();let received=0,binary:unknown;
 try{
  for(const identity of identities){
   const socket=connect(`http://127.0.0.1:${port}`,{forceNew:true,reconnection:false,transports:['websocket'],auth:{identity}});clients.push(socket);
   socket.on('state:update',(packet:StatePacket,ack:(v:unknown)=>void)=>{const r=receiveState(states.get(socket),packet);assert(!r.resync);states.set(socket,r.state);received++;ack({stream:packet.stream,seq:packet.seq});});
   socket.on('blob',(value:unknown)=>{binary=value;});
   await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  }
  for(let round=0;round<12;round++){
   for(let i=0;i<5;i++)step(g);
   if(round%3===1)applyCommand(g,{id:'0-backend',role:'backend',companyId:0},{id:`chat-${round}`,type:'chat.send',companyId:0,payload:{channel:'equipo-interno',text:`ronda ${round}`,refs:[]}});
   if(round===5)applyCommand(g,{id:'3-devops',role:'devops',companyId:3},{id:'scale',type:'infra.scale',companyId:3,payload:{delta:1}});
   // Same projection reuse as server/index.ts broadcast(): shared public companies for non-operators.
   const publicProjection=project(g,null);let shared:Snapshot['companies']|undefined;const expected=received+servers.size;
   for(const {sync,identity} of servers.values())sync.send(()=>identity?.role==='operator'?project(g,identity):identity?project(g,identity,publicProjection):publicProjection,Date.now(),identity?.role==='operator'?undefined:()=>shared??=compactCompanies(publicProjection.companies));
   // Wait for every client ACK so the next round is not coalesced behind an in-flight update.
   for(let i=0;received<expected||[...servers.values()].some(e=>(e.sync as any).inFlight);i++){assert(i<1000,'state updates delivered and acknowledged');await new Promise(r=>setTimeout(r,5));}
  }
  for(const socket of clients)assert.deepEqual(JSON.parse(JSON.stringify(states.get(socket)!.snapshot)),JSON.parse(JSON.stringify(project(g,servers.get((socket.auth as any).identity?.id??'public')!.identity))));
  assert.deepEqual(await clients[1].timeout(5000).emitWithAck('command',{id:'x',type:'noop'}),{ok:true,refs:['r-1']});
  servers.get('public')!.socket.emit('blob',{bytes:Buffer.from([1,2,3]),label:'binary'});
  for(let i=0;!binary;i++){assert(i<500);await new Promise(r=>setTimeout(r,5));}
  assert.deepEqual(Buffer.from((binary as {bytes:ArrayBuffer}).bytes),Buffer.from([1,2,3]));
  assert(counts.full>=identities.length&&counts.delta>=identities.length*5,JSON.stringify(counts));assert(counts.ack>=1&&counts.binary===1,JSON.stringify(counts));
 }finally{for(const socket of clients)socket.disconnect();io.close();}
});

test('state:update encoder guard: a binary payload would no longer match the stock Encoder',()=>{
 // The byte-equality test above fails if a Buffer is ever added to state:update; this documents why.
 const packet={type:socketIoParser.PacketType.EVENT,nsp:'/',id:7,data:['state:update',{kind:'full',bytes:Buffer.from([1])}]};
 assert.notDeepEqual(new StateUpdateEncoder().encode(structuredClone(packet)),standardEncoder().encode(structuredClone(packet)));
 const plain={type:socketIoParser.PacketType.EVENT,nsp:'/',id:8,data:['state:update',{kind:'delta',patch:['=',{a:[1,'b',null]}]}]};
 assert.deepEqual(new StateUpdateEncoder().encode(plain),standardEncoder().encode(plain));
});
