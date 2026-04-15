import { useEffect, useState } from 'react';
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import migrations from './migrations/migrations';
import * as schema from './schema';

const expo = SQLite.openDatabaseSync('accountingv2-v3.db');
export const db = drizzle(expo, { schema });

// drizzle-orm/expo-sqlite/migrator crashes the JS thread (null statement
// pointer in sqlite3_clear_bindings) on current expo-sqlite. Run migrations
// manually via execAsync (sqlite3_exec — no prepared statements).
const MIGRATIONS_TABLE = '__app_migrations';
const STATEMENT_BREAKPOINT_RE = /--> statement-breakpoint/g;
const migrationEntries = Object.entries(
  (migrations as { migrations: Record<string, string> }).migrations,
);

let migrationsPromise: Promise<void> | null = null;
function runMigrationsOnce(): Promise<void> {
  if (!migrationsPromise) {
    migrationsPromise = (async (): Promise<void> => {
      await expo.execAsync(
        `CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (\`name\` TEXT PRIMARY KEY NOT NULL, \`applied_at\` TEXT NOT NULL)`,
      );
      const applied = new Set(
        (
          (await expo.getAllAsync<{ name: string }>(`SELECT name FROM \`${MIGRATIONS_TABLE}\``)) ??
          []
        ).map((r) => r.name),
      );
      if (applied.size === migrationEntries.length) return;
      for (const [name, sql] of migrationEntries) {
        if (applied.has(name)) continue;
        await expo.execAsync(sql.replace(STATEMENT_BREAKPOINT_RE, ''));
        await expo.runAsync(
          `INSERT INTO \`${MIGRATIONS_TABLE}\` (name, applied_at) VALUES (?, ?)`,
          [name, new Date().toISOString()],
        );
      }
    })();
  }
  return migrationsPromise;
}

export function useDatabaseMigrations(): { success: boolean; error?: Error } {
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    let cancelled = false;
    runMigrationsOnce().then(
      () => {
        if (!cancelled) setSuccess(true);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return { success, error };
}
