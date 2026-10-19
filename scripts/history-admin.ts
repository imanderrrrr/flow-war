import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {createGameWriter} from '../server/storage.js';
import {acquireStorageLease} from '../server/storage-lease.js';
import {compactReceipts} from '../server/receipt-storage.js';
import {authorizeAdmin,adminSchema,storageUsage,retentionPreview,setRetentionPolicy,protectGeneration,exportGeneration,verifyArchive,deleteArchivedGeneration,readArchive,queryArchive} from '../server/history-admin.js';
const [action='usage',...args]=process.argv.slice(2),directory=resolve(process.env.FLOW_DATA_DIR??'.local');
try{
 authorizeAdmin(directory,process.env.FLOW_ADMIN_CODE);
 if(['verify','read','query'].includes(action)){
  if(!args[0])throw Error('Indica ruta de archivo.');
  const file=resolve(args[0]);
  if(action==='query'&&!args[1])throw Error('Indica consulta JSON.');
  const result=action==='verify'?verifyArchive(file,args[1]):action==='query'?queryArchive(file,JSON.parse(args[1])):readArchive(file,args[1]===undefined?undefined:Number(args[1]));
  console.log(JSON.stringify(result,null,2));
 }else{
 const path=resolve(directory,'game.sqlite'),db=new DatabaseSync(path),release=acquireStorageLease(db);
 try{
  // Schema additions only; never save or advance a game during administration.
  createGameWriter(db);adminSchema(db);let result:unknown;
  switch(action){
   case 'usage':result=storageUsage(db,path);break;
   case 'preview':result=retentionPreview(db);break;
   case 'policy':result=setRetentionPolicy(db,JSON.parse(args[0]??'null'));break;
   case 'protect':protectGeneration(db,Number(args[0]),args[1]??'Protegida por el docente');result={protected:Number(args[0])};break;
   case 'unprotect':protectGeneration(db,Number(args[0]),null);result={unprotected:Number(args[0])};break;
   case 'export':if(!args[1])throw Error('Indica generación y ruta de exportación.');result=exportGeneration(db,Number(args[0]),args[1]);break;
   case 'delete':if(args[1]!=='--confirm-generation')throw Error('Requiere --confirm-generation <n>.');result=deleteArchivedGeneration(db,Number(args[0]),Number(args[2]));break;
   case 'compact':result=compactReceipts(db);break;
   case 'vacuum':db.exec('PRAGMA wal_checkpoint(TRUNCATE);VACUUM;PRAGMA wal_checkpoint(TRUNCATE)');result=storageUsage(db,path);break;
   default:throw Error('Acción administrativa desconocida.');
  }
  console.log(JSON.stringify(result,null,2));
 }finally{release();db.close();}
 }
}catch(e){console.error((e as Error).message);process.exitCode=1;}
