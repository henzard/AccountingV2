import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from './migrations/migrations';
import * as schema from './schema';

// DB filename is versioned — bumping forces a clean schema on every install.
// Safe while no real users depend on local data.
const expo = SQLite.openDatabaseSync('accountingv2-v2.db');
export const db = drizzle(expo, { schema });

export function useDatabaseMigrations(): { success: boolean; error?: Error } {
  return useMigrations(db, migrations);
}
