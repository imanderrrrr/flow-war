import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,symlinkSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readArchive,verifyArchive} from '../server/history-admin.js';
import {historySchema} from '../server/history.js';
test('a real archive exported by b52ccc67 remains exact and unchanged under the new reader',()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-legacy-interop-')),archive=join(dir,'old.sqlite'),sha='b52ccc67c8aeaf3d76cf52a4db60d10e120f5942';
 try{
 const tar=execFileSync('git',['archive',sha,'server','shared','package.json'],{maxBuffer:8*1024*1024});execFileSync('tar',['-x','-C',dir],{input:tar});symlinkSync(resolve('node_modules'),join(dir,'node_modules'),'dir');
 const source="import {DatabaseSync} from 'node:sqlite';import {createGame,applyCommand,step,project} from './server/engine.ts';import {createGameWriter} from './server/storage.ts';import {adminSchema,exportGeneration} from './server/history-admin.ts';const db=new DatabaseSync(process.env.OLD_DB);db.exec('CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');const g=createGame(2),write=createGameWriter(db);adminSchema(db);write(g);applyCommand(g,{id:'operator',role:'operator',companyId:null},{id:'start',type:'room.start'},{receivedAt:1000});applyCommand(g,{id:'0-backend',role:'backend',companyId:0},{id:'chat',type:'chat.send',companyId:0,payload:{channel:'equipo-interno',text:'archivo antiguo sintético',refs:[]}},{receivedAt:1001});while(g.status==='RUNNING')step(g);write(g);exportGeneration(db,0,process.env.OLD_ARCHIVE);console.log(JSON.stringify(project(g,{id:'operator',role:'operator',companyId:null})));db.close();";
 const expected=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',source],{cwd:dir,env:{...process.env,OLD_DB:join(dir,'live.sqlite'),OLD_ARCHIVE:archive},encoding:'utf8'}));
 const hash=()=>createHash('sha256').update(readFileSync(archive)).digest('hex'),before=hash();const actual=readArchive(archive).snapshot;assert.equal(actual.dvrEnabled,true);const {dvrEnabled,...compatible}=actual;assert.deepEqual(JSON.parse(JSON.stringify(compatible)),expected);assert.equal(hash(),before);assert.equal(verifyArchive(archive).lastTick,2);
 const old=new DatabaseSync(archive);assert(!(old.prepare('PRAGMA table_info(history_games)').all() as {name:string}[]).some(c=>c.name==='dvrEnabled'));historySchema(old);assert.equal(old.prepare('SELECT dvrEnabled FROM history_games WHERE generation=0').get()!.dvrEnabled,1);old.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
