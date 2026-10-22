import { auditCompletion } from './discipline.js';
import { AiGateway, AiError, AnthropicProvider, parseAiInput } from './claude.js';
import { prepareAi, commitAi, visibleProposal, proposalText, beginAiAttempt, finishAiAttempt } from './ai-service.js';
import { parseExecutorInput, beginExecution, interpret as interpretInstruction, executeCalls, finishExecution, replyFor } from './executor-service.js';
import type { ExecutorInput } from '../shared/executor.js';
import { slackFact } from './flowslack.js';
import { SnapshotSync } from './snapshot-sync.js';
import { compactCompanies } from '../shared/snapshot-codec.js';
import { acquireStorageLease } from './storage-lease.js';
import { decodeReceipt } from './receipt-storage.js';
import { visibleRequest } from './projections.js';
import { sealLegacyGenerations } from './history.js';
import { installDvr } from './dvr.js';
import { CHANNELS } from '../shared/observability.js';
import { bindObservability, checkpoint, observe, copyHistoryBuffer } from './observability.js';
import { serializeGame } from './persistence.js';
import { createGameWriter } from './storage.js';
import { createCommandPipeline } from './command-pipeline.js';
import { stateUpdateParser } from './socket-encoder.js';
import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Server } from 'socket.io';
import { ROLES, type Identity, type GameState, type Command, type Snapshot } from '../shared/types.js';
import { createGame, project, step } from './engine.js';
import { recoverGame } from './persistence.js';
import { trafficReceipt } from './traffic.js';

