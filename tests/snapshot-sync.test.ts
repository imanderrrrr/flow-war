import test from 'node:test';
import {compactSnapshot,compactCompanies,expandSnapshot} from '../shared/snapshot-codec.js';
import assert from 'node:assert/strict';
import {difference,applyPatch,receiveState,identityKey,type Json,type StatePacket,type ClientState} from '../shared/sync.js';
import {createGame,project,step,applyCommand,event} from '../server/engine.js';
import {SnapshotSync} from '../server/snapshot-sync.js';
import type {Socket} from 'socket.io';
const wire=(v:unknown)=>JSON.parse(JSON.stringify(v));
const initial=()=>wire(project(createGame(),{id:'0-backend',role:'backend',companyId:0}));
const full=(seq=1,snapshot=initial()):StatePacket=>({protocol:1,stream:'connection-a',seq,kind:'full',generation:snapshot.generation,identity:identityKey(snapshot),snapshot});
for(const [name,before,after]of [
 ['nested object',{a:{b:1,c:2}},{a:{b:3,c:2}}],['deleted field',{a:1,b:2},{a:1}],['truncated array',[1,2,3],[1]],['new fields',{}, {a:[null,1,'x']}],['keyed reorder and deletion',[{id:'a',v:1},{id:'b',v:2}],[{id:'b',v:3},{id:'c',v:4}]],['empty keyed array',[{id:'a'}],[]],['null transition',{a:1},null],['primitive array',[1,2,3],[1,3,3]],['duplicate IDs',[{id:'a'},{id:'a'}],[{id:'b'}]]
] as [string,Json,Json][])test(`sync edits ${name} without mutating the base`,()=>{const saved=wire(before),patch=difference(before,after);assert(patch);assert.deepEqual(applyPatch(before,patch),after);assert.deepEqual(before,saved);assert.equal(difference(after,wire(after)),undefined);});
test('sync first connection requires a complete base',()=>{const s=receiveState(undefined,full());assert(s.applied);assert.deepEqual(s.state!.snapshot,initial());assert.equal(s.resync,false);});
test('sync sequence gap clears private state and requests a complete base',()=>{const s=receiveState(undefined,full()).state;const r=receiveState(s,{protocol:1,stream:'connection-a',seq:3,base:2,kind:'delta',generation:0,identity:s!.identity,patch:['=',initial()]});assert(r.resync);assert.equal(r.state,undefined);assert(receiveState(r.state,full(4)).applied);});
test('sync ignores stale full and out-of-order updates',()=>{const s=receiveState(undefined,full(8)).state;assert.equal(receiveState(s,full(7)).applied,false);assert.equal(receiveState(s,full(8)).resync,false);assert.equal(receiveState(s,{...full(9),stream:'old-connection'}).applied,false);});
test('sync identity replacement discards previous private company',()=>{const s=receiveState(undefined,full()).state,next=wire(project(createGame(),{id:'1-qa',role:'qa',companyId:1}));const r=receiveState(s,full(2,next));assert(r.applied);assert.equal(r.state!.snapshot.privateCompany!.id,1);assert(!JSON.stringify(r.state!.snapshot.privateCompany).includes('NOVA'));});
test('sync logout/public base removes every private domain',()=>{const s=receiveState(undefined,full()).state,r=receiveState(s,full(2,wire(project(createGame(),null))));assert.equal(r.state!.snapshot.privateCompany,undefined);assert.equal(r.state!.snapshot.slack,undefined);assert.equal(r.state!.snapshot.operations,undefined);assert.equal(r.state!.snapshot.changes.length,0);});
test('sync generation needs a new full base',()=>{const state=receiveState(undefined,full()).state,next=initial();next.generation=1;next.tick=0;const patch=difference(state!.snapshot as any,next)!;assert(receiveState(state,{protocol:1,stream:'connection-a',seq:2,base:1,kind:'delta',generation:1,identity:state!.identity,patch}).resync);assert.equal(receiveState(state,full(3,next)).state!.generation,1);});
test('sync rejects identity or economic clock changes inside a delta',()=>{const state=receiveState(undefined,full(2)).state!;state.snapshot.tick=10;for(const next of [{...state.snapshot,tick:9},{...state.snapshot,identity:null}]){const p=difference(state.snapshot as any,next as any)!;assert(receiveState(state,{protocol:1,stream:state.stream,seq:3,base:2,kind:'delta',generation:0,identity:state.identity,patch:p}).resync);}});
test('sync coalesces slow consumers, times out to a fresh base, and skips blocked transports',()=>{const messages:any[]=[],acks:Function[]=[],socket={data:{},conn:{transport:{writable:true}},timeout:()=>({emit:(_event:string,packet:StatePacket,ack:Function)=>{messages.push(packet);acks.push(ack);}})} as unknown as Socket;const sync=new SnapshotSync(socket);let builds=0;const build=()=>{builds++;return initial();};sync.send(build,0);for(let i=1;i<=100;i++)sync.send(build,i);assert.equal(messages.length,1);assert.equal(builds,1);assert.equal(sync.metrics.coalesced,100);sync.send(build,2001);assert.equal(messages[1].kind,'full');acks[1](null,{stream:messages[1].stream,seq:messages[1].seq});socket.conn.transport.writable=false;sync.send(build,2100);assert.equal(builds,2);});
test('sync reconstructed clients equal authorized projections through live engine changes',()=>{const g=createGame(1200,8),identities=[null,{id:'operator',role:'operator' as const,companyId:null},...[0,1,2,3,4].map(companyId=>({id:`${companyId}-backend`,role:'backend' as const,companyId}))],states:(ClientState|undefined)[]=[],bytes:number[]=[0,0];applyCommand(g,identities[1],{id:'start',type:'room.start'});for(let tick=0;tick<40;tick++){step(g);for(let i=0;i<identities.length;i++){const snap=wire(project(g,identities[i])),old=states[i],seq=(old?.seq??0)+1,packet:StatePacket=old?{protocol:1,stream:'s',seq,base:old.seq,generation:g.generation,identity:identityKey(snap),kind:'delta',patch:difference(old.snapshot as any,snap)!}:{protocol:1,stream:'s',seq,generation:g.generation,identity:identityKey(snap),kind:'full',snapshot:snap};const result=receiveState(old,packet);assert(result.applied);assert.deepEqual(result.state!.snapshot,snap);states[i]=result.state;bytes[0]+=JSON.stringify(snap).length;bytes[1]+=JSON.stringify(packet).length;if(identities[i]?.companyId!=null)assert(result.state!.snapshot.slack!.every(m=>m.companyId===identities[i]!.companyId));}}assert(bytes[1]<bytes[0]*.7,`${bytes[1]}/${bytes[0]}`);});

