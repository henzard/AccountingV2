import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../src/data/local/migrations');

interface JournalEntry {
  idx: number;
  tag: string;
}

function readJournal(): JournalEntry[] {
  return (
    JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as {
      entries: JournalEntry[];
    }
  ).entries;
}

function applyOne(db: Database.Database, tag: string): void {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      try {
        db.exec(trimmed);
      } catch (e) {
        throw new Error(`Migration ${tag} failed: ${(e as Error).message}\nStatement: ${trimmed}`);
      }
    }
  }
}

/** Applies the real local migration chain (in journal order) to an in-memory DB. */
export function openMigratedDb(upToTag?: string): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const entry of readJournal()) {
    applyOne(db, entry.tag);
    if (upToTag !== undefined && entry.tag === upToTag) break;
  }
  return db;
}

/** Applies every migration AFTER `afterTag` (journal order) to an existing DB. */
export function applyMigrationsAfter(db: Database.Database, afterTag: string): void {
  let apply = false;
  for (const entry of readJournal()) {
    if (apply) applyOne(db, entry.tag);
    if (entry.tag === afterTag) apply = true;
  }
}
