import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {realpathSync,statSync} from 'node:fs';

const busy='El servidor u otro administrador está usando el almacenamiento. Detén Node antes del mantenimiento.';
/**
 * A lifetime EXCLUSIVE transaction in a separate rollback-journal database holds
 * SQLite's native OS lock without blocking the room's WAL readers/writer.
 * Never unlink/replace the guard file: its inode is the synchronization domain.
 * PID/token are diagnostics only. Kernel locks disappear on exit/SIGKILL.
 * Requires a local filesystem with working SQLite locks; no network mounts.
 */
export function acquireStorageLease(db:DatabaseSync) {
 const file=(db.prepare('PRAGMA database_list').get() as {file:string}).file;
 if(!file)throw Error('El bloqueo administrativo requiere SQLite local durable.');
 const path=realpathSync(file);
 if(statSync(path).nlink!==1)throw Error('Almacenamiento con enlaces duros no admitido. Usa una única ruta local.');
 const guard=new DatabaseSync(path+'.admin-lock.sqlite');
 const token=randomUUID();let transaction=false,released=false;
 try{
  guard.exec('PRAGMA busy_timeout=0;PRAGMA journal_mode=DELETE;BEGIN EXCLUSIVE');
  // A paused/live owner keeps the OS lock indefinitely: no timeout or heartbeat.
  db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');transaction=true;
  db.exec('CREATE TABLE IF NOT EXISTS storage_lease(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,token TEXT NOT NULL)');
  const columns=db.prepare('PRAGMA table_info(storage_lease)').all();
  if(!columns.some(c=>c.name==='protocol'))db.exec('ALTER TABLE storage_lease ADD COLUMN protocol TEXT');
  const prior=db.prepare('SELECT pid,protocol FROM storage_lease WHERE id=1').get() as {pid:number;protocol:string|null}|undefined;
  // Old binaries do not acquire the guard. A live/ambiguous legacy owner must
  // be stopped before upgrading; never steal from a running older server.
  if(prior&&prior.protocol!=='sqlite-exclusive-v1'){
   let dead=false;try{process.kill(prior.pid,0);}catch(e){dead=(e as NodeJS.ErrnoException).code==='ESRCH';}
   if(!dead)throw Error('Concesión heredada ambigua. Detén todas las instancias anteriores y sigue la recuperación administrativa documentada.');
  }
  db.prepare('INSERT INTO storage_lease(id,pid,token,protocol) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid,token=excluded.token,protocol=excluded.protocol').run(process.pid,token,'sqlite-exclusive-v1');
  db.exec('COMMIT');transaction=false;
 }catch(error){
  if(transaction)try{db.exec('ROLLBACK');}catch{}
  guard.close();
  if((error as {errcode?:number}).errcode===5)throw Error(busy);
  throw error;
 }
 return ()=>{
  if(released)return;
  // A failed diagnostic write still releases the OS lock. The next owner
  // replaces stale rows only after obtaining exclusive ownership.
  try{db.prepare('DELETE FROM storage_lease WHERE id=1 AND token=?').run(token);}
  finally{released=true;try{guard.exec('ROLLBACK');}finally{guard.close();}}
 };
}
