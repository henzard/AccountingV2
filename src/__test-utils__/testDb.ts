// Use ASM.js build (no WASM) — avoids WebAssembly sandbox issues in jest@30
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js/dist/sql-asm.js') as (typeof import('sql.js'))['default'];
import type { Database } from 'sql.js';
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import * as schema from '../data/local/schema';
import * as fs from 'fs';
import * as path from 'path';

export type TestDb = SQLJsDatabase<typeof schema>;

const MIGRATIONS_DIR = path.resolve(__dirname, '../data/local/migrations');

function getMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

const SCHEMA_PATCHES = [
  'ALTER TABLE `envelopes` ADD COLUMN `target_amount_cents` integer;',
  'ALTER TABLE `envelopes` ADD COLUMN `target_date` text;',
];

function applyMigrations(sqlite: Database): void {
  const files = getMigrationFiles();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      sqlite.run(stmt);
    }
  }
  for (const patch of SCHEMA_PATCHES) {
    try {
      sqlite.run(patch);
    } catch {
      // Column already exists from a future migration
    }
  }
}

let sqliteInstance: Database | null = null;
let drizzleInstance: TestDb | null = null;

export async function createTestDb(): Promise<TestDb> {
  const SQL = await initSqlJs();
  sqliteInstance = new SQL.Database();
  applyMigrations(sqliteInstance);
  drizzleInstance = drizzle(sqliteInstance, { schema });
  return drizzleInstance;
}

export function resetTestDb(): void {
  if (!sqliteInstance) return;
  const tables = sqliteInstance
    .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .flatMap((r) => r.values.map((v) => v[0] as string));
  for (const table of tables) {
    sqliteInstance.run(`DELETE FROM "${table}"`);
  }
}

export function closeTestDb(): void {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
    drizzleInstance = null;
  }
}

export function getTestDb(): TestDb {
  if (!drizzleInstance) throw new Error('Test DB not initialized — call createTestDb() first');
  return drizzleInstance;
}
