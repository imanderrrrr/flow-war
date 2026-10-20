import { receiptSchema, encodeReceipt } from './receipt-storage.js';
import { buffer } from './observability.js';
import { historySchema, writeHistory, commitHistory } from './history.js';
import type { DatabaseSync } from 'node:sqlite';
import { serializeGame } from './persistence.js';
import type { GameState } from '../shared/types.js';

export function createGameWriter(db: DatabaseSync) {
  historySchema(db);
  db.exec('CREATE TABLE IF NOT EXISTS game (id INTEGER PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS request_receipts (id TEXT PRIMARY KEY, companyId INTEGER NOT NULL, receipt TEXT NOT NULL)');
  receiptSchema(db);
  const save = db.prepare('INSERT INTO game (id,state) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state');
  const receiptStatement = db.prepare('INSERT OR IGNORE INTO request_receipts (id,companyId,receipt,generation,details,detailDigest) VALUES (?,?,?,?,?,?)');
  const commandStatement = db.prepare('INSERT INTO commands (identity,id,digest,result,generation) VALUES (?,?,?,?,?)');
  return (game: GameState, command?: {identity: string; id: string; digest: string; result: string}) => {
    const generations = [...buffer(game).closed, game];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const state of generations) {
      if (state.dvrEnabled) for (const company of state.companies) for (const receipt of company.traffic.outbox) { const encoded=encodeReceipt(db,state.generation,receipt); receiptStatement.run(receipt.id, receipt.companyId, encoded.receipt,state.generation,encoded.details,encoded.detailDigest); }
      writeHistory(db, state);
      }
      save.run(serializeGame(game));
      if (command) commandStatement.run(command.identity, command.id, command.digest, command.result,game.generation);
      db.exec('COMMIT');
      for (const state of generations) { commitHistory(state); for (const company of state.companies) company.traffic.outbox = []; }
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
}
