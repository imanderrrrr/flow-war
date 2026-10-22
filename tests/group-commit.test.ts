import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createGame,step} from '../server/engine.js';
import {bindObservability,checkpoint,clearBuffer} from '../server/observability.js';
import {serializeGame} from '../server/persistence.js';
import {createGameWriter,type CommandRow} from '../server/storage.js';
import {createCommandPipeline} from '../server/command-pipeline.js';
import {slackFact} from '../server/flowslack.js';
import type {Command,GameState,Identity,Role} from '../shared/types.js';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const operator:Identity={id:'operator',role:'operator',companyId:null};
const member=(companyId:number,role:Role):Identity=>({id:`${companyId}-${role}`,role,companyId});
const ROLES=['backend','security','qa','cto','devops'] as const;
type Send=[Identity,string,Record<string,unknown>|undefined,string];

/** Same fixture as the classroom harness: seed 8, one server, reputation 34. */
function fixture(dvr:boolean){
 const game=createGame(1200,8,1,dvr);for(const c of game.companies)c.reputation=34;clearBuffer(game);checkpoint(game,serializeGame,true);
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE commands (identity TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(identity,id))');
 const write=createGameWriter(db);write(game);return {game,db,write};
}
function harness(options:{dvr:boolean;groupCommit:boolean;maxBatch?:number;write?:(write:ReturnType<typeof createGameWriter>,state:GameState,rows:CommandRow[])=>void}){
 let {game,db,write}=fixture(options.dvr);const results:unknown[]=[],transactions:number[]=[];let sent=0;
 const pipeline=createCommandPipeline({db,hash:sha,game:()=>game,broadcast:()=>{},committed:()=>{},groupCommit:options.groupCommit,maxBatch:options.maxBatch??64,
  restore:state=>{game=state;bindObservability(game,f=>slackFact(game,f));},
  write:(state,rows)=>{transactions.push(rows.length);(options.write??((w,s,r)=>w(s,r)))(write,state,rows);}});
 const send=([identity,type,payload,id]:Send,command:Command={id,type,payload,companyId:identity.companyId??undefined})=>{const index=sent++;pipeline.receive(identity,command,result=>{assert.equal(results[index],undefined,'one ACK per send');results[index]=result;});return index;};
 const burst=(list:Send[])=>{const first=sent;for(const s of list)send(s);pipeline.flush();return results.slice(first);};
 const until=(tick:number)=>{while(game.tick<tick-1e-7){assert.equal(game.status,'RUNNING','the scenario only advances a running game');step(game);}};
 return {db,pipeline,results,transactions,send,burst,until,get game(){return game;}};
}
const chat=(identity:Identity,id:string,text:string):Send=>[identity,'chat.send',{channel:'equipo-interno',text,refs:[]},id];
/** Bursts released by collaboration-classroom.ts at ticks 130 and 160, plus duplicates, conflicts and a reset. */
function play(h:ReturnType<typeof harness>,dvr:boolean){
 h.burst([[operator,'room.dvr',{enabled:dvr},'dvr'],[operator,'room.speed',{speed:20},'speed'],[operator,'room.start',undefined,'start']]);
 h.until(13);
 const ops:Send[]=[];for(let c=0;c<5;c++){for(let i=0;i<6;i++)ops.push([member(c,'cto'),'cto.budget',{amount:1000},`budget-${c}-${i}`]);for(let i=0;i<7;i++)ops.push([member(c,'devops'),'infra.scale',{delta:1},`scale-${c}-${i}`]);ops.push([member(c,'devops'),'infra.balancer',{enabled:true},`balancer-${c}`]);}
 ops.push([member(0,'backend'),'infra.scale',{delta:1},'forbidden-role']);
 h.burst(ops);
 h.until(16);
 const chats:Send[]=[];for(let round=0;round<5;round++)for(let c=0;c<5;c++)for(const role of ROLES)chats.push(chat(member(c,role),`chat-${round}-${c}-${role}`,`Mensaje sintético ${round}`));
 // Second copies inside the same burst: identical ones share the first result, a different body conflicts.
 for(let c=0;c<5;c++)chats.push(chat(member(c,'qa'),`chat-0-${c}-qa`,'Mensaje sintético 0'));
 chats.push(chat(member(1,'cto'),'chat-1-1-cto','otro texto con el mismo ID'));
 h.burst(chats);
 h.until(18);
 // Resent after COMMIT: resolved from the commands table in both modes.
 h.burst([...chats.slice(0,10),ops[0],ops[20]]);
 h.until(19);
 h.burst([chat(member(2,'backend'),'before-reset','antes'),[operator,'room.reset',undefined,'reset'],chat(member(2,'backend'),'after-reset','después'),[operator,'room.start',undefined,'start-2']]);
 h.until(20.5);
}
function tables(db:DatabaseSync){
 const names=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[]).map(r=>r.name);
 const encode=(v:unknown)=>v instanceof Uint8Array?Buffer.from(v).toString('hex'):v;
 return Object.fromEntries(names.map(name=>[name,(db.prepare(`SELECT * FROM ${name}`).all() as Record<string,unknown>[]).map(row=>JSON.stringify(Object.entries(row).map(([k,v])=>[k,encode(v)]))).sort()]));
}
function outcome(h:ReturnType<typeof harness>){return {results:sha(JSON.stringify(h.results)),state:sha(serializeGame(h.game)),tables:tables(h.db)};}

