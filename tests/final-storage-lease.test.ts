import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,symlinkSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {acquireStorageLease} from '../server/storage-lease.js';

test('final lease: stale diagnostics with a reused live PID do not block ownership',()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-final-lease-')),db=new DatabaseSync(join(dir,'game.sqlite'));
 try{
  db.exec('CREATE TABLE storage_lease(id INTEGER PRIMARY KEY,pid INTEGER,token TEXT,protocol TEXT)');
  // A real live PID unrelated to the prior owner: existence cannot prove identity.
  db.prepare('INSERT INTO storage_lease VALUES(1,?,?,?)').run(process.pid,'old-instance','sqlite-exclusive-v1');
  const release=acquireStorageLease(db);assert.throws(()=>acquireStorageLease(db));release();release();
  assert.equal(db.prepare('SELECT count(*) AS n FROM storage_lease').get()!.n,0);
  db.prepare('INSERT INTO storage_lease VALUES(1,?,?,NULL)').run(process.pid,'legacy-instance');assert.throws(()=>acquireStorageLease(db),/heredada ambigua/);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('final lease: independent owners exclude each other and recover after SIGTERM and SIGKILL',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-final-process-')),path=join(dir,'game.sqlite'),db=new DatabaseSync(path);
 const children:ReturnType<typeof spawn>[]=[];
 try{
  db.exec('CREATE TABLE historical_evidence(body TEXT);INSERT INTO historical_evidence VALUES (\'immutable\')');
  const before=db.prepare('SELECT * FROM historical_evidence').all();
  for(const signal of ['SIGTERM','SIGKILL'] as const){
   const code=`import {DatabaseSync} from 'node:sqlite';import {acquireStorageLease} from './server/storage-lease.ts';const db=new DatabaseSync(process.argv[1]);const release=acquireStorageLease(db);process.on('SIGTERM',()=>{release();db.close();process.exit(0)});console.log('owned');setInterval(()=>{},1000);`;
   const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code,path],{stdio:['ignore','pipe','pipe']});children.push(child);
   await once(child.stdout!,'data');assert.equal(child.exitCode,null);
   assert.throws(()=>acquireStorageLease(db));
   const alias=join(dir,`alias-${signal}.sqlite`);symlinkSync(path,alias);const other=new DatabaseSync(alias);try{assert.throws(()=>acquireStorageLease(other));}finally{other.close();}
   if(signal==='SIGTERM'&&process.platform!=='win32'){child.kill('SIGSTOP');await new Promise(r=>setTimeout(r,30));assert.throws(()=>acquireStorageLease(db));child.kill('SIGCONT');}
   const exited=once(child,'exit');child.kill(signal);await exited;
   const release=acquireStorageLease(db);release();
   assert.equal(db.prepare('SELECT count(*) AS n FROM storage_lease').get()!.n,0);
  }
  assert.deepEqual(db.prepare('SELECT * FROM historical_evidence').all(),before);
  linkSync(path,join(dir,'hard.sqlite'));assert.throws(()=>acquireStorageLease(db),/enlaces duros/);
 }finally{for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL');db.close();rmSync(dir,{recursive:true,force:true});}
});

test('final lease: admission and release write failures cannot strand the OS lock',()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-final-write-')),db=new DatabaseSync(join(dir,'game.sqlite'));
 try{
  let release=acquireStorageLease(db);release();
  db.exec("CREATE TRIGGER reject_lease BEFORE INSERT ON storage_lease BEGIN SELECT RAISE(ABORT,'write failure');END");
  assert.throws(()=>acquireStorageLease(db),/write failure/);db.exec('DROP TRIGGER reject_lease');
  release=acquireStorageLease(db);
  db.exec("CREATE TRIGGER reject_release BEFORE DELETE ON storage_lease BEGIN SELECT RAISE(ABORT,'release failure');END");
  assert.throws(release,/release failure/);db.exec('DROP TRIGGER reject_release');
  release=acquireStorageLease(db);release();assert.equal(db.prepare('SELECT count(*) AS n FROM storage_lease').get()!.n,0);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
