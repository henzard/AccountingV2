import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from './migrations/migrations';
import * as schema from './schema';

const expo = SQLite.openDatabaseSync('accountingv2.db');
export const db = drizzle(expo, { schema });

export function useDatabaseMigrations(): { success: boolean; error?: Error } {
  return useMigrations(db, migrations);
}
