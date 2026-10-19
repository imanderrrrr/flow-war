import type { DatabaseSync } from 'node:sqlite';
import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { GameState, Identity, HistoricalClosure } from '../shared/types.js';
import type { Observation, JournalCommand, HistoricalPoint } from '../shared/observability.js';
import { buffer, clearBuffer, checkpoint, quietHistory, observe } from './observability.js';
import { recoverGame, serializeGame } from './persistence.js';
import { applyCommand, step } from './engine.js';
export function historySchema(db: DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS history_games (generation INTEGER PRIMARY KEY, start REAL, tick REAL, duration REAL, status TEXT, version TEXT);
 CREATE TABLE IF NOT EXISTS history_events (generation INTEGER, seq INTEGER, at REAL, companyId INTEGER, kind TEXT, body TEXT, PRIMARY KEY(generation,seq));
 CREATE INDEX IF NOT EXISTS history_events_time ON history_events(generation,at,companyId);
 CREATE TABLE IF NOT EXISTS history_inputs (generation INTEGER, seq INTEGER, at REAL, body TEXT, PRIMARY KEY(generation,seq));
 CREATE TABLE IF NOT EXISTS history_checkpoints (generation INTEGER, seq INTEGER, at REAL, state BLOB, digest TEXT, PRIMARY KEY(generation,seq));
 CREATE INDEX IF NOT EXISTS history_checkpoint_time ON history_checkpoints(generation,at);
 CREATE TABLE IF NOT EXISTS slack_messages (generation INTEGER, id TEXT, seq INTEGER, companyId INTEGER, channel TEXT, body TEXT, PRIMARY KEY(generation,id));
 CREATE INDEX IF NOT EXISTS slack_tenant ON slack_messages(generation,companyId,channel,seq);
 CREATE TABLE IF NOT EXISTS history_points (generation INTEGER, at REAL, body TEXT, PRIMARY KEY(generation,at));`);
 const columns = db.prepare('PRAGMA table_info(history_games)').all() as {name:string}[];
 if (!columns.some(c=>c.name==='closure')) db.exec('ALTER TABLE history_games ADD COLUMN closure TEXT');
}
export function writeHistory(db: DatabaseSync, g: GameState) {
 const meta = db.prepare('SELECT generation FROM history_games WHERE generation=?').get(g.generation);
 if (!meta && !buffer(g).checkpoints.length) checkpoint(g,serializeGame,true);
 db.prepare('INSERT INTO history_games (generation,start,tick,duration,status,version,closure) VALUES (?,?,?,?,?,?,?) ON CONFLICT(generation) DO UPDATE SET tick=excluded.tick,status=excluded.status,closure=excluded.closure').run(g.generation,g.observability.startTick,g.tick,g.duration,g.status,g.observability.version,g.closure?JSON.stringify(g.closure):null);
 const p=buffer(g);
 const event=db.prepare('INSERT OR IGNORE INTO history_events VALUES (?,?,?,?,?,?)');
 for(const e of p.events) { event.run(g.generation,e.id,e.at,e.companyId,e.kind,JSON.stringify(e)); if(e.kind==='slack.message'){const m=e.data.message as import('../shared/observability.js').SlackMessage;db.prepare('INSERT OR IGNORE INTO slack_messages VALUES (?,?,?,?,?,?)').run(g.generation,m.id,m.sequence,m.companyId,m.channel,JSON.stringify(m));} }
 const input=db.prepare('INSERT OR IGNORE INTO history_inputs VALUES (?,?,?,?)');
 for(const i of p.commands) input.run(g.generation,i.id,i.at,JSON.stringify(i));
 const point=db.prepare('INSERT OR REPLACE INTO history_points VALUES (?,?,?)');
 for(const s of p.points) point.run(g.generation,s.at,JSON.stringify(s));
 const cp=db.prepare('INSERT OR IGNORE INTO history_checkpoints VALUES (?,?,?,?,?)');
 for(const c of p.checkpoints) cp.run(g.generation,c.sequence,c.at,deflateSync(c.state),createHash('sha256').update(c.state).digest('hex'));
}
export { clearBuffer as commitHistory };
export function historyAccess(db: DatabaseSync, generation: number, identity: Identity | null) {
 const meta=db.prepare('SELECT * FROM history_games WHERE generation=?').get(generation) as {generation:number;start:number;tick:number;duration:number;status:string;version:string}|undefined;
 if(!identity || !meta || !['FINISHED','ABORTED'].includes(meta.status)) throw new Error('El DVR requiere una partida cerrada y una sesión autorizada.');
 return meta;
}
export function historyEvents(db: DatabaseSync, generation: number, companyId: number | null, before = Number.MAX_SAFE_INTEGER, limit = 100): Observation[] {
 return (db.prepare('SELECT body FROM history_events WHERE generation=? AND seq<? AND (? IS NULL OR companyId=? OR companyId IS NULL) ORDER BY seq DESC LIMIT ?').all(generation,before,companyId,companyId,limit) as {body:string}[]).map(r=>JSON.parse(r.body));
}
export function reconstruct(db: DatabaseSync, generation: number, at: number): GameState {
 const meta=db.prepare('SELECT start,tick,version FROM history_games WHERE generation=?').get(generation) as {start:number;tick:number;version:string}|undefined;
 if(!meta || !Number.isFinite(at) || at<meta.start || at>meta.tick || meta.version!=='flow-observability-5.1') throw new Error('Intervalo sin evidencia reconstruible con esta versión del motor.');
 at=Math.floor((at+1e-7)*10)/10;
 const row=db.prepare('SELECT seq,at,state,digest FROM history_checkpoints WHERE generation=? AND at<=? ORDER BY at DESC,seq DESC LIMIT 1').get(generation,at) as {seq:number;at:number;state:Uint8Array;digest:string}|undefined;
 if(!row) throw new Error('No hay checkpoint para este intervalo.');
 const raw=inflateSync(row.state).toString();
 if(createHash('sha256').update(raw).digest('hex')!==row.digest) throw new Error('Checkpoint corrupto.');
 const g=recoverGame(raw); g.status=JSON.parse(raw).status; quietHistory(g);
 const inputs=(db.prepare('SELECT body FROM history_inputs WHERE generation=? AND seq>? AND at<=? ORDER BY seq').all(generation,row.seq,at) as {body:string}[]).map(r=>JSON.parse(r.body) as JournalCommand);
 const advance=(target:number)=>{ while(g.tick+1e-7<target){if(g.status!=='RUNNING')throw new Error('Falta una transición de reloj; intervalo no reconstruible.');step(g);} };
 for(const input of inputs){advance(input.at);applyCommand(g,input.identity,input.command,{receivedAt:input.receivedAt});}
 advance(at); return g;
}
export function historyPoints(db: DatabaseSync, generation:number):HistoricalPoint[]{return(db.prepare('SELECT body FROM history_points WHERE generation=? ORDER BY at').all(generation)as{body:string}[]).map(r=>JSON.parse(r.body));}

/** Recover only durable, reconstructible orphan generations left by the old reset path. */
export function sealLegacyGenerations(db: DatabaseSync, current: number) {
 const rows=db.prepare("SELECT generation FROM history_games WHERE generation!=? AND status NOT IN ('FINISHED','ABORTED')").all(current) as {generation:number}[];
 for (const row of rows) {
  const meta=db.prepare('SELECT tick FROM history_games WHERE generation=?').get(row.generation) as {tick:number};
  const g=reconstruct(db,row.generation,meta.tick);
  // reconstruct is intentionally silent; rebuild a writable state without advancing its clock.
  const closed=recoverGame(serializeGame(g));
  closed.closure={generation:closed.generation,tick:closed.tick,previousStatus:g.status,reason:'LEGACY_UNCLOSED',actor:null,receivedAt:null};
  closed.status='ABORTED'; observe(closed,'generation.interrupted',null,{...closed.closure}); checkpoint(closed,serializeGame,true);
  db.exec('BEGIN IMMEDIATE'); try {writeHistory(db,closed);db.exec('COMMIT');clearBuffer(closed);}catch(e){db.exec('ROLLBACK');throw e;}
 }
}
