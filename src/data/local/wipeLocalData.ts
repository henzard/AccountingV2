/**
 * wipeLocalData — removes every row of user data from the on-device SQLite
 * database, in one transaction.
 *
 * Written for the account-deletion path (DeleteAccountUseCase): the server
 * erases the account, and this erases the copy that lives on the phone. Until
 * now nothing did — `resetAllStoresOnSignOut` in App.tsx clears the zustand
 * stores only, so sign-out leaves the entire local database on disk. That is
 * fine for a sign-out (the same user signs back in) and completely wrong for
 * an account deletion.
 *
 * Two deliberate choices:
 *
 *   1. DELETE FROM, never DROP TABLE and never deleting the database file.
 *      The schema and the `__app_migrations` ledger must survive: the
 *      migration runner (src/data/local/db.ts) verifies a djb2 checksum for
 *      every already-applied migration and throws on an unknown or missing
 *      entry, so tearing the ledger down would brick the next launch. Empty
 *      tables with an intact ledger leave the app in exactly the state a
 *      fresh install reaches after migrations.
 *
 *   2. The table list is READ FROM THE DATABASE (sqlite_master), not
 *      hard-coded. A hard-coded list silently stops being complete the moment
 *      someone adds a table in a new migration and forgets this file — and
 *      "we forgot one table" is precisely the failure this function exists to
 *      prevent. Anything genuinely not user data is named in
 *      WIPE_EXCLUDED_TABLES below, so the exclusion is the thing that has to
 *      be argued for, not the inclusion.
 */

import { sql } from 'drizzle-orm';
import type { PortableDb } from '../uow/UnitOfWork';

/**
 * Tables `wipeLocalData` must NOT touch.
 *
 * `__app_migrations` is the migration runner's own ledger (see above).
 * SQLite's internal `sqlite_*` tables are excluded by the query itself and
 * are not repeated here.
 *
 * Everything else is user data and is wiped — including `oplog`,
 * `oplog_applied` and `sync_cursor`. Those three are sync machinery rather
 * than budget data, but they carry household-scoped row ids and server
 * cursors for the account being deleted, so leaving them behind would both
 * retain data and corrupt the next account's sync (a stale cursor would make
 * the engine skip that household's entire history).
 */
export const WIPE_EXCLUDED_TABLES: readonly string[] = ['__app_migrations'];

interface TableNameRow {
  name: string;
}

/** Every wipeable table currently present in the database, in a stable order. */
export function listWipeableTables(db: PortableDb): string[] {
  const rows = db.all<TableNameRow>(sql`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `);
  return rows.map((r) => r.name).filter((name) => !WIPE_EXCLUDED_TABLES.includes(name));
}

/**
 * Deletes every row from every wipeable table, atomically. A throw part-way
 * through rolls the whole thing back, so the local database is never left
 * half-erased.
 *
 * Returns the table names that were cleared, so the caller can log/assert
 * what actually happened.
 */
export function wipeLocalData(db: PortableDb): string[] {
  const tables = listWipeableTables(db);
  db.transaction((tx) => {
    for (const table of tables) {
      // `table` comes from sqlite_master, never from user input; quoted with
      // backticks to survive any identifier that needs escaping.
      tx.run(sql.raw(`DELETE FROM \`${table}\``));
    }
  });
  return tables;
}
