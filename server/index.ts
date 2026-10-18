import { createGameWriter } from './storage.js';
import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Server } from 'socket.io';
import { ROLES, type Identity, type GameState, type Command } from '../shared/types.js';
import { applyCommand, createGame, project, step } from './engine.js';
import { recoverGame } from './persistence.js';
import { trafficReceipt } from './traffic.js';

const directory = resolve(process.env.FLOW_DATA_DIR ?? '.local');
mkdirSync(directory, { recursive: true, mode: 0o700 });
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
const db = new DatabaseSync(resolve(directory, 'game.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS game (id INTEGER PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS commands (identity TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(identity,id)); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, identity TEXT NOT NULL, expires INTEGER NOT NULL);');
const saved = db.prepare('SELECT state FROM game WHERE id=1').get() as { state: string } | undefined;
// Keep the original legacy snapshot before the first upgraded snapshot is written.
if (saved && [1, 2].includes(JSON.parse(saved.state).schema)) {
  db.exec('CREATE TABLE IF NOT EXISTS game_migrations (schema INTEGER PRIMARY KEY, state TEXT NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO game_migrations (schema,state) VALUES (?,?)').run(JSON.parse(saved.state).schema, saved.state);
}
let game: GameState = saved ? recoverGame(saved.state) : createGame();
const writeGame = createGameWriter(db);
const persist = (command?: {identity: string; id: string; digest: string; result: string}) => writeGame(game, command);
persist();
const sessionLookup = db.prepare('SELECT identity,expires FROM sessions WHERE token=?');
function session(cookie?: string): Identity | null {
  const match = cookie?.match(/(?:^|;\s*)fw_session=([^;]+)/);
  if (!match) return null;
  const value = sessionLookup.get(hash(match[1])) as { identity: string; expires: number } | undefined;
  if (!value || value.expires < Date.now()) return null;
  return JSON.parse(value.identity);
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
const attempts = new Map<string, { at: number; count: number }>();
app.post('/api/login', (req, res) => {
  const ip = req.ip ?? 'local', now = Date.now();
  let bucket = attempts.get(ip); if (!bucket || now - bucket.at > 60000) { bucket = { at: now, count: 0 }; attempts.set(ip, bucket); }
  if (++bucket.count > 30) return res.status(429).json({ error: 'Límite de intentos alcanzado. Espera un minuto.' });
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  const identity = code.length < 100 ? identities.get(hash(code)) : undefined;
  if (!identity) return res.status(401).json({ error: 'Credencial no válida.' });
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token,identity,expires) VALUES (?,?,?)').run(hash(token), JSON.stringify(identity), now + 12 * 60 * 60 * 1000);
  res.setHeader('Set-Cookie', `fw_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
  res.json({ identity });
});
app.post('/api/logout', (req, res) => {
  const token = req.headers.cookie?.match(/(?:^|;\s*)fw_session=([^;]+)/)?.[1];
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
  res.setHeader('Set-Cookie', 'fw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({ ok: true });
});
app.get('/api/health', (_req, res) => res.json({ ok: true, room: 'FW-001' }));
app.get('/api/snapshot', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(project(game, session(req.headers.cookie))); });
app.get('/api/requests/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const identity = session(req.headers.cookie);
  if (!identity) return res.sendStatus(403);
  for (const company of game.companies) {
    if (identity.role !== 'operator' && identity.companyId !== company.id) continue;
    const request = company.traffic.requests[req.params.id];
    if (request) return res.json(trafficReceipt(request));
  }
  const row = db.prepare('SELECT companyId,receipt FROM request_receipts WHERE id=?').get(req.params.id) as {companyId: number; receipt: string} | undefined;
  if (!row || (identity.role !== 'operator' && identity.companyId !== row.companyId)) return res.sendStatus(404);
  res.json(JSON.parse(row.receipt));
});
app.get('/api/access', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (session(req.headers.cookie)?.role !== 'operator') return res.status(403).json({ error: 'Acceso denegado.' });
  res.json({ credentials });
});
const http = createServer(app);
const io = new Server(http, { maxHttpBufferSize: 80000, allowRequest: (req, callback) => {
  try { callback(null, !req.headers.origin || new URL(req.headers.origin).host === req.headers.host); } catch { callback(null, false); }
} });
io.on('connection', socket => {
  socket.emit('snapshot', project(game, session(socket.request.headers.cookie)));
  let count = 0, at = Date.now();
  socket.on('command', (command: Command, ack: (result: unknown) => void) => {
    if (typeof ack !== 'function') return;
    if (Date.now() - at > 1000) { at = Date.now(); count = 0; }
    if (++count > 20) return ack({ ok: false, error: 'Límite de comandos alcanzado.' });
    const identity = session(socket.request.headers.cookie);
    if (!identity || !command || typeof command.id !== 'string' || command.id.length > 100 || typeof command.type !== 'string') return ack({ ok: false, code: 'FORBIDDEN', error: 'Sesión o comando no autorizado.' });
    const digest = hash(JSON.stringify(command));
    const prior = db.prepare('SELECT digest,result FROM commands WHERE identity=? AND id=?').get(identity.id, command.id) as { digest: string; result: string } | undefined;
    if (prior) return ack(prior.digest === digest ? JSON.parse(prior.result) : { ok: false, error: 'ID de comando ya utilizado.' });
    const before = structuredClone(game);
    const result = applyCommand(game, identity, command);
    try {
      persist({ identity: identity.id, id: command.id, digest, result: JSON.stringify(result) });
      ack(result); broadcast();
    } catch { game = before; ack({ ok: false, error: 'No se pudo confirmar el comando.' }); }
  });
});
function broadcast() {
  for (const socket of io.sockets.sockets.values()) socket.emit('snapshot', project(game, session(socket.request.headers.cookie)));
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
function shutdown() { clearInterval(timer); persist(); io.close(); http.close(); db.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
