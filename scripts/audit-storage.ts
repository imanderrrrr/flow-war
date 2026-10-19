import {stableDigest} from '../server/discipline.js';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,cpus} from 'node:os';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createGame,applyCommand,step} from '../server/engine.js';
import {createGameWriter} from '../server/storage.js';
import {decodeReceipt,compactReceipts} from '../server/receipt-storage.js';
import {adminSchema,storageUsage,exportGeneration,verifyArchive,readArchive} from '../server/history-admin.js';
import {marketSample} from './market-scenarios.js';
const dir=mkdtempSync(join(tmpdir(),'flow-storage-bench-')),path=join(dir,'game.sqlite'),db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL;CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');const write=createGameWriter(db);adminSchema(db);const g=createGame(60),op={id:'operator',role:'operator',companyId:null}as const,growth:unknown[]=[],economy:unknown[]=[];
const run=(type:string)=>assert(applyCommand(g,op,{id:crypto.randomUUID(),type}).ok);
function receiptsDigest(){const hash=createHash('sha256');for(const row of db.prepare('SELECT * FROM request_receipts ORDER BY id').iterate())hash.update(stableDigest(decodeReceipt(db,row as any))+'\n');return hash.digest('hex');}
try{
 write(g);for(let i=0;i<3;i++){run('room.start');while(g.status==='RUNNING'){step(g);if(Math.round(g.tick*10)%100===0)write(g);}write(g);db.exec('PRAGMA wal_checkpoint(TRUNCATE)');growth.push({generationCount:i+1,...storageUsage(db,path)});economy.push(marketSample(g));if(i<2){run('room.reset');g.duration=60;write(g);}}
 const original=receiptsDigest();let rawBytes=0,zlibBytes=0;
 // Materialize the equivalent legacy inline representation, then compact the same evidence.
 db.exec('BEGIN');for(const row of db.prepare('SELECT * FROM request_receipts').iterate()){const receipt=decodeReceipt(db,row as any),raw=JSON.stringify(receipt);rawBytes+=Buffer.byteLength(raw);zlibBytes+=deflateSync(raw).length;db.prepare('UPDATE request_receipts SET receipt=?,details=NULL,detailDigest=NULL WHERE id=?').run(raw,row.id);}db.exec('DELETE FROM receipt_paths;COMMIT;PRAGMA wal_checkpoint(TRUNCATE);VACUUM;PRAGMA wal_checkpoint(TRUNCATE)');
 const inline=storageUsage(db,path);assert.equal(receiptsDigest(),original);const migration=compactReceipts(db);assert.equal(receiptsDigest(),original);db.exec('VACUUM;PRAGMA wal_checkpoint(TRUNCATE)');const compact=storageUsage(db,path);
 const archive=join(dir,'generation-0.sqlite'),exported=exportGeneration(db,0,archive);assert.equal(verifyArchive(archive,exported.digest).lastTick,60);assert.equal(readArchive(archive,60).snapshot.tick,60);
 writeFileSync('docs/benchmarks/audit-fixes/storage.json',JSON.stringify({hardware:{node:process.version,cpu:cpus()[0]?.model},scenario:'Three complete 60-second educational fixtures; exact same evidence before/after format migration',growth,inline,compact,savedPhysicalBytes:inline.sqliteBytes-compact.sqliteBytes,savedPercent:(inline.sqliteBytes-compact.sqliteBytes)/inline.sqliteBytes*100,migration,rawReceiptBytes:rawBytes,evaluatedZlibReceiptBytes:zlibBytes,receiptDigest:original,archive:{bytes:statSync(archive).size,digest:exported.digest},economy},null,2));
}finally{db.close();rmSync(dir,{recursive:true,force:true});}