for(const dvr of [false,true])test(`group commit DVR ${dvr?'ON':'OFF'}: same result digest, final state and durable rows as the per-command route`,t=>{
 t.mock.method(Date,'now',()=>1767225600000);
 const reference=harness({dvr,groupCommit:false});play(reference,dvr);const expected=outcome(reference);
 assert(reference.results.length>200);assert(reference.transactions.every(n=>n===1),'per-command route commits one row per transaction');
 for(const maxBatch of [64,7]){
  const grouped=harness({dvr,groupCommit:true,maxBatch});play(grouped,dvr);const actual=outcome(grouped);
  assert.equal(actual.results,expected.results,`results maxBatch=${maxBatch}`);assert.equal(actual.state,expected.state,`state maxBatch=${maxBatch}`);
  assert.deepEqual(actual.tables,expected.tables,`durable rows maxBatch=${maxBatch}`);
  assert(Math.max(...grouped.transactions)<=maxBatch);assert(grouped.transactions.length<reference.transactions.length/3,'bursts share transactions');
 }
 const human=reference.db.prepare("SELECT count(*) AS n FROM slack_messages WHERE generation=1 AND json_extract(body,'$.source')='human'").get()!.n;assert.equal(human,125+1,'every original message once, duplicates never repeat');
 const rows=expected.tables.commands.map(r=>JSON.parse(r) as [string,unknown][]),generation=(id:string)=>rows.find(r=>r.some(([k,v])=>k==='id'&&v===id))!.find(([k])=>k==='generation')![1];
 assert.equal(generation('before-reset'),1);assert.equal(generation('reset'),2);assert.equal(generation('after-reset'),2,'each row keeps the generation it was applied in');
});

test('group commit deduplicates (identity,id) inside a batch and shares the committed result',()=>{
 const h=harness({dvr:false,groupCommit:true});h.burst([[operator,'room.start',undefined,'start']]);h.until(1);
 const message=chat(member(0,'backend'),'same-id','hola equipo');
 const [first,copy,conflict,other]=h.burst([message,message,chat(member(0,'backend'),'same-id','otro cuerpo'),chat(member(1,'backend'),'same-id','hola')]) as any[];
 assert.equal(first.ok,true);assert.deepEqual(copy,JSON.parse(JSON.stringify(first)));assert.deepEqual(conflict,{ok:false,error:'ID de comando ya utilizado.'});assert.equal(other.ok,true,'the key includes the identity');
 assert.deepEqual(h.transactions.slice(-1),[2],'one row per distinct (identity,id)');
 assert.equal(h.game.slack.messages.filter(m=>m.source==='human').length,2);
 assert.deepEqual(h.burst([message])[0],JSON.parse(JSON.stringify(first)),'later copies read the durable row');
});