test('compact wire codec preserves exact React projections and particle IDs for every role',()=>{const g=createGame(1200,8);applyCommand(g,{id:'operator',role:'operator',companyId:null},{id:'go',type:'room.start'});for(let i=0;i<35;i++)step(g);for(const identity of [null,{id:'operator',role:'operator',companyId:null},...['backend','security','qa','cto','devops','product'].map(role=>({id:`0-${role}`,role,companyId:0}))] as any[]){const full=wire(project(g,identity)),packed=wire(compactSnapshot(full));assert.deepEqual(wire(expandSnapshot(packed)),full);}});

test('public synchronization retains race and collapse alerts but never foreign administrative details',()=>{const g=createGame();event(g,1,'public-race','neutral','CONCURRENCIA');event(g,1,'private-budget','neutral','CTO');event(g,1,'private-pipeline','neutral','PIPELINE');for(const identity of [null,{id:'0-backend',role:'backend' as const,companyId:0}]){const s=project(g,identity);assert(s.events.some(e=>e.text==='public-race'));assert(!JSON.stringify(s.events).includes('private-'));}assert(project(g,{id:'operator',role:'operator',companyId:null}).events.some(e=>e.text==='private-budget'));});

test('shared packed public companies preserve independent private snapshots for all five companies',()=>{
 const g=createGame(1200,8);
 applyCommand(g,{id:'operator',role:'operator',companyId:null},{id:'begin-packed',type:'room.start'});
 for(let i=0;i<12;i++)step(g);
 const publicProjection=project(g,null);
 const shared=compactCompanies(publicProjection.companies);
 for(let companyId=0;companyId<5;companyId++)for(const role of ['backend','security','qa','cto','devops'] as const){
  const identity={id:`${companyId}-${role}`,role,companyId};
  const view=project(g,identity,publicProjection);
  const previous=wire(compactSnapshot(view));
  const optimized=wire(compactSnapshot(view,shared));
  assert.deepEqual(optimized,previous,`${companyId}/${role}`);
  assert.deepEqual(wire(expandSnapshot(optimized)),wire(view),`${companyId}/${role} expansion`);
  assert.equal(optimized.privateCompany?.id,companyId);
 }
 const first=wire(compactSnapshot(project(g,{id:'0-backend',role:'backend',companyId:0},publicProjection),shared));
 first.companies[0].name='MUTATED';
 assert.notEqual(shared[0].name,'MUTATED','shared public representation must stay detached from socket payloads');
 assert.notEqual(publicProjection.companies[0].name,'MUTATED');
});

test('shared compaction is lazy and never reused across different broadcasts',()=>{
 const messages:any[]=[],socket={data:{},conn:{transport:{writable:true}},timeout:()=>({emit:(_event:string,packet:StatePacket,ack:Function)=>{messages.push({packet,ack});}})} as unknown as Socket;
 const sync=new SnapshotSync(socket),g=createGame(1200,8);
 const identity={id:'0-backend',role:'backend' as const,companyId:0};
 let packs=0;
 const shared=project(g,null);
 const pack=()=>{packs++;return compactCompanies(shared.companies);};
 sync.send(()=>project(g,identity,shared),0,pack);
 assert.equal(packs,1);
 sync.send(()=>project(g,identity,shared),1,pack);
 assert.equal(packs,1,'coalesced sockets do not compact again');
 messages[0].ack(null,{stream:messages[0].packet.stream,seq:messages[0].packet.seq});
 step(g);
 const fresh=project(g,null);
 sync.send(()=>project(g,identity,fresh),100,()=>{packs++;return compactCompanies(fresh.companies);});
 assert.equal(packs,2,'new broadcast must build new compact data');
 assert.deepEqual(wire(expandSnapshot(messages[1].packet.snapshot??applyPatch(messages[0].packet.snapshot,messages[1].packet.patch))),wire(project(g,identity,fresh)));
});
