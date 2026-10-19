import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyCommand, step } from '../server/engine.js';
import { buffer, observe } from '../server/observability.js';
import { serializeGame, recoverGame } from '../server/persistence.js';
test('observability has stable total order and compact confirmed request references', () => {
 const g = createGame(); applyCommand(g, {id:'operator',role:'operator',companyId:null},{id:'start',type:'room.start'});
 for(let i=0;i<20;i++) step(g);
 const events=buffer(g).events; assert(events.every((e,i)=>i===0||e.id>events[i-1].id));
 const receipt=events.find(e=>e.kind==='request.settled')!; assert(receipt); assert.equal(receipt.refs[0], receipt.data.requestId); assert(!('path' in receipt.data));
 const saved=recoverGame(serializeGame(g)); const next=observe(saved,'test',0); assert.equal(next.id,g.observability.sequence+1);
});
test('pending history survives command rollback without retaining failed mutations',async()=>{const{copyHistoryBuffer}=await import('../server/observability.js');const g=createGame();observe(g,'preexisting-uncommitted',0);const before=structuredClone(g);copyHistoryBuffer(g,before);observe(g,'failed-command',0);assert(buffer(before).events.some(e=>e.kind==='preexisting-uncommitted'));assert(!buffer(before).events.some(e=>e.kind==='failed-command'));});