test('group commit ACKs only after COMMIT and drains a burst in capped batches within one event-loop turn',async()=>{
 const order:string[]=[];
 const h=harness({dvr:false,groupCommit:true,maxBatch:3,write:(write,state,rows)=>{order.push(`commit:${rows.length}`);write(state,rows);}});
 h.burst([[operator,'room.start',undefined,'start']]);h.until(1);order.length=0;
 const pipeline=h.pipeline;let acked=0;
 for(let i=0;i<7;i++)pipeline.receive(member(i%5,'backend'),{id:`m-${i}`,type:'chat.send',companyId:i%5,payload:{channel:'equipo-interno',text:`m${i}`,refs:[]}},()=>{acked++;order.push(`ack:${i}`);});
 assert.equal(acked,0,'nothing is answered before its transaction');assert.equal(pipeline.queued,7);
 // Queued after the pipeline's own setImmediate: a drain that yielded between batches would still be pending here.
 await new Promise(r=>setImmediate(r));
 assert.equal(pipeline.queued,0);
 assert.deepEqual(order,['commit:3','ack:0','ack:1','ack:2','commit:3','ack:3','ack:4','ack:5','commit:1','ack:6']);
});

test('group commit write failure rolls back the whole batch, answers every command with an error and allows an exact retry',()=>{
 const h=harness({dvr:true,groupCommit:true});h.burst([[operator,'room.start',undefined,'start']]);h.until(2);
 const before=serializeGame(h.game),durable=tables(h.db),batch=[0,1,2,3].map(i=>chat(member(i,'qa'),`fail-${i}`,`mensaje ${i}`));
 for(const s of batch)h.send(s);h.send(batch[0]);
 // A row that appears after admission makes the real INSERT violate the primary key inside the transaction.
 h.db.prepare('INSERT INTO commands (identity,id,digest,result) VALUES (?,?,?,?)').run('3-qa','fail-3','x','{}');
 const failed=h.results.length;h.pipeline.flush();
 assert.deepEqual(h.results.slice(failed),Array(5).fill({ok:false,error:'No se pudo confirmar el comando.'}));
 assert.equal(serializeGame(h.game),before,'live state equals the rollback image');
 const after=tables(h.db);after.commands=after.commands.filter(r=>!r.includes('fail-3'));assert.deepEqual(after,durable,'nothing from the batch is durable');
 h.db.prepare("DELETE FROM commands WHERE id='fail-3'").run();
 const retried=h.burst(batch) as any[];assert(retried.every(r=>r.ok));
 assert.equal(h.game.slack.messages.filter(m=>m.source==='human').length,4,'each message exactly once after the retry');
});

test('group commit restores the rollback image when applying a command throws',t=>{
 const h=harness({dvr:false,groupCommit:true});h.burst([[operator,'room.start',undefined,'start']]);h.until(1);
 t.mock.method(console,'error',()=>{});
 const before=serializeGame(h.game);let reads=0;
 // Admission serializes the command once; the second read happens inside applyCommand.
 const exploding={id:'explodes',type:'chat.send',companyId:1,get payload(){if(++reads>1)throw new Error('synthetic engine failure');return {channel:'equipo-interno',text:'x',refs:[]};}} as Command;
 h.send(chat(member(0,'backend'),'applied-first','primero'));h.send([member(1,'backend'),'chat.send',undefined,'explodes'],exploding);
 const failed=h.results.length;h.pipeline.flush();
 assert.deepEqual(h.results.slice(failed),Array(2).fill({ok:false,error:'No se pudo confirmar el comando.'}));
 assert.equal(serializeGame(h.game),before);assert.equal(h.db.prepare("SELECT count(*) AS n FROM commands WHERE id='applied-first'").get()!.n,0);
});
