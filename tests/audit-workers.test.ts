import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DvrPool,DvrBusy} from '../server/dvr-pool.js';
import {queryDvr,type DvrQuery} from '../server/dvr-query.js';
import {createGame,step} from '../server/engine.js';
import {createGameWriter} from '../server/storage.js';
import {command} from './helpers.js';
const q:DvrQuery={kind:'frame',identity:{id:'operator',role:'operator',companyId:null},generation:0,companyId:0,at:119.9};
function fixture(){const dir=mkdtempSync(join(tmpdir(),'flow-workers-')),path=join(dir,'game.sqlite'),db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL;CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT)');const write=createGameWriter(db),g=createGame(1200);write(g);command(g,'operator','room.start');for(let i=0;i<1200;i++){step(g);if(i%100===0)write(g);}command(g,'operator','room.finish');write(g);return{dir,path,db};}
test('H3 independent workers reconstruct exactly, keep main timers live, enforce limits, cancel and recover',{timeout:30000},async()=>{
 const {dir,path,db}=fixture(),pool=new DvrPool(path,{workers:1,queue:1,perUser:2});
 try{
  const expected=queryDvr(db,q);let heartbeats=0;const timer=setInterval(()=>heartbeats++,10);
  const first=pool.run(q),second=pool.run({...q,at:119.8});
  await assert.rejects(pool.run(q),e=>e instanceof DvrBusy&&e.status===429);
  await assert.rejects(pool.run({...q,identity:{...q.identity,id:'another'}}),e=>e instanceof DvrBusy&&e.status===503);
  assert.deepEqual(JSON.parse(JSON.stringify(await first)),JSON.parse(JSON.stringify(expected)));await second;clearInterval(timer);assert(heartbeats>=3,'CPU replay must leave the main event loop responsive');
  const controller=new AbortController(),cancelled=pool.run(q,controller.signal);controller.abort();await assert.rejects(cancelled,e=>e instanceof DvrBusy&&e.status===499);
  // A new job may wait for termination, but cannot run in the cancelled worker.
  const next=await pool.run(q);assert.equal(next.at,119.9);assert.equal(pool.stats.queued,0);
  const queuedController=new AbortController(),running=pool.run(q),queued=pool.run(q,queuedController.signal);queuedController.abort();await assert.rejects(queued,e=>e instanceof DvrBusy&&e.status===499);await running;
  const failing=assert.rejects(pool.run(q),e=>e instanceof DvrBusy&&e.status===503);await (pool as any).slots[0].worker.terminate();await failing;assert.equal((await pool.run(q)).at,119.9);
  assert.throws(()=>new DvrPool(path,{workers:100}));
 }finally{await pool.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
