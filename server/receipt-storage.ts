import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
import type {TrafficReceipt} from '../shared/types.js';
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
const HOT=['id','companyId','type','trafficClass','arrivalAt','finishedAt','status','accounted','result','waits'] as const;
export function receiptSchema(db:DatabaseSync){
 db.exec('CREATE TABLE IF NOT EXISTS receipt_paths(generation INTEGER NOT NULL,digest TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(generation,digest))');
 for(const table of ['request_receipts','commands']){const columns=db.prepare(`PRAGMA table_info(${table})`).all()as{name:string}[];if(!columns.some(c=>c.name==='generation'))db.exec(`ALTER TABLE ${table} ADD COLUMN generation INTEGER`);}
 const columns=db.prepare('PRAGMA table_info(request_receipts)').all()as{name:string}[];
 if(!columns.some(c=>c.name==='details'))db.exec('ALTER TABLE request_receipts ADD COLUMN details BLOB');
 if(!columns.some(c=>c.name==='detailDigest'))db.exec('ALTER TABLE request_receipts ADD COLUMN detailDigest TEXT');
 db.exec('CREATE INDEX IF NOT EXISTS receipts_generation ON request_receipts(generation);CREATE INDEX IF NOT EXISTS commands_generation ON commands(generation)');
}
type PreparedReceipt={rawPath:string;pathDigest:string;receipt:string;details:Buffer|null;detailDigest:string|null};
const prepared=new WeakMap<TrafficReceipt,PreparedReceipt>();
const pathStatements=new WeakMap<DatabaseSync,ReturnType<DatabaseSync['prepare']>>();
function freezeEvidence(value:unknown){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freezeEvidence(child);Object.freeze(value);}}
/** Distribute codec work over actual settlements, without adding state to the simulation. */
export function prepareReceipt(receipt:TrafficReceipt):PreparedReceipt{
 const cached=prepared.get(receipt);if(cached)return cached;
 const {path,...rest}=receipt,rawPath=JSON.stringify(path),pathDigest=hash(rawPath),hot:Record<string,any>={},details:Record<string,any>={...rest};
 for(const key of HOT){if(key in rest)hot[key]=rest[key];delete details[key];}
 const raw=JSON.stringify(details);
 const packed:PreparedReceipt=Buffer.byteLength(raw)>4*1024*1024
  ?{rawPath,pathDigest,receipt:JSON.stringify({...rest,pathRef:pathDigest}),details:null,detailDigest:null}
  :{rawPath,pathDigest,receipt:JSON.stringify({...hot,pathRef:pathDigest,encoding:'receipt-zlib-1'}),details:deflateSync(raw),detailDigest:hash(raw)};
 // A receipt is a frozen evidence copy; the request itself remains mutable and independent.
 freezeEvidence(receipt);prepared.set(receipt,packed);return packed;
}
export function encodeReceipt(db:DatabaseSync,generation:number,receipt:TrafficReceipt){
 const packed=prepareReceipt(receipt);
 let statement=pathStatements.get(db);if(!statement){statement=db.prepare('INSERT OR IGNORE INTO receipt_paths VALUES (?,?,?)');pathStatements.set(db,statement);}
 // Always execute inside the caller's transaction, including after rollback; no durable-write cache.
 statement.run(generation,packed.pathDigest,packed.rawPath);
 return {receipt:packed.receipt,details:packed.details,detailDigest:packed.detailDigest};
}
export type StoredReceipt={receipt:string;generation:number|null;details?:Uint8Array|null;detailDigest?:string|null};
export function decodeReceipt(db:DatabaseSync,row:StoredReceipt):TrafficReceipt{
 const value=JSON.parse(row.receipt);if(!value.pathRef)return value;
 const path=db.prepare('SELECT path FROM receipt_paths WHERE generation=? AND digest=?').get(row.generation,value.pathRef)as{path:string}|undefined;
 if(!path||hash(path.path)!==value.pathRef)throw Error('Ruta histórica ausente o corrupta.');
 const {pathRef,encoding,...hot}=value;
 if(encoding===undefined)return{...hot,path:JSON.parse(path.path)};
 if(encoding!=='receipt-zlib-1'||!row.details)throw Error('Formato de recibo no soportado o evidencia incompleta.');
 const raw=inflateSync(row.details,{maxOutputLength:4*1024*1024}).toString();if(hash(raw)!==row.detailDigest)throw Error('Recibo histórico corrupto.');
 return{...hot,...JSON.parse(raw),path:JSON.parse(path.path)};
}
/** Offline migration uses exact durable references, never ID patterns. Unknown legacy rows stay intact. */
export function compactReceipts(db:DatabaseSync){
 db.exec('BEGIN IMMEDIATE');let linked=0,compacted=0;
 try{
  db.exec("CREATE INDEX IF NOT EXISTS history_request_id ON history_events(json_extract(body,'$.data.requestId'),generation) WHERE kind='request.settled'");
  const rows=db.prepare('SELECT * FROM request_receipts').iterate() as Iterable<StoredReceipt&{id:string}>;
  const lookup=db.prepare("SELECT min(generation) AS generation FROM history_events WHERE kind='request.settled' AND json_extract(body,'$.data.requestId')=? HAVING count(DISTINCT generation)=1");
  const update=db.prepare('UPDATE request_receipts SET generation=?,receipt=?,details=?,detailDigest=? WHERE id=?');
  for(const row of rows){let generation=row.generation;if(generation===null){const found=lookup.get(row.id)as{generation:number}|undefined;if(!found)continue;generation=found.generation;linked++;}const value=JSON.parse(row.receipt);if(!value.encoding){const encoded=encodeReceipt(db,generation,decodeReceipt(db,{...row,generation}));update.run(generation,encoded.receipt,encoded.details,encoded.detailDigest,row.id);compacted++;}else if(row.generation===null)db.prepare('UPDATE request_receipts SET generation=? WHERE id=?').run(generation,row.id);}
  db.exec('COMMIT');return{linked,compacted};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
