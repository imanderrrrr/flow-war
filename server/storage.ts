import { historySchema, writeHistory, commitHistory } from './history.js';
import type { DatabaseSync } from 'node:sqlite';
import { serializeGame } from './persistence.js';
import type { GameState } from '../shared/types.js';

export function createGameWriter(db: DatabaseSync) {
  historySchema(db);
  db.exec('CREATE TABLE IF NOT EXISTS game (id INTEGER PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS request_receipts (id TEXT PRIMARY KEY, companyId INTEGER NOT NULL, receipt TEXT NOT NULL)');
  const save = db.prepare('INSERT INTO game (id,state) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state');
  const receiptStatement = db.prepare('INSERT OR IGNORE INTO request_receipts (id,companyId,receipt) VALUES (?,?,?)');
  const commandStatement = db.prepare('INSERT INTO commands (identity,id,digest,result) VALUES (?,?,?,?)');
  return (game: GameState, command?: {identity: string; id: string; digest: string; result: string}) => {
    db.exec('BEGIN');
    try {
      for (const company of game.companies) for (const receipt of company.traffic.outbox) receiptStatement.run(receipt.id, receipt.companyId, JSON.stringify(receipt));
      writeHistory(db, game);
      save.run(serializeGame(game));
      if (command) commandStatement.run(command.identity, command.id, command.digest, command.result);
      db.exec('COMMIT'); commitHistory(game);
      for (const company of game.companies) company.traffic.outbox = [];
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
}
