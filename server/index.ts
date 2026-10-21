import { auditCompletion } from './discipline.js';
import { AiGateway, AiError, AnthropicProvider, parseAiInput } from './claude.js';
import { prepareAi, commitAi, visibleProposal, proposalText, beginAiAttempt, finishAiAttempt } from './ai-service.js';
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
import { stateUpdateParser } from './socket-encoder.js';
import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Server } from 'socket.io';
import { ROLES, type Identity, type GameState, type Command, type Snapshot } from '../shared/types.js';
import { applyCommand, createGame, project, step } from './engine.js';
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
const persist = (command?: {identity: string; id: string; digest: string; result: string}) => writeGame(game, command);
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
  aiPending.add(key);const generation=game.generation;
  try {
    const input=parseAiInput(req.body);
    const initial=structuredClone(game);copyHistoryBuffer(game,initial);
    try{beginAiAttempt(game,identity,input);persist();}catch(e){game=initial;bindObservability(game,f=>slackFact(game,f));throw e;}
    const proposal=await prepareAi(game,identity,req.body,aiGateway);
    const current=session(req.headers.cookie);
    if(!current||current.id!==identity.id||game.generation!==generation)throw new AiError('FORBIDDEN','La sesión o la partida cambió.');
    const before=structuredClone(game);copyHistoryBuffer(game,before);
    try {
      const stored=commitAi(game,current,req.body,proposal);
      finishAiAttempt(game,identity,stored.id,'COMPLETED');
      auditCompletion(game,identity.companyId!,'ai.prepared',[stored.id],[`provider:${stored.provider}`,`kind:${stored.kind}`]);
      checkpoint(game,serializeGame,true);persist();scheduleBroadcast();res.json({ok:true,proposal:{...visibleProposal(stored),message:proposalText(game,identity,stored)}});
    }catch(e){game=before;bindObservability(game,f=>slackFact(game,f));throw e;}
  }catch(e){const code=e instanceof AiError?e.code:'AI_INVALID';
    if(game.generation===generation){
      const before=structuredClone(game);copyHistoryBuffer(game,before);
      try{finishAiAttempt(game,identity,String(req.body?.id),['CANCELLED','TIMEOUT'].includes(code)?code:'FAILED',code);auditCompletion(game,identity.companyId!,'ai.failed',[],[code]);checkpoint(game,serializeGame,true);persist();}catch{game=before;bindObservability(game,f=>slackFact(game,f));}
    }
    res.status(code==='FORBIDDEN'?403:code==='AI_RATE_LIMIT'||code==='AI_BUSY'?429:503).json({ok:false,code,error:e instanceof AiError?e.message:'No se pudo preparar la propuesta.'});}
  finally{aiPending.delete(key);}
});
app.get('/api/ai/status',(req,res)=>{
 res.setHeader('Cache-Control','no-store');const identity=session(req.headers.cookie);if(!identity)return res.sendStatus(403);
 if(identity.role==='operator')return res.json({provider:aiGateway.provider instanceof AnthropicProvider?aiGateway.provider.status():{state:'TEST_PROVIDER'},usage:aiGateway.provider instanceof AnthropicProvider?aiGateway.provider.metrics():[],scheduler:aiGateway.scheduler.metrics()});
 const attempts=game.companies[identity.companyId!].runtime.aiAttempts?.filter(a=>a.actor===identity.id&&a.role===identity.role&&a.generation===game.generation)??[];
 res.json({requests:attempts.map(a=>{const live=aiGateway.scheduler.status(identity.id,a.id)[0];return {...a,...live,state:['QUEUED','RUNNING'].includes(a.state)?live?.state??a.state:a.state,code:a.code??live?.code};})});
});
app.post('/api/ai/cancel',(req,res)=>{const identity=session(req.headers.cookie);if(!identity)return res.sendStatus(403);try{const input=req.body;if(typeof input?.id!=='string'||input.id.length>100)return res.sendStatus(400);res.json({ok:aiGateway.scheduler.cancel(identity.id,input.id)});}catch{res.sendStatus(400);}});
let diagnosticPending=false;
app.post('/api/ai/diagnose',async(req,res)=>{
 res.setHeader('Cache-Control','no-store');if(session(req.headers.cookie)?.role!=='operator')return res.sendStatus(403);
 if(diagnosticPending)return res.status(429).json({ok:false,code:'AI_BUSY'});diagnosticPending=true;
 try{await aiGateway.generate('operator-diagnostic',{id:crypto.randomUUID(),kind:'security.propose',text:'Devuelve un texto breve: diagnóstico de conexión, sin sugerir protecciones.'},game.companies[0].backend,0);res.json({ok:true,status:(aiGateway.provider as AnthropicProvider).status()});}
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
    const digest = hash(JSON.stringify(command));
    const prior = db.prepare('SELECT digest,result FROM commands WHERE identity=? AND id=?').get(identity.id, command.id) as { digest: string; result: string } | undefined;
    if (prior) return ack(prior.digest === digest ? JSON.parse(prior.result) : { ok: false, error: 'ID de comando ya utilizado.' });
    const before = structuredClone(game); copyHistoryBuffer(game,before);
    const result = applyCommand(game, identity, command);
    try {
      persist({ identity: identity.id, id: command.id, digest, result: JSON.stringify(result) });
      if(result.ok&&['room.reset','room.finish'].includes(command.type))for(const task of aiGateway.scheduler.metrics().recent)if(['QUEUED','RUNNING'].includes(task.state))aiGateway.scheduler.cancel(task.actor,task.id);
      ack(result); scheduleBroadcast();
    } catch { game = before; bindObservability(game,f=>slackFact(game,f)); ack({ ok: false, error: 'No se pudo confirmar el comando.' }); }
  });
});
let pendingBroadcast: ReturnType<typeof setImmediate> | undefined;
// Commands remain individually durable. Notifications can share the latest
// committed state within one event-loop turn; every forensic input is retained.
function scheduleBroadcast() {
  pendingBroadcast ??= setImmediate(() => { pendingBroadcast = undefined; broadcast(); });
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
    for (let i = 0; i < game.speed; i++) step(game);
    if (++iterations % 2 === 0) broadcast();
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
async function shutdown() { clearInterval(timer); if (pendingBroadcast) clearImmediate(pendingBroadcast); persist(); await dvr.close(); io.close(); http.close(); releaseStorage(); db.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
