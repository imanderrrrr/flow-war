import type { DatabaseSync } from 'node:sqlite';
import type { Command, GameState, Identity, Result } from '../shared/types.js';
import { applyCommand } from './engine.js';
import { copyHistoryBuffer } from './observability.js';
import type { CommandRow } from './storage.js';

type Ack = (result: unknown) => void;
type Entry = { identity: Identity; command: Command; digest: string; key: string; ack: Ack; duplicates: { digest: string; ack: Ack }[]; result?: Result; json?: string };
export type CommandPipelineOptions = {
  db: DatabaseSync;
  /** The single game writer: one transaction for the state row plus every command row given. */
  write: (game: GameState, commands: CommandRow[]) => void;
  game: () => GameState;
  /** Reinstalls the rollback image as the live state. */
  restore: (game: GameState) => void;
  hash: (text: string) => string;
  /** Runs after COMMIT and before the ACK, once per command. */
  committed: (command: Command, result: Result) => void;
  broadcast: () => void;
  groupCommit: boolean;
  maxBatch: number;
};
const conflict = () => ({ ok: false, error: 'ID de comando ya utilizado.' });
const unconfirmed = () => ({ ok: false, error: 'No se pudo confirmar el comando.' });

/**
 * Durable command admission. Identity and rate limits are resolved by the caller when the command arrives.
 * Per-command mode is the original route. Group-commit mode queues the commands received in one event-loop
 * turn and drains them from setImmediate in that same turn: per batch one rollback image, ordered application
 * with one receivedAt, one transaction, then every ACK and a single broadcast request.
 */
export function createCommandPipeline(options: CommandPipelineOptions) {
  const prior = options.db.prepare('SELECT digest,result FROM commands WHERE identity=? AND id=?');
  const maxBatch = Math.max(1, Math.floor(options.maxBatch) || 1);
  const queue: Entry[] = [], queued = new Map<string, Entry>();
  let scheduled: ReturnType<typeof setImmediate> | undefined, draining = false;

  function receive(identity: Identity, command: Command, ack: Ack) {
    const digest = options.hash(JSON.stringify(command));
    const stored = prior.get(identity.id, command.id) as { digest: string; result: string } | undefined;
    if (stored) return ack(stored.digest === digest ? JSON.parse(stored.result) : conflict());
    if (!options.groupCommit) return applyOne(identity, command, digest, ack);
    // A second copy of a queued (identity,id) shares the first copy's committed row instead of inserting another.
    const key = JSON.stringify([identity.id, command.id]), first = queued.get(key);
    if (first) { first.duplicates.push({ digest, ack }); return; }
    const entry: Entry = { identity, command, digest, key, ack, duplicates: [] };
    queued.set(key, entry); queue.push(entry);
    scheduled ??= setImmediate(flush);
  }

  function applyOne(identity: Identity, command: Command, digest: string, ack: Ack) {
    const game = options.game();
    const before = structuredClone(game); copyHistoryBuffer(game, before);
    const result = applyCommand(game, identity, command);
    try {
      options.write(game, [{ identity: identity.id, id: command.id, digest, result: JSON.stringify(result) }]);
      options.committed(command, result);
      ack(result); options.broadcast();
    } catch { options.restore(before); ack(unconfirmed()); }
  }

  /** Applies every queued command now. Callers that mutate or persist the game call it first to keep arrival order. */
  function flush() {
    if (scheduled) { clearImmediate(scheduled); scheduled = undefined; }
    if (draining) return;
    draining = true;
    try { while (queue.length) commitBatch(queue.splice(0, maxBatch)); } finally { draining = false; }
  }

  function commitBatch(batch: Entry[]) {
    const game = options.game();
    const before = structuredClone(game); copyHistoryBuffer(game, before);
    const receivedAt = Date.now();
    let applying = true;
    try {
      const rows: CommandRow[] = [];
      for (const entry of batch) {
        entry.result = applyCommand(game, entry.identity, entry.command, { receivedAt });
        entry.json = JSON.stringify(entry.result);
        rows.push({ identity: entry.identity.id, id: entry.command.id, digest: entry.digest, result: entry.json, generation: game.generation });
      }
      applying = false;
      options.write(game, rows);
    } catch (error) {
      if (applying) console.error('Lote de comandos revertido por un error al aplicar:', error);
      for (const entry of batch) queued.delete(entry.key);
      options.restore(before);
      for (const entry of batch) { entry.ack(unconfirmed()); for (const copy of entry.duplicates) copy.ack(unconfirmed()); }
      return;
    }
    for (const entry of batch) queued.delete(entry.key);
    for (const entry of batch) {
      try { options.committed(entry.command, entry.result!); } catch (error) { console.error('Efecto posterior al commit fallido:', error); }
    }
    for (const entry of batch) {
      entry.ack(entry.result);
      for (const copy of entry.duplicates) copy.ack(copy.digest === entry.digest ? JSON.parse(entry.json!) : conflict());
    }
    options.broadcast();
  }

  return { receive, flush, get queued() { return queue.length; } };
}
