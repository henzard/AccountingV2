import { useEffect, useState } from 'react';
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import migrations from './migrations/migrations';
import * as schema from './schema';

const expo = SQLite.openDatabaseSync('accountingv2-v3.db');
export const db = drizzle(expo, { schema });

const MIGRATIONS_TABLE = '__app_migrations';
const STATEMENT_BREAKPOINT_RE = /--> statement-breakpoint/g;
const migrationEntries = Object.entries(
  (migrations as { migrations: Record<string, string> }).migrations,
);

// djb2 — fast, dependency-free, synchronous hash for migration integrity checks.
// Not cryptographic — detects accidental file changes, not adversarial tampering.
export function djb2Hex(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

let migrationsPromise: Promise<void> | null = null;

function runMigrationsOnce(): Promise<void> {
  if (!migrationsPromise) {
    migrationsPromise = (async (): Promise<void> => {
      await expo.execAsync(
        `CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (` +
          '`name` TEXT PRIMARY KEY NOT NULL, ' +
          '`applied_at` TEXT NOT NULL, ' +
          "`checksum` TEXT NOT NULL DEFAULT 'legacy'" +
          ')',
      );
      // Idempotently add checksum column to tables created before this version.
      await expo
        .execAsync(
          `ALTER TABLE \`${MIGRATIONS_TABLE}\` ADD COLUMN \`checksum\` TEXT NOT NULL DEFAULT 'legacy'`,
        )
        .catch(() => {
          // Column already exists — ignore.
        });

      const rows =
        (await expo.getAllAsync<{ name: string; checksum: string }>(
          `SELECT name, checksum FROM \`${MIGRATIONS_TABLE}\``,
        )) ?? [];
      const applied = new Map(rows.map((r) => [r.name, r.checksum]));

      // Verify integrity of previously-applied migrations.
      for (const [name, sql] of migrationEntries) {
        const storedChecksum = applied.get(name);
        if (!storedChecksum) continue;
        if (storedChecksum === 'legacy') continue;
        const expected = djb2Hex(sql);
        if (storedChecksum !== expected) {
          throw new Error(
            `Migration checksum mismatch for "${name}": ` +
              `stored=${storedChecksum}, current=${expected}. ` +
              'The migration file was modified after it was applied — this is not allowed.',
          );
        }
      }

      if (applied.size === migrationEntries.length) return;

      for (const [name, sql] of migrationEntries) {
        if (applied.has(name)) continue;
        const checksum = djb2Hex(sql);
        const cleanSql = sql.replace(STATEMENT_BREAKPOINT_RE, '');
        await expo.execAsync('BEGIN');
        try {
          await expo.execAsync(cleanSql);
          await expo.runAsync(
            `INSERT INTO \`${MIGRATIONS_TABLE}\` (name, applied_at, checksum) VALUES (?, ?, ?)`,
            [name, new Date().toISOString(), checksum],
          );
          await expo.execAsync('COMMIT');
        } catch (e) {
          try {
            await expo.execAsync('ROLLBACK');
          } catch {
            /* ignore */
          }
          throw e;
        }
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
