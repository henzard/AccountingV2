import { useEffect, useState } from 'react';
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import migrations from './migrations/migrations';
import * as schema from './schema';

const expo = SQLite.openDatabaseSync('accountingv2-v3.db');
export const db = drizzle(expo, { schema });

interface MigrationsModule {
  migrations: Record<string, string>;
}

/**
 * Manual migration runner — avoids drizzle-orm/expo-sqlite/migrator which
 * crashes the JS thread with a null statement pointer in
 * sqlite3_clear_bindings on newer expo-sqlite. Runs each migration's SQL via
 * SQLiteDatabase.execAsync (sqlite3_exec under the hood — no prepared
 * statements involved).
 */
export function useDatabaseMigrations(): { success: boolean; error?: Error } {
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await expo.execAsync(
          'CREATE TABLE IF NOT EXISTS `__app_migrations` (`name` TEXT PRIMARY KEY NOT NULL, `applied_at` TEXT NOT NULL)',
        );
        const applied = new Set<string>(
          (
            (await expo.getAllAsync<{ name: string }>('SELECT name FROM `__app_migrations`')) ?? []
          ).map((r) => r.name),
        );
        const all = (migrations as MigrationsModule).migrations;
        for (const [name, sql] of Object.entries(all)) {
          if (applied.has(name)) continue;
          await expo.execAsync(sql.replace(/--> statement-breakpoint/g, ''));
          await expo.runAsync('INSERT INTO `__app_migrations` (name, applied_at) VALUES (?, ?)', [
            name,
            new Date().toISOString(),
          ]);
        }
        if (!cancelled) setSuccess(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { success, error };
}
