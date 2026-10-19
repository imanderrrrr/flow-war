import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
/** Durable process lease. SQLite serializes admission; a dead owner's PID can be reclaimed. */
export function acquireStorageLease(db:DatabaseSync) {
 const token=randomUUID();db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');
 try{
  db.exec('CREATE TABLE IF NOT EXISTS storage_lease(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,token TEXT NOT NULL)');
  const prior=db.prepare('SELECT pid FROM storage_lease WHERE id=1').get()as{pid:number}|undefined;
  if(prior){let alive=true;try{process.kill(prior.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')alive=false;}if(alive)throw Error('El servidor u otro administrador está usando el almacenamiento. Detén Node antes del mantenimiento.');}
  db.prepare('INSERT INTO storage_lease VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid,token=excluded.token').run(process.pid,token);db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return ()=>db.prepare('DELETE FROM storage_lease WHERE id=1 AND token=?').run(token);
}
