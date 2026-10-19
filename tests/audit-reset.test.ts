import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createGame,applyCommand} from '../server/engine.js';
import {createGameWriter} from '../server/storage.js';
import {historyAccess,reconstruct,sealLegacyGenerations} from '../server/history.js';
import {advanceGame,command} from './helpers.js';
import {buffer,observe,copyHistoryBuffer} from '../server/observability.js';
import {serializeGame,recoverGame} from '../server/persistence.js';
const op={id:'operator',role:'operator',companyId:null} as const;
for(const status of ['RUNNING','PAUSED','FINISHED'] as const)test(`H1 reset ${status} retains exact terminal generation and next lobby`,()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-reset-')),path=join(dir,'game.sqlite');let db=new DatabaseSync(path);db.exec('CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');
 const write=createGameWriter(db),g=createGame(1200);write(g);command(g,'operator','room.start');advanceGame(g,3.7);if(status==='PAUSED')command(g,'operator','room.pause');if(status==='FINISHED')command(g,'operator','room.finish');
 const expected=serializeGame(g);observe(g,'pending-evidence',0,{proof:'preserved'});
 assert(applyCommand(g,op,{id:'reset',type:'room.reset',payload:{duration:1200}},{receivedAt:123456}).ok);
 write(g,{identity:op.id,id:'reset',digest:'same',result:'{"ok":true}'});
 assert.equal(g.generation,1);assert.equal(g.status,'LOBBY');assert.equal(g.tick,0);
 const meta=historyAccess(db,0,op);assert.equal(meta.status,status==='FINISHED'?'FINISHED':'ABORTED');assert.equal(meta.tick,3.7);
 const restored=reconstruct(db,0,3.7);const control=recoverGame(expected);if(status!=='FINISHED')command(control,'operator','room.finish');
 assert.deepEqual(restored.companies.map(c=>[c.capital,c.revenue,c.traffic.totals,c.traffic.inventory]),control.companies.map(c=>[c.capital,c.revenue,c.traffic.totals,c.traffic.inventory]));assert.deepEqual(restored.market,control.market);assert.equal(restored.tick,3.7);
 if(status!=='FINISHED')assert(restored.companies.every(c=>Object.values(c.traffic.requests).every(r=>r.result&&r.result.at<=3.7)));
 if(status!=='FINISHED'){assert.equal(restored.closure?.previousStatus,status);assert.equal(restored.closure?.receivedAt,123456);assert.deepEqual(restored.closure?.actor,op);}
 assert.throws(()=>reconstruct(db,0,3.8));assert(db.prepare("SELECT 1 FROM history_events WHERE kind='pending-evidence'").get());
 db.close();db=new DatabaseSync(path);assert.equal(historyAccess(db,0,op).tick,3.7);assert.equal(recoverGame((db.prepare('SELECT state FROM game').get()as{state:string}).state).generation,1);assert(db.prepare("SELECT result FROM commands WHERE id='reset'").get());assert.equal(reconstruct(db,1,0).status,'LOBBY');db.close();rmSync(dir,{recursive:true,force:true});
});
test('H1 failed transaction preserves all buffers, rolls back both generations and can retry',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT)');const write=createGameWriter(db),g=createGame();write(g);command(g,'operator','room.start');advanceGame(g,2);observe(g,'not-yet-written',0);const before=structuredClone(g);copyHistoryBuffer(g,before);
 command(g,'operator','room.reset');db.exec("CREATE TRIGGER fail_reset BEFORE INSERT ON history_games WHEN NEW.generation=1 BEGIN SELECT RAISE(ABORT,'injected disk failure'); END;");
 assert.throws(()=>write(g,{identity:'operator',id:'reset',digest:'x',result:'{"ok":true}'}));assert.equal(db.prepare('SELECT count(*) AS n FROM history_games').get()!.n,1);assert.equal(db.prepare('SELECT status FROM history_games').get()!.status,'LOBBY');assert.equal(db.prepare('SELECT count(*) AS n FROM commands').get()!.n,0);assert(buffer(g).closed[0]);assert(buffer(before).events.some(e=>e.kind==='not-yet-written'));assert.equal(before.tick,2);
 db.exec('DROP TRIGGER fail_reset');write(g);assert.equal(historyAccess(db,0,op).status,'ABORTED');assert(db.prepare("SELECT 1 FROM history_events WHERE kind='not-yet-written'").get());db.close();
});
test('H1 student reset is denied and cannot close or replace a generation',()=>{const g=createGame();const r=command(g,'backend','room.reset');assert.equal(r.ok,false);assert.equal(g.generation,0);assert.equal(buffer(g).closed.length,0);});
test('H1 legacy unclosed generation is sealed only through its durable tick',()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT)');const write=createGameWriter(db),g=createGame();write(g);command(g,'operator','room.start');advanceGame(g,2);write(g);const next=createGame(1200,7357,1);write(next);sealLegacyGenerations(db,1);const old=reconstruct(db,0,2);assert.equal(old.status,'ABORTED');assert.equal(old.closure?.reason,'LEGACY_UNCLOSED');assert.equal(old.closure?.actor,null);assert.throws(()=>reconstruct(db,0,2.1));db.close();});
