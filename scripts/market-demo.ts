import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { step } from '../server/engine.js';
import { createGameWriter } from '../server/storage.js';
import { marketScenario } from './market-scenarios.js';

const at = Number(process.argv.find(arg => arg.startsWith('--at='))?.slice(5) ?? 612);
const directory = resolve(process.argv.find(arg => arg.startsWith('--dir='))?.slice(6) ?? 'artifacts/market-demo');
if (!Number.isFinite(at) || at < 0 || at >= 1200) throw new Error('--at debe estar entre 0 y 1199 segundos.');
if (existsSync(directory)) throw new Error('El directorio de demostración ya existe; usa --dir con una ruta nueva.');
mkdirSync(directory, { recursive: true }); const db = new DatabaseSync(join(directory, 'game.sqlite'));
db.exec('CREATE TABLE commands (identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');
const write = createGameWriter(db), { game, decide } = marketScenario();
try {
  while (game.tick < at && game.status === 'RUNNING') { decide(); step(game); if (Math.round(game.tick * 10) % 100 === 0) write(game); }
  game.status = 'PAUSED'; write(game);
  console.log(`Demostración pausada en ${game.tick}s. Datos aislados: ${directory}`);
} finally { db.close(); }
