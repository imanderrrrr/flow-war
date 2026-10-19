import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {queryDvr,DvrError,type DvrQuery} from './dvr-query.js';
const db=new DatabaseSync(workerData.path,{readOnly:true});
db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;PRAGMA cache_size=-8192;PRAGMA mmap_size=0');
parentPort!.on('message',({id,query}:{id:number;query:DvrQuery})=>{
 try{db.exec('BEGIN');const result=queryDvr(db,query);db.exec('COMMIT');parentPort!.postMessage({id,result});}
 catch(e){try{db.exec('ROLLBACK');}catch{}parentPort!.postMessage({id,error:{status:e instanceof DvrError?e.status:403,message:e instanceof DvrError?e.message:'Intervalo sin evidencia reconstruible o partida no autorizada.'}});}
});
