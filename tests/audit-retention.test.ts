import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createGame,step} from '../server/engine.js';
import {createGameWriter} from '../server/storage.js';
import {historyAccess,reconstruct} from '../server/history.js';
import {command} from './helpers.js';
import {authorizeAdmin,adminSchema,storageUsage,retentionPreview,setRetentionPolicy,protectGeneration,exportGeneration,verifyArchive,deleteArchivedGeneration,readArchive} from '../server/history-admin.js';
import {decodeReceipt,compactReceipts} from '../server/receipt-storage.js';
import {acquireStorageLease} from '../server/storage-lease.js';
const op={id:'operator',role:'operator',companyId:null} as const;
test('H4 complete generations export losslessly, verify, preview, protect, delete atomically and remain readable after reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-retention-')),path=join(dir,'game.sqlite'),archive=join(dir,'generation-0.sqlite');let db=new DatabaseSync(path);
 try{
  db.exec('PRAGMA journal_mode=WAL;CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');const write=createGameWriter(db);adminSchema(db);const g=createGame(2);write(g);
  for(let generation=0;generation<3;generation++){command(g,'operator','room.start');while(g.status==='RUNNING')step(g);assert.equal(g.status,'FINISHED');write(g);if(generation===0)write(g,{identity:'operator',id:'reset-tombstone',digest:'same',result:'{"ok":true}'});if(generation<2){command(g,'operator','room.reset');g.duration=2;write(g);}}
  assert.equal(storageUsage(db,path).generations.length,3);assert(retentionPreview(db).generations.every(g=>!g.eligibleForDeletion));
  const original=reconstruct(db,0,2);const expectedRow=db.prepare('SELECT * FROM request_receipts WHERE generation=0 LIMIT 1').get()as{receipt:string;generation:number};const originalReceipt=decodeReceipt(db,expectedRow);assert(!('path' in JSON.parse(expectedRow.receipt)));assert(originalReceipt.path.length);
  const exported=exportGeneration(db,0,archive);assert.equal(verifyArchive(archive,exported.digest).lastTick,2);assert.deepEqual(readArchive(archive).snapshot.companies[0],readArchive(archive,2).snapshot.companies[0]);
  const archivedDb=new DatabaseSync(archive,{readOnly:true});assert.deepEqual(reconstruct(archivedDb,0,2).market,original.market);const r=archivedDb.prepare('SELECT * FROM request_receipts LIMIT 1').get()as any;assert.deepEqual(decodeReceipt(archivedDb,r),originalReceipt);assert.equal(archivedDb.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='sessions'").get()!.n,0);archivedDb.close();
  assert.throws(()=>deleteArchivedGeneration(db,0,0));setRetentionPolicy(db,{keepGenerations:1,olderThanDays:null,deleteEnabled:true});assert.equal(retentionPreview(db).generations.find(g=>g.generation===0)!.eligibleForDeletion,true);
  protectGeneration(db,0,'trabajo estudiantil');assert.throws(()=>deleteArchivedGeneration(db,0,0));protectGeneration(db,0,null);assert.throws(()=>deleteArchivedGeneration(db,2,2));assert.throws(()=>deleteArchivedGeneration(db,0,1));
  db.exec("CREATE TRIGGER reject_partial_delete BEFORE DELETE ON history_inputs WHEN OLD.generation=0 BEGIN SELECT RAISE(ABORT,'delete failure'); END;");assert.throws(()=>deleteArchivedGeneration(db,0,0));assert.equal(historyAccess(db,0,op).status,'FINISHED');assert.equal(reconstruct(db,0,2).tick,2);db.exec('DROP TRIGGER reject_partial_delete');
  deleteArchivedGeneration(db,0,0);assert(db.prepare("SELECT 1 FROM commands WHERE id='reset-tombstone'").get());assert.throws(()=>historyAccess(db,0,op));assert.equal(reconstruct(db,1,2).tick,2);assert.equal(reconstruct(db,2,2).tick,2);assert.equal(readArchive(archive).snapshot.tick,2);
  db.close();db=new DatabaseSync(path);assert.equal(reconstruct(db,1,2).tick,2);assert.equal(readArchive(archive).snapshot.tick,2);
  const corrupt=join(dir,'corrupt.sqlite');writeFileSync(corrupt,readFileSync(archive));const tamper=new DatabaseSync(corrupt);tamper.exec('UPDATE history_games SET tick=3');tamper.close();assert.throws(()=>verifyArchive(corrupt));assert.throws(()=>verifyArchive(corrupt,exported.digest));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('H4 exact legacy references migrate without ID guessing or loss; active leases and unauthorized CLI credentials are denied',()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-legacy-')),db=new DatabaseSync(join(dir,'game.sqlite'));
 try{
  db.exec('CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT);CREATE TABLE request_receipts(id TEXT PRIMARY KEY,companyId INTEGER,receipt TEXT)');const write=createGameWriter(db),g=createGame(2);command(g,'operator','room.start');while(g.status==='RUNNING')step(g);write(g);adminSchema(db);
  const row=db.prepare('SELECT * FROM request_receipts LIMIT 1').get()as any,receipt=decodeReceipt(db,row);db.prepare('UPDATE request_receipts SET receipt=?,generation=NULL WHERE id=?').run(JSON.stringify(receipt),row.id);
  db.prepare('INSERT INTO request_receipts(id,companyId,receipt) VALUES (?,?,?)').run('g999-looking-but-unknown',0,JSON.stringify({...receipt,id:'g999-looking-but-unknown'}));
  const result=compactReceipts(db);assert.equal(result.linked,1);assert.deepEqual(decodeReceipt(db,db.prepare('SELECT * FROM request_receipts WHERE id=?').get(row.id)as any),receipt);assert.equal(db.prepare("SELECT generation FROM request_receipts WHERE id='g999-looking-but-unknown'").get()!.generation,null);
  const release=acquireStorageLease(db);assert.throws(()=>acquireStorageLease(db));release();const again=acquireStorageLease(db);again();
  writeFileSync(join(dir,'access.json'),JSON.stringify({credentials:[{code:'teacher-secret',identity:op},{code:'student-secret',identity:{id:'0-backend',role:'backend',companyId:0}}]}));assert.throws(()=>authorizeAdmin(dir,undefined));assert.throws(()=>authorizeAdmin(dir,'student-secret'));authorizeAdmin(dir,'teacher-secret');
  setRetentionPolicy(db,{keepGenerations:null,olderThanDays:10,deleteEnabled:true});db.exec('UPDATE history_games SET closedAt=NULL');assert(retentionPreview(db).generations[0].reasons.includes('RETAIN_AGE_OR_UNKNOWN'));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
