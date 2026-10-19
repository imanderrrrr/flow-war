import {queryDvr} from './dvr-query.js';
import {DatabaseSync} from 'node:sqlite';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {readFileSync,existsSync,statSync,openSync,closeSync,fsyncSync,linkSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {inflateSync} from 'node:zlib';
import {reconstruct} from './history.js';
import {project} from './engine.js';
const TABLES={history_games:'generation',history_events:'generation,seq',history_inputs:'generation,seq',history_checkpoints:'generation,seq',history_points:'generation,at',slack_messages:'generation,id',request_receipts:'id',receipt_paths:'generation,digest',commands:'identity,id'} as const;
type Table=keyof typeof TABLES;
export type RetentionPolicy={keepGenerations:number|null;olderThanDays:number|null;deleteEnabled:boolean};
const DEFAULT_POLICY:RetentionPolicy={keepGenerations:null,olderThanDays:null,deleteEnabled:false};
export function authorizeAdmin(directory:string,code:string|undefined){
 if(!code)throw Error('Se requiere FLOW_ADMIN_CODE del docente.');
 const credentials=JSON.parse(readFileSync(resolve(directory,'access.json'),'utf8')).credentials;
 const digest=(s:string)=>createHash('sha256').update(s).digest();
 if(!credentials.some((c:any)=>c.identity?.role==='operator'&&c.identity.companyId===null&&typeof c.code==='string'&&timingSafeEqual(digest(c.code),digest(code))))throw Error('Credencial administrativa no autorizada.');
}
export function adminSchema(db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS history_policy(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS history_protection(generation INTEGER PRIMARY KEY,reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS history_archives(generation INTEGER PRIMARY KEY,path TEXT NOT NULL,digest TEXT NOT NULL,manifest TEXT NOT NULL,verifiedAt INTEGER NOT NULL);`);}
export function retentionPolicy(db:DatabaseSync):RetentionPolicy {const row=db.prepare('SELECT body FROM history_policy WHERE id=1').get()as{body:string}|undefined;return row?JSON.parse(row.body):{...DEFAULT_POLICY};}
export function setRetentionPolicy(db:DatabaseSync,value:RetentionPolicy){
 if(Object.keys(value).sort().join(',')!=='deleteEnabled,keepGenerations,olderThanDays'||typeof value.deleteEnabled!=='boolean'||(value.keepGenerations!==null&&(!Number.isSafeInteger(value.keepGenerations)||value.keepGenerations<0))||(value.olderThanDays!==null&&(!Number.isFinite(value.olderThanDays)||value.olderThanDays<0)))throw Error('Política de retención inválida.');
 db.prepare('INSERT INTO history_policy VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(value));return value;
}
function activeGeneration(db:DatabaseSync){const row=db.prepare('SELECT state FROM game WHERE id=1').get()as{state:string}|undefined;return row?JSON.parse(row.state).generation:null;}
function validGeneration(generation:number){if(!Number.isSafeInteger(generation)||generation<0)throw Error('Generación inválida.');}
function terminal(db:DatabaseSync,generation:number){validGeneration(generation);const row=db.prepare('SELECT * FROM history_games WHERE generation=?').get(generation)as{generation:number;status:string;closedAt:number|null}|undefined;if(!row||!['FINISHED','ABORTED'].includes(row.status))throw Error('Solo se archivan generaciones cerradas.');return row;}
export function protectGeneration(db:DatabaseSync,generation:number,reason:string|null){validGeneration(generation);if(reason===null)db.prepare('DELETE FROM history_protection WHERE generation=?').run(generation);else{if(!db.prepare('SELECT 1 FROM history_games WHERE generation=?').get(generation))throw Error('Generación ausente.');if(!reason.trim()||reason.length>1000)throw Error('Motivo inválido.');db.prepare('INSERT INTO history_protection VALUES (?,?) ON CONFLICT(generation) DO UPDATE SET reason=excluded.reason').run(generation,reason);} }
export function retentionPreview(db:DatabaseSync,now=Date.now()){
 const policy=retentionPolicy(db),active=activeGeneration(db),rows=db.prepare('SELECT * FROM history_games ORDER BY generation DESC').all()as{generation:number;status:string;closedAt:number|null}[];
 return{policy,generations:rows.map((g,index)=>{
  const reasons:string[]=[];
  if(g.generation===active)reasons.push('CURRENT_GENERATION');if(!['FINISHED','ABORTED'].includes(g.status))reasons.push('NOT_TERMINAL');
  if(db.prepare('SELECT 1 FROM history_protection WHERE generation=?').get(g.generation))reasons.push('PROTECTED');
  if(policy.keepGenerations===null&&policy.olderThanDays===null)reasons.push('NO_RETENTION_RULE');
  if(policy.keepGenerations!==null&&index<policy.keepGenerations)reasons.push('RETAIN_RECENT');
  if(policy.olderThanDays!==null&&(g.closedAt===null||g.closedAt>now-policy.olderThanDays*86400000))reasons.push('RETAIN_AGE_OR_UNKNOWN');
  const archive=db.prepare('SELECT path,digest,verifiedAt FROM history_archives WHERE generation=?').get(g.generation);
  return{...g,archive:archive??null,eligibleForArchive:!reasons.length,eligibleForDeletion:!reasons.length&&!!archive&&policy.deleteEnabled,reasons};
 })};
}
function bytes(path:string){return existsSync(path)?statSync(path).size:0;}
export function storageUsage(db:DatabaseSync,path:string){
 const pageSize=Number(Object.values(db.prepare('PRAGMA page_size').get()!)[0]),freePages=Number(Object.values(db.prepare('PRAGMA freelist_count').get()!)[0]);
 const pages=db.prepare("SELECT s.name,s.type,s.tbl_name AS tableName,coalesce(sum(d.pgsize),0) AS physicalBytes,coalesce(sum(d.payload),0) AS payloadBytes FROM sqlite_master s LEFT JOIN dbstat d ON d.name=s.name WHERE s.type IN ('table','index') GROUP BY s.name ORDER BY physicalBytes DESC").all();
 const generations=(db.prepare('SELECT generation FROM history_games ORDER BY generation').all()as{generation:number}[]).map(({generation})=>({generation,tables:Object.fromEntries(Object.keys(TABLES).map(table=>{const row=db.prepare(`SELECT count(*) AS rows FROM ${table} WHERE generation=?`).get(generation);return[table,row];}))}));
 const evidence=db.prepare('SELECT coalesce(sum(length(CAST(body AS BLOB))),0) AS logicalJsonBytes FROM history_events').get(),checkpoints=db.prepare('SELECT coalesce(sum(length(state)),0) AS compressedBytes FROM history_checkpoints').get();
 return{sqliteBytes:bytes(path),walBytes:bytes(path+'-wal'),shmBytes:bytes(path+'-shm'),pageSize,freePages,freeBytes:freePages*pageSize,pages,generations,unassignedLegacyReceipts:db.prepare('SELECT count(*) AS rows FROM request_receipts WHERE generation IS NULL').get(),evidence,checkpoints,policy:retentionPolicy(db)};
}
function canonicalRow(row:Record<string,any>){return JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key] instanceof Uint8Array?{base64:Buffer.from(row[key]).toString('base64')}:row[key]])));}
function summarize(db:DatabaseSync,table:Table,generation:number){const hash=createHash('sha256');let count=0;for(const row of db.prepare(`SELECT * FROM ${table} WHERE generation=? ORDER BY ${TABLES[table]}`).iterate(generation)){hash.update(canonicalRow(row)+'\n');count++;}return{count,digest:hash.digest('hex')};}
function manifest(db:DatabaseSync,generation:number){return{format:'flow-war-generation-1',generation,tables:Object.fromEntries((Object.keys(TABLES)as Table[]).map(t=>[t,summarize(db,t,generation)]))};}
function fileDigest(path:string){const fd=openSync(path,'r');try{const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let n=0;const {readSync}=requireFs;while((n=readSync(fd,buffer,0,buffer.length,null)))h.update(buffer.subarray(0,n));return h.digest('hex');}finally{closeSync(fd);}}
import * as requireFs from 'node:fs';
export function verifyArchive(path:string,expectedDigest?:string){
 const digest=fileDigest(path);if(expectedDigest&&digest!==expectedDigest)throw Error('Checksum del archivo no coincide.');
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  if(Object.values(db.prepare('PRAGMA integrity_check').get()!)[0]!=='ok')throw Error('Archivo SQLite corrupto.');
  const row=db.prepare('SELECT body FROM archive_manifest WHERE id=1').get()as{body:string}|undefined;if(!row)throw Error('Falta manifiesto.');
  const saved=JSON.parse(row.body);if(saved.format!=='flow-war-generation-1')throw Error('Versión de archivo no soportada.');validGeneration(saved.generation);
  for(const table of Object.keys(TABLES) as Table[]){const total=db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number};if(total.n!==saved.tables?.[table]?.count)throw Error('Archivo contiene filas ajenas o un manifiesto incompleto.');}
  const actual=manifest(db,saved.generation);if(JSON.stringify(actual)!==JSON.stringify(saved))throw Error('Evidencia o esquema de archivo no coincide con el manifiesto.');
  const meta=terminal(db,saved.generation);
  for(const cp of db.prepare('SELECT state,digest FROM history_checkpoints WHERE generation=?').iterate(saved.generation)){if(createHash('sha256').update(inflateSync(cp.state as Uint8Array)).digest('hex')!==cp.digest)throw Error('Checkpoint corrupto en archivo.');}
  const last=(db.prepare('SELECT tick FROM history_games WHERE generation=?').get(saved.generation)as{tick:number}).tick;
  if(reconstruct(db,saved.generation,last).tick!==last)throw Error('Último checkpoint no reconstruible.');
  return{digest,manifest:actual,status:meta.status,lastTick:last};
 }finally{db.close();}
}
export function exportGeneration(db:DatabaseSync,generation:number,path:string){
 terminal(db,generation);path=resolve(path);if(existsSync(path))throw Error('El archivo de destino ya existe.');const temp=path+'.'+randomUUID()+'.tmp';
 closeSync(openSync(temp,'wx',0o600));const archive=new DatabaseSync(temp);let closed=false;
 try{
  db.exec('BEGIN');archive.exec('BEGIN');
  for(const table of Object.keys(TABLES)as Table[]){
   const schema=db.prepare('SELECT sql FROM sqlite_master WHERE type=\'table\' AND name=?').get(table)as{sql:string};archive.exec(schema.sql);
   for(const row of db.prepare(`SELECT * FROM ${table} WHERE generation=? ORDER BY ${TABLES[table]}`).iterate(generation)){
    const names=Object.keys(row);archive.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(()=>'?').join(',')})`).run(...Object.values(row));
   }
  }
  const expected=manifest(db,generation);
  archive.exec('CREATE TABLE archive_manifest(id INTEGER PRIMARY KEY,body TEXT NOT NULL)');archive.prepare('INSERT INTO archive_manifest VALUES (1,?)').run(JSON.stringify(expected));archive.exec('COMMIT');archive.close();closed=true;db.exec('COMMIT');
  const checked=verifyArchive(temp);const fd=openSync(temp,'r');fsyncSync(fd);closeSync(fd);linkSync(temp,path);unlinkSync(temp);const parent=openSync(dirname(path),'r');try{fsyncSync(parent);}finally{closeSync(parent);}
  db.prepare('INSERT INTO history_archives VALUES (?,?,?,?,?) ON CONFLICT(generation) DO UPDATE SET path=excluded.path,digest=excluded.digest,manifest=excluded.manifest,verifiedAt=excluded.verifiedAt').run(generation,path,checked.digest,JSON.stringify(expected),Date.now());
  return{path,...checked};
 }catch(e){try{db.exec('ROLLBACK');}catch{}if(!closed){try{archive.close();}catch{}}try{unlinkSync(temp);}catch{}throw e;}
}
export function deleteArchivedGeneration(db:DatabaseSync,generation:number,confirmGeneration:number){
 validGeneration(generation);if(confirmGeneration!==generation)throw Error('La confirmación debe coincidir con la generación.');
 db.exec('BEGIN IMMEDIATE');
 try{
  const preview=retentionPreview(db).generations.find(g=>g.generation===generation);if(!preview?.eligibleForDeletion)throw Error('Eliminación no habilitada o generación actual, protegida o retenida.');
  const archive=db.prepare('SELECT path,digest,manifest FROM history_archives WHERE generation=?').get(generation)as{path:string;digest:string;manifest:string};
  const verified=verifyArchive(archive.path,archive.digest);
  if(JSON.stringify(manifest(db,generation))!==archive.manifest||JSON.stringify(verified.manifest)!==archive.manifest)throw Error('El historial cambió después del archivado. Exporta de nuevo.');
  // Keep command receipts as durable tombstones: reset idempotency must outlive retention.
  for(const table of Object.keys(TABLES)as Table[])if(table!=='commands')db.prepare(`DELETE FROM ${table} WHERE generation=?`).run(generation);
  db.exec('COMMIT');return{generation,archive:archive.path,recoverable:true,commandReceiptsRetained:true};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function readArchive(path:string,at?:number){const verified=verifyArchive(path);const db=new DatabaseSync(path,{readOnly:true});try{return{...verified,snapshot:project(reconstruct(db,verified.manifest.generation,at??verified.lastTick),{id:'operator',role:'operator',companyId:null})};}finally{db.close();}}

/** Inspect all DVR evidence in an independent archive without importing it into the live room. */
export function queryArchive(path:string,query:Omit<import('./dvr-query.js').DvrQuery,'identity'|'generation'>){
 if(!query||!['games','frame','chat','metrics','request'].includes(query.kind))throw Error('Consulta de archivo inválida.');
 const verified=verifyArchive(path),db=new DatabaseSync(path,{readOnly:true});
 try{return queryDvr(db,{...query,generation:verified.manifest.generation,identity:{id:'operator',role:'operator',companyId:null}});}finally{db.close();}
}
