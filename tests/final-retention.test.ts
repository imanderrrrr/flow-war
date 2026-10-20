import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGame,step} from '../server/engine.js';
import {createGameWriter} from '../server/storage.js';
import {command} from './helpers.js';
import {adminSchema,retentionPreview,setRetentionPolicy,protectGeneration,exportGeneration,deleteArchivedGeneration} from '../server/history-admin.js';

test('final retention: preview agrees with actual archive and deletion, independently of protection and retention',()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-final-retention-')),db=new DatabaseSync(join(dir,'game.sqlite'));
 try{
  db.exec('CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');
  const write=createGameWriter(db),g=createGame(2);adminSchema(db);write(g);
  const preview=(n:number)=>retentionPreview(db).generations.find(v=>v.generation===n)!;
  const check=(n:number,archive:boolean,deletion:boolean)=>{assert.equal(preview(n).eligibleForArchive,archive,`archive ${n}`);assert.equal(preview(n).eligibleForDeletion,deletion,`delete ${n}`);};
  // LOBBY and RUNNING must reject both operations.
  check(0,false,false);assert.throws(()=>exportGeneration(db,0,join(dir,'lobby.sqlite')));
  command(g,'operator','room.start');write(g);check(0,false,false);assert.throws(()=>exportGeneration(db,0,join(dir,'running.sqlite')));
  while(String(g.status)==='RUNNING')step(g);write(g);
  // Current FINISHED without a policy: backing up is valid, deleting is not.
  exportGeneration(db,0,join(dir,'finished.sqlite'));check(0,true,false);assert.throws(()=>deleteArchivedGeneration(db,0,0));
  command(g,'operator','room.reset');write(g);check(0,true,false);
  protectGeneration(db,0,'respaldo protegido');check(0,true,false);exportGeneration(db,0,join(dir,'protected.sqlite'));
  setRetentionPolicy(db,{keepGenerations:0,olderThanDays:null,deleteEnabled:true});check(0,true,false);assert.throws(()=>deleteArchivedGeneration(db,0,0));
  protectGeneration(db,0,null);check(0,true,true);
  // Tampered archive and changed live evidence must never be advertised deletable.
  appendFileSync(join(dir,'protected.sqlite'),'tampered');check(0,true,false);assert.throws(()=>deleteArchivedGeneration(db,0,0));
  exportGeneration(db,0,join(dir,'verified.sqlite'));check(0,true,true);
  db.exec("UPDATE history_games SET closedAt=closedAt+1 WHERE generation=0");check(0,true,false);assert.throws(()=>deleteArchivedGeneration(db,0,0));
  exportGeneration(db,0,join(dir,'updated.sqlite'));check(0,true,true);deleteArchivedGeneration(db,0,0);assert.equal(preview(0),undefined);
  setRetentionPolicy(db,{keepGenerations:null,olderThanDays:null,deleteEnabled:false});
  command(g,'operator','room.start');step(g);command(g,'operator','room.reset');write(g);
  assert.equal(preview(1).status,'ABORTED');check(1,true,false);exportGeneration(db,1,join(dir,'aborted.sqlite'));
  // Historical FINISHED with no archive remains exportable, never deletable.
  command(g,'operator','room.start');g.duration=2;while(String(g.status)==='RUNNING')step(g);write(g);command(g,'operator','room.reset');write(g);check(2,true,false);
  setRetentionPolicy(db,{keepGenerations:0,olderThanDays:null,deleteEnabled:true});check(2,true,false);assert.throws(()=>deleteArchivedGeneration(db,2,2));
  // Invalid closure and corrupt evidence must agree with export rejection too.
  db.exec('UPDATE history_games SET closedAt=NULL WHERE generation=2');check(2,false,false);assert.throws(()=>exportGeneration(db,2,join(dir,'invalid.sqlite')));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
