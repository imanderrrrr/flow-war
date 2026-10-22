import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createGame, step } from '../server/engine.js';
import { createGameWriter } from '../server/storage.js';
import { reconstruct, historyAccess } from '../server/history.js';
import { command, advanceGame , reviewForQa } from './helpers.js';
import { assertMarket } from '../server/market.js';
function setup(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT)');return {db,write:createGameWriter(db)};}
test('D01-D07 deterministic checkpoints and commands reconstruct actual historical versions and money',()=>{
 const {db,write}=setup(),g=createGame(1200);write(g);command(g,'operator','room.start');advanceGame(g,30);write(g);
 command(g,'cto','cto.budget',{amount:250});write(g);advanceGame(g,20);const expected=structuredClone(g.companies.map(c=>({capital:c.capital,customers:c.customers,version:c.version})));write(g);
 advanceGame(g,20);command(g,'operator','room.finish');write(g);const original=JSON.stringify(g);const historical=reconstruct(db,0,50);
 assert.deepEqual(historical.companies.map(c=>({capital:c.capital,customers:c.customers,version:c.version})),expected);assertMarket(historical);assert.equal(JSON.stringify(g),original);assert.equal(reconstruct(db,0,20).tick,20);db.close();
});
test('D16-D19 history requires finished session and rejects missing legacy intervals',()=>{
 const {db,write}=setup(),g=createGame();g.observability.startTick=100;g.tick=100;write(g);
 assert.throws(()=>historyAccess(db,0,null));assert.throws(()=>historyAccess(db,0,{id:'op',role:'operator',companyId:null}));assert.throws(()=>reconstruct(db,0,20));db.close();
});
test('D13-D15 finished checkpoint survives reopening storage and ordered queries are immutable',()=>{
 const {db,write}=setup(),g=createGame();write(g);command(g,'operator','room.start');for(let i=0;i<50;i++)step(g);command(g,'operator','room.finish');write(g);
 const rebuilt=reconstruct(db,0,5);assert.equal(rebuilt.status,'FINISHED');assertMarket(rebuilt);assert.equal(historyAccess(db,0,{id:'op',role:'operator',companyId:null}).tick,5);db.close();
});
test('D06-D08 deployments and QA versions only exist after actual publication',()=>{const {db,write}=setup(),g=createGame(1200);write(g);command(g,'operator','room.start');advanceGame(g,2);command(g,'backend','change.submit',{graph:g.companies[0].backend,revision:0});const ch=g.changes[0];reviewForQa(g);command(g,'qa','qa.run',{suite:'Concurrencia'},ch.id);advanceGame(g,4);command(g,'qa','qa.approve',{},ch.id);command(g,'cto','cto.authorize',{},ch.id);command(g,'devops','deploy.start',{strategy:'rolling'},ch.id);write(g);advanceGame(g,7);command(g,'operator','room.finish');write(g);assert.equal(reconstruct(db,0,7).companies[0].version,1);const later=reconstruct(db,0,13);assert.equal(later.companies[0].version,2);assert.equal(later.changes[0].status,'DEPLOYED');db.close();});