const directory = resolve(process.env.FLOW_DATA_DIR ?? '.local');
mkdirSync(directory, { recursive: true, mode: 0o700 });
// Admission precedes every storage mutation, including first-run credentials.
const db = new DatabaseSync(resolve(directory, 'game.sqlite'));
const releaseStorage = acquireStorageLease(db);
const accessFile = resolve(directory, 'access.json');
type Credential = { code: string; identity: Identity; label: string };
let credentials: Credential[];
if (existsSync(accessFile)) credentials = JSON.parse(readFileSync(accessFile, 'utf8')).credentials;
else {
  credentials = [{ code: randomBytes(12).toString('base64url'), identity: { id: 'operator', role: 'operator', companyId: null }, label: 'Docente' }];
  for (let companyId = 0; companyId < 5; companyId++) for (const role of ROLES) credentials.push({ code: randomBytes(12).toString('base64url'), identity: { id: `${companyId}-${role}`, role, companyId }, label: `${['NOVA', 'VERTEX', 'BYTE', 'EMBER', 'ORBIT'][companyId]} / ${role}` });
  writeFileSync(accessFile, JSON.stringify({ room: 'FW-001', credentials }, null, 2), { mode: 0o600 });
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const identities = new Map(credentials.map(c => [hash(c.code), c.identity]));
db.exec('PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS game (id INTEGER PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS commands (identity TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(identity,id)); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, identity TEXT NOT NULL, expires INTEGER NOT NULL);');
const saved = db.prepare('SELECT state FROM game WHERE id=1').get() as { state: string } | undefined;
// Keep the original legacy snapshot before the first upgraded snapshot is written.
if (saved && [1, 2, 3, 4, 5].includes(JSON.parse(saved.state).schema)) {
  db.exec('CREATE TABLE IF NOT EXISTS game_migrations (schema INTEGER PRIMARY KEY, state TEXT NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO game_migrations (schema,state) VALUES (?,?)').run(JSON.parse(saved.state).schema, saved.state);
}
let game: GameState = saved ? recoverGame(saved.state) : createGame(1500, 7357, 0, false);
if (saved) { observe(game,'server.recovered',null,{status:game.status}); checkpoint(game,serializeGame,true); }
const writeGame = createGameWriter(db);
sealLegacyGenerations(db, game.generation);
const persist = () => writeGame(game);
persist();
const sessionLookup = db.prepare('SELECT identity,expires FROM sessions WHERE token=?');
function session(cookie?: string, includeExpelled = false): Identity | null {
  const match = cookie?.match(/(?:^|;\s*)fw_session=([^;]+)/);
  if (!match) return null;
  const value = sessionLookup.get(hash(match[1])) as { identity: string; expires: number } | undefined;
  if (!value || value.expires < Date.now()) return null;
  const identity = JSON.parse(value.identity) as Identity;
  return !includeExpelled && game.actions.employees[identity.id]?.status === 'EXPELLED' ? null : identity;
}
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { if (/\.local|access\.json|\.sqlite/i.test(req.path)) return res.sendStatus(404); next(); });
app.use(express.json({ limit: '80kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Origen no autorizado.' });
  next();
});
const attempts = new Map<string, { at: number; count: number; failed: number }>();
app.post('/api/login', (req, res) => {
  const ip = req.ip ?? 'local', now = Date.now();
  let bucket = attempts.get(ip); if (!bucket || now - bucket.at > 60000) { bucket = { at: now, count: 0, failed: 0 }; attempts.set(ip, bucket); }
  if (++bucket.count > 60 || bucket.failed >= 30) return res.status(429).json({ error: 'Límite de intentos alcanzado. Espera un minuto.' });
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  const identity = code.length < 100 ? identities.get(hash(code)) : undefined;
  if (identity && game.actions.employees[identity.id]?.status === 'EXPELLED') return res.status(403).json({ error: 'Empleado expulsado. Puesto vacante.' });
  if (!identity) { bucket.failed++; return res.status(401).json({ error: 'Credencial no válida.' }); }
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token,identity,expires) VALUES (?,?,?)').run(hash(token), JSON.stringify(identity), now + 12 * 60 * 60 * 1000);
  res.setHeader('Set-Cookie', `fw_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
  res.json({ identity });
});
app.post('/api/logout', (req, res) => {
  const identity=session(req.headers.cookie);if(identity)for(const task of aiGateway.scheduler.status(identity.id))if(['QUEUED','RUNNING'].includes(task.state))aiGateway.scheduler.cancel(identity.id,task.id);
  const token = req.headers.cookie?.match(/(?:^|;\s*)fw_session=([^;]+)/)?.[1];
  if (token) { db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
    for (const socket of io.sockets.sockets.values()) if (socket.request.headers.cookie?.match(/(?:^|;\s*)fw_session=([^;]+)/)?.[1] === token) socket.disconnect(true);
  }
  res.setHeader('Set-Cookie', 'fw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({ ok: true });
});
const aiGateway = new AiGateway();
const aiPending = new Set<string>();
const aiAttempts = new Map<string,{at:number;count:number}>();
app.post('/api/ai', async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  const identity=session(req.headers.cookie);
  if(!identity)return res.status(403).json({ok:false,code:'FORBIDDEN',error:'Sesión no autorizada.'});
  const key=identity.id,now=Date.now();let budget=aiAttempts.get(key);
  if(!budget||now-budget.at>=60000){budget={at:now,count:0};aiAttempts.set(key,budget);}
  if(++budget.count>8)return res.status(429).json({ok:false,code:'AI_RATE_LIMIT',error:'Límite de solicitudes de Claude alcanzado.'});
  if(aiPending.has(key))return res.status(429).json({ok:false,code:'AI_BUSY',error:'Hay una solicitud en curso.'});
  aiPending.add(key);flushCommands();const generation=game.generation;
  try {
    const input=parseAiInput(req.body);
    const initial=structuredClone(game);copyHistoryBuffer(game,initial);
    try{beginAiAttempt(game,identity,input);persist();}catch(e){game=initial;bindObservability(game,f=>slackFact(game,f));throw e;}
    const proposal=await prepareAi(game,identity,req.body,aiGateway);
    flushCommands();const current=session(req.headers.cookie);
    if(!current||current.id!==identity.id||game.generation!==generation)throw new AiError('FORBIDDEN','La sesión o la partida cambió.');
    const before=structuredClone(game);copyHistoryBuffer(game,before);
    try {
      const stored=commitAi(game,current,req.body,proposal);
      finishAiAttempt(game,identity,stored.id,'COMPLETED');
      auditCompletion(game,identity.companyId!,'ai.prepared',[stored.id],[`provider:${stored.provider}`,`kind:${stored.kind}`]);
      checkpoint(game,serializeGame,true);persist();scheduleBroadcast();res.json({ok:true,proposal:{...visibleProposal(stored),message:proposalText(game,identity,stored)}});
    }catch(e){game=before;bindObservability(game,f=>slackFact(game,f));throw e;}
  }catch(e){const code=e instanceof AiError?e.code:'AI_INVALID';
    flushCommands();if(game.generation===generation){
      const before=structuredClone(game);copyHistoryBuffer(game,before);
      try{finishAiAttempt(game,identity,String(req.body?.id),['CANCELLED','TIMEOUT'].includes(code)?code:'FAILED',code);auditCompletion(game,identity.companyId!,'ai.failed',[],[code]);checkpoint(game,serializeGame,true);persist();}catch{game=before;bindObservability(game,f=>slackFact(game,f));}
    }
    res.status(code==='FORBIDDEN'?403:code==='AI_RATE_LIMIT'||code==='AI_BUSY'?429:503).json({ok:false,code,error:e instanceof AiError?e.message:'No se pudo preparar la propuesta.'});}
  finally{aiPending.delete(key);}
});
/** Restores the pre-mutation image when a journal write cannot be confirmed. */
function journal(mutate:()=>void){flushCommands();const before=structuredClone(game);copyHistoryBuffer(game,before);try{mutate();persist();scheduleBroadcast();return true;}catch{game=before;bindObservability(game,f=>slackFact(game,f));return false;}}
/** Every executed operation enters the same durable pipeline as the UI: validation, idempotency, COMMIT, ACK. */
function submitCommand(identity:Identity,command:Command){return new Promise<import('../shared/types.js').Result>(resolve=>commands.receive(identity,command,result=>resolve(result as import('../shared/types.js').Result)));}
const STATUS_CODES:Record<string,number>={FORBIDDEN:403,AI_RATE_LIMIT:429,AI_BUSY:429,AI_QUEUE_FULL:429,AI_BUDGET:429,ID_CONFLICT:409,INVALID:400,ROOM_PAUSED:409,AI_LIMIT:409,CONTEXT_LIMIT:413,PRODUCT_DISABLED:403};
app.post('/api/ai/execute',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const identity=session(req.headers.cookie);
  if(!identity||identity.role==='operator'||identity.companyId===null)return res.status(403).json({ok:false,code:'FORBIDDEN',error:'Sesión no autorizada.'});
  const key=identity.id,now=Date.now();let budget=aiAttempts.get(key);
  if(!budget||now-budget.at>=60000){budget={at:now,count:0};aiAttempts.set(key,budget);}
  if(++budget.count>8)return res.status(429).json({ok:false,code:'AI_RATE_LIMIT',error:'Límite de solicitudes de Claude alcanzado.'});
  if(aiPending.has(key))return res.status(429).json({ok:false,code:'AI_BUSY',error:'Hay una solicitud en curso.'});
  aiPending.add(key);flushCommands();const generation=game.generation;let input:ExecutorInput|undefined,begun=false,interpreted:import('./claude.js').InterpretResult|undefined;
  const provider=aiGateway.provider.name,model=aiGateway.provider.model;
  try{
    input=parseExecutorInput(req.body);const parsed=input;
    let replay=false,error:unknown;
    if(!journal(()=>{try{replay=beginExecution(game,identity,parsed).replay;}catch(e){error=e;throw e;}}))throw error instanceof Error?error:new AiError('AI_INVALID');
    begun=!replay;
    if(replay){const prior=game.companies[identity.companyId].runtime.aiAttempts?.find(a=>a.actor===identity.id&&a.id===parsed.id&&a.generation===game.generation);
      if(prior?.reply)return res.json({ok:true,reply:{id:parsed.id,...prior.reply,operations:[],provider,model}});
      if(prior&&['QUEUED','RUNNING'].includes(prior.state))return res.status(409).json({ok:false,code:'AI_IN_PROGRESS',error:'La solicitud con ese ID sigue en curso.'});}
    const {result,snapshot}=await interpretInstruction(aiGateway,game,identity,parsed);interpreted=result;
    flushCommands();const current=session(req.headers.cookie);
    if(!current||current.id!==identity.id||game.generation!==generation)throw new AiError('FORBIDDEN','La sesión o la partida cambió.');
    // Each operation is submitted only while the same session is still valid; logout or expiry stops the rest.
    const executed=await executeCalls(()=>{const live=session(req.headers.cookie);if(!live||live.id!==identity.id||game.generation!==generation)throw new Error('FORBIDDEN');return {g:game,actor:live};},parsed,result.calls,snapshot,async command=>{const live=session(req.headers.cookie);if(!live||live.id!==identity.id||game.generation!==generation)return {ok:false,code:'FORBIDDEN',error:'La sesión o la partida cambió.'};return submitCommand(live,command);});
    const reply=replyFor(parsed,executed,provider,result.model);
    const record=()=>{finishExecution(game,current,parsed,reply,'COMPLETED',undefined,result);auditCompletion(game,current.companyId!,'ai.executed',reply.refs,[`provider:${provider}`,`state:${reply.state}`,`tools:${result.calls.map(c=>c.name).join(',')||'none'}`]);};
    if(!journal(record)&&!journal(record))console.error('No se pudo registrar el resultado de una orden de Claude.');
    res.json({ok:true,reply});
  }catch(e){const code=e instanceof AiError?e.code:e instanceof Error&&e.message==='FORBIDDEN'?'FORBIDDEN':'AI_INVALID';
    const message=e instanceof AiError?e.message:code==='FORBIDDEN'?'Operación no autorizada.':'No se pudo procesar la instrucción.';
    flushCommands();
    if(input&&begun&&game.generation===generation){const parsed=input;const usage=interpreted??(e instanceof AiError&&e.usage?{calls:[],usage:e.usage,model:aiGateway.provider.model,stopReason:code,fallback:false}:undefined);journal(()=>{finishExecution(game,identity,parsed,{state:'TECHNICAL_ERROR',message:`${message} No se ejecutó nada.`,refs:[]},['CANCELLED','TIMEOUT'].includes(code)?code:'FAILED',code,usage);auditCompletion(game,identity.companyId!,'ai.failed',[],[code]);});}
    res.status(STATUS_CODES[code]??503).json({ok:false,code,error:message});}
  finally{aiPending.delete(key);}
});
app.get('/api/ai/status',(req,res)=>{
 res.setHeader('Cache-Control','no-store');const identity=session(req.headers.cookie);if(!identity)return res.sendStatus(403);
 if(identity.role==='operator')return res.json({provider:aiGateway.provider instanceof AnthropicProvider?aiGateway.provider.status():{state:'TEST_PROVIDER'},usage:aiGateway.provider instanceof AnthropicProvider?aiGateway.provider.metrics():[],scheduler:aiGateway.scheduler.metrics(),consumption:{companies:game.companies.map(c=>({companyId:c.id,...(c.runtime.aiUsage??{requests:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0})})),gameTokenLimit:aiGateway.gameTokenLimit,companyTokenLimit:aiGateway.companyTokenLimit}});
 const attempts=game.companies[identity.companyId!].runtime.aiAttempts?.filter(a=>a.actor===identity.id&&a.role===identity.role&&a.generation===game.generation)??[];
 res.json({requests:attempts.map(a=>{const live=aiGateway.scheduler.status(identity.id,a.id)[0];return {...a,...live,state:['QUEUED','RUNNING'].includes(a.state)?live?.state??a.state:a.state,code:a.code??live?.code};})});
});
app.post('/api/ai/cancel',(req,res)=>{const identity=session(req.headers.cookie);if(!identity)return res.sendStatus(403);try{const input=req.body;if(typeof input?.id!=='string'||input.id.length>100)return res.sendStatus(400);res.json({ok:aiGateway.scheduler.cancel(identity.id,input.id)});}catch{res.sendStatus(400);}});
let diagnosticPending=false;
app.post('/api/ai/diagnose',async(req,res)=>{
 res.setHeader('Cache-Control','no-store');if(session(req.headers.cookie)?.role!=='operator')return res.sendStatus(403);
 if(diagnosticPending)return res.status(429).json({ok:false,code:'AI_BUSY'});diagnosticPending=true;
 try{const result=await aiGateway.interpret('operator-diagnostic',0,{id:crypto.randomUUID(),system:'Diagnóstico de conexión de FLOW WAR. Llamá la herramienta confirmar_conexion. No escribas texto.',tools:[{name:'confirmar_conexion',description:'Confirma que la conexión funciona.',input_schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},strict:true}],content:'Confirmá la conexión.'},{usedByGame:0,usedByCompany:0});res.json({ok:result.calls.some(c=>c.name==='confirmar_conexion'),toolCalling:result.calls.length>0,status:(aiGateway.provider as AnthropicProvider).status()});}
 catch(e){res.status(503).json({ok:false,code:e instanceof AiError?e.code:'PROVIDER_ERROR',status:(aiGateway.provider as AnthropicProvider).status()});}finally{diagnosticPending=false;}
});
app.get('/api/health', (_req, res) => res.json({ ok: true, room: 'FW-001' }));
app.get('/api/snapshot', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(project(game, session(req.headers.cookie))); });
app.get('/api/qa/runs/:id',(req,res)=>{
 res.setHeader('Cache-Control','no-store');const identity=session(req.headers.cookie);if(!identity||identity.companyId===null)return res.sendStatus(403);
 const c=game.companies[identity.companyId],run=c.runtime.workflow?.runs.find(r=>r.id===req.params.id&&r.generation===game.generation),ch=run&&game.changes.find(ch=>ch.companyId===c.id&&ch.id===run.changeId);
 const report=ch?.reports.find(r=>r.testEvidence?.runId===run?.id);if(!run||!report)return res.sendStatus(404);res.json({run,report});
});
app.get('/api/ai/conversation/:id',(req,res)=>{
 res.setHeader('Cache-Control','no-store');const identity=session(req.headers.cookie);if(!identity||identity.companyId===null)return res.sendStatus(403);
 const thread=game.companies[identity.companyId].runtime.conversations?.find(t=>t.id===req.params.id&&t.actor===identity.id&&t.role===identity.role&&t.generation===game.generation);if(!thread)return res.sendStatus(404);
 const before=Number(req.query.before??thread.messages.length);if(!Number.isSafeInteger(before)||before<0||before>thread.messages.length)return res.sendStatus(400);const start=Math.max(0,before-40);res.json({messages:thread.messages.slice(start,before),nextBefore:start});
});
app.get('/api/requests/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const identity = session(req.headers.cookie);
  if (!identity) return res.sendStatus(403);
  for (const company of game.companies) {
    if (identity.role !== 'operator' && identity.companyId !== company.id) continue;
    const request = company.traffic.requests[req.params.id];
    if (request) return res.json(identity.role==='operator'?trafficReceipt(request,true):trafficReceipt(request));
  }
  const row = db.prepare('SELECT companyId,receipt,generation,details,detailDigest FROM request_receipts WHERE id=?').get(req.params.id) as {companyId: number; receipt: string; generation:number|null; details:Uint8Array|null; detailDigest:string|null} | undefined;
  if (!row || (identity.role !== 'operator' && identity.companyId !== row.companyId)) return res.sendStatus(404);
  try { const receipt=decodeReceipt(db,row);res.json(identity.role==='operator'?receipt:visibleRequest(receipt)); } catch { res.status(503).json({error:'Evidencia temporalmente no disponible.'}); }
});
app.get('/api/flowslack', (req,res)=>{
 res.setHeader('Cache-Control','no-store');const identity=session(req.headers.cookie);
 if(!identity||identity.companyId===null||(req.query.companyId!==undefined&&Number(req.query.companyId)!==identity.companyId))return res.sendStatus(403);
 const channel=String(req.query.channel??'general');if(!CHANNELS.includes(channel as any))return res.sendStatus(400);
 const before=Number(req.query.before??Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)return res.sendStatus(400);
 const rows=db.prepare('SELECT body FROM slack_messages WHERE generation=? AND companyId=? AND channel=? AND seq<? ORDER BY seq DESC LIMIT 80').all(game.generation,identity.companyId,channel,before) as {body:string}[];
 res.json({messages:rows.map(r=>JSON.parse(r.body)).reverse()});
});
const dvr = installDvr(app,db,req=>session(req.headers.cookie));
app.get('/api/access', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (session(req.headers.cookie)?.role !== 'operator') return res.status(403).json({ error: 'Acceso denegado.' });
  res.json({ credentials });
});
const http = createServer(app);
const io = new Server(http, { parser: stateUpdateParser, maxHttpBufferSize: 80000, perMessageDeflate: { threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true, concurrencyLimit: 4, zlibDeflateOptions: { level: 1 } }, allowRequest: (req, callback) => {
  try { callback(null, !req.headers.origin || new URL(req.headers.origin).host === req.headers.host); } catch { callback(null, false); }
} });
const synchronizers = new Map<string, SnapshotSync>();
// FLOW_GROUP_COMMIT=0 keeps the original route: one rollback image, transaction and ACK per command.
// FLOW_GROUP_COMMIT_MAX bounds a batch (1–1000, default 64); invalid values use the default.
const batchLimit = Number(process.env.FLOW_GROUP_COMMIT_MAX);
const commands = createCommandPipeline({
  db, hash, game: () => game, write: (state, rows) => writeGame(state, rows), broadcast: () => scheduleBroadcast(),
  restore: state => { game = state; bindObservability(game,f=>slackFact(game,f)); },
  committed: (command, result) => { if(result.ok&&['room.reset','room.finish'].includes(command.type))for(const task of aiGateway.scheduler.metrics().recent)if(['QUEUED','RUNNING'].includes(task.state))aiGateway.scheduler.cancel(task.actor,task.id); },
  groupCommit: process.env.FLOW_GROUP_COMMIT !== '0', maxBatch: Number.isInteger(batchLimit) && batchLimit >= 1 && batchLimit <= 1000 ? batchLimit : 64,
});
/** Applies commands received earlier in this event-loop turn; no-op on the per-command route. */
function flushCommands() { commands.flush(); }
io.on('connection', socket => {
  socket.data.authenticated = !!session(socket.request.headers.cookie);
  const sync = new SnapshotSync(socket); synchronizers.set(socket.id, sync);
  sync.send(() => project(game, session(socket.request.headers.cookie)));
  socket.on('disconnect', () => synchronizers.delete(socket.id));
  let resyncAt = 0;
  socket.on('state:resync', () => { if (Date.now()-resyncAt<250) return; resyncAt=Date.now(); sync.resync(); sync.send(() => project(game, session(socket.request.headers.cookie))); });
  let count = 0, at = Date.now();
  socket.on('command', (command: Command, ack: (result: unknown) => void) => {
    if (typeof ack !== 'function') return;
    if (Date.now() - at > 1000) { at = Date.now(); count = 0; }
    if (++count > 20) return ack({ ok: false, error: 'Límite de comandos alcanzado.' });
    if(command?.type==='agent.fixture')return ack({ok:false,code:'UNSUPPORTED',error:'Intérprete disponible únicamente en pruebas.'});
    const identity = session(socket.request.headers.cookie, true);
    if (!identity || !command || typeof command.id !== 'string' || command.id.length > 100 || typeof command.type !== 'string') return ack({ ok: false, code: 'FORBIDDEN', error: 'Sesión o comando no autorizado.' });
    commands.receive(identity, command, ack);
  });
});
let pendingBroadcast: ReturnType<typeof setImmediate> | undefined;
// Every ACK follows its COMMIT. Notifications can share the latest committed
// state within one event-loop turn; every forensic input is retained. Queued
// commands are applied first, so the broadcast never precedes their ACK.
function scheduleBroadcast() {
  pendingBroadcast ??= setImmediate(() => { flushCommands(); broadcast(); });
}
function broadcast() {
  if (pendingBroadcast) { clearImmediate(pendingBroadcast); pendingBroadcast = undefined; }
  const projections = new Map<string, ReturnType<typeof project>>();
  let publicProjection: ReturnType<typeof project> | undefined;
  let sharedPacked: Snapshot['companies'] | undefined;
  for (const socket of io.sockets.sockets.values()) {
    const identity = session(socket.request.headers.cookie);
    if (socket.data.authenticated && !identity) { socket.data.authenticated=false; socket.emit('state:clear'); synchronizers.get(socket.id)?.resync(); }
    if (identity) socket.data.authenticated = true;
    synchronizers.get(socket.id)?.send(() => {
    const key = JSON.stringify(identity);
    let value = projections.get(key); if (!value) { if (identity?.role === 'operator') value = project(game,identity);
      else { publicProjection ??= project(game,null); value = identity ? project(game,identity,publicProjection) : publicProjection; }
      projections.set(key,value); } return value;
  },Date.now(),identity?.role==='operator'?undefined:()=>{
    publicProjection ??= project(game,null);
    return sharedPacked ??= compactCompanies(publicProjection.companies);
  });
  }
}
let iterations = 0;
const timer = setInterval(() => {
  try {
    flushCommands();
    for (let i = 0; i < game.speed; i++) step(game);
    // Deferred to the check phase: commands that arrive meanwhile are answered before the broadcast.
    if (++iterations % 2 === 0) scheduleBroadcast();
    if (iterations % 10 === 0) persist();
  } catch (e) { game.status = 'PAUSED'; console.error('Simulación pausada por un error operativo:', e); }
}, 100);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server: http } }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.FLOW_PORT ?? 4173);
http.listen(port, '0.0.0.0', () => console.log(`FLOW WAR listo: http://localhost:${port}\nCredenciales locales: ${accessFile}`));
async function shutdown() { clearInterval(timer); if (pendingBroadcast) clearImmediate(pendingBroadcast); flushCommands(); persist(); await dvr.close(); io.close(); http.close(); releaseStorage(); db.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
