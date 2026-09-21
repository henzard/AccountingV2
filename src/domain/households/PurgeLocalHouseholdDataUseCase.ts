/**
 * PurgeLocalHouseholdDataUseCase — removes ONE household's copy from THIS
 * phone, atomically.
 *
 * The product rule behind it: when a user leaves a household, that
 * household's data goes off their device. Until now `LeaveHouseholdUseCase`
 * only soft-deleted the `household_members` row, so every transaction,
 * envelope, debt, meter reading, slip, contribution and baby step of the
 * household they walked away from stayed on the phone forever.
 *
 * Three deliberate choices, all borrowed from `data/local/wipeLocalData.ts`
 * (the account-deletion wipe) because the same failure modes apply:
 *
 *   1. DELETE FROM, never DROP TABLE and never deleting the database file.
 *      This is a per-HOUSEHOLD purge on a phone that usually still holds
 *      other households; the schema and the `__app_migrations` ledger must
 *      survive untouched.
 *
 *   2. The table list is DISCOVERED FROM THE DATABASE, not hard-coded. A
 *      hard-coded list silently stops being complete the moment someone adds
 *      a household-scoped table in a new migration and forgets this file —
 *      "we forgot one table" is exactly the leak this exists to prevent. Any
 *      table whose DDL declares a `household_id` column is household-scoped
 *      by definition, so that is the test. `households` itself is keyed by
 *      `id` rather than `household_id`, so it is appended explicitly, LAST.
 *
 *   3. ONE transaction. A purge that dies half way through would leave the
 *      phone in a state no screen can render — envelopes gone, transactions
 *      pointing at them still there — so either every row of this household
 *      goes or none does.
 *
 * Tables the discovery query deliberately does NOT reach, and why:
 *
 *   - `oplog_applied` — the receiver ledger (SyncEngine R5/SYNC-1). It is
 *     keyed by bare `op_id` with no household column, and most of its rows
 *     were written by the PULLER for REMOTE ops that never existed in the
 *     local oplog, so they cannot be attributed to a household at all. We
 *     could delete the subset that matches this household's own oplog rows,
 *     but that would be a half-measure with a real downside: an
 *     `oplog_applied` row is precisely what stops this device re-applying
 *     its OWN `increment` op if the server ever replays it (a payment
 *     counted twice). The rows are opaque UUIDs carrying no household data,
 *     no money and nothing personal, so they stay.
 *   - `user_consent` — scoped to the signed-in USER, not to a household. The
 *     user is still the same user and is still using the app.
 *   - `__app_migrations` — the migration runner's own ledger (see 1).
 *
 * Slip images live on disk, not in SQLite (`SlipImageLocalStore` writes
 * `<documents>/slips/<slipId>/<n>.jpg`), so the slip ids are read BEFORE the
 * transaction and their directories removed AFTER it commits — file deletes
 * cannot participate in a SQLite transaction, and deleting them first would
 * destroy images a rolled-back purge still has rows for.
 */

import { sql } from 'drizzle-orm';
import type { PortableDb } from '../../data/uow/UnitOfWork';
import type { ISlipImageLocalStore } from '../slipScanning/CleanupExpiredSlipsUseCase';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

interface PurgeLocalHouseholdDataInput {
  householdId: string;
}

export interface PurgeLocalHouseholdDataDeps {
  /** On-disk slip image store. Omitted when the caller has no filesystem
   * (the realsql tier, and any path that only needs the rows gone). */
  slipImages?: ISlipImageLocalStore;
}

export interface PurgeLocalHouseholdDataOutcome {
  householdId: string;
  /** Every table a DELETE actually ran against, in execution order. */
  purgedTables: string[];
  /** Slip image directories removed from disk after the commit. */
  slipImageDirsDeleted: number;
}

/** `households` is keyed by `id`, so the `household_id` discovery below can
 * never find it. It is purged last — after every table that referenced it. */
const HOUSEHOLD_ROOT_TABLE = 'households';

/** Guards the one identifier that reaches SQL as raw text. Table names come
 * from `sqlite_master`, never from user input; this catches a typo, not an
 * attacker. */
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

interface TableNameRow {
  name: string;
}

interface SlipIdRow {
  id: string;
}

/**
 * Every table in the live database that carries a `household_id` column, in a
 * stable (alphabetical) order. `households` is NOT included — see
 * `HOUSEHOLD_ROOT_TABLE`.
 *
 * Exported so a test can assert the exact list, which is what turns "a new
 * migration added a household-scoped table" from a silent leak into a failing
 * test.
 */
export function listHouseholdScopedTables(db: PortableDb): string[] {
  const rows = db.all<TableNameRow>(sql`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND sql LIKE '%household_id%'
    ORDER BY name
  `);
  // The LIKE above is only a cheap pre-filter: it also matches a table whose
  // DDL merely MENTIONS household_id (a foreign-key target, a CHECK, an index
  // comment). Deleting `WHERE household_id = ?` from such a table would throw
  // and roll the whole purge back, so keep only tables that really have the
  // column.
  return rows
    .map((row) => row.name)
    .filter((name) => name !== HOUSEHOLD_ROOT_TABLE && IDENT_RE.test(name))
    .filter((name) =>
      db
        .all<{ name: string }>(sql.raw(`PRAGMA table_info(\`${name}\`)`))
        .some((column) => column.name === 'household_id'),
    );
}

export class PurgeLocalHouseholdDataUseCase {
  constructor(
    private readonly db: PortableDb,
    private readonly input: PurgeLocalHouseholdDataInput,
    private readonly deps: PurgeLocalHouseholdDataDeps = {},
  ) {}

  async execute(): Promise<Result<PurgeLocalHouseholdDataOutcome>> {
    const { householdId } = this.input;

    let slipIds: string[];
    let purgedTables: string[];
    try {
      slipIds = this.db
        .all<SlipIdRow>(sql`SELECT id FROM slip_queue WHERE household_id = ${householdId}`)
        .map((row) => row.id);

      const tables = listHouseholdScopedTables(this.db);
      for (const table of tables) {
        if (!IDENT_RE.test(table)) {
          throw new Error(`PurgeLocalHouseholdDataUseCase: unsafe table name "${table}"`);
        }
      }

      this.db.transaction((tx) => {
        for (const table of tables) {
          tx.run(sql`DELETE FROM ${sql.raw(`\`${table}\``)} WHERE household_id = ${householdId}`);
        }
        tx.run(sql`DELETE FROM ${sql.raw(HOUSEHOLD_ROOT_TABLE)} WHERE id = ${householdId}`);
      });
      purgedTables = [...tables, HOUSEHOLD_ROOT_TABLE];
    } catch (err) {
      // The transaction rolled back, so the phone still holds every row it
      // held a moment ago — the caller can safely report a plain failure.
      return createFailure({
        code: 'PURGE_FAILED',
        message:
          err instanceof Error ? err.message : 'Could not remove this household from this device.',
        context: { householdId },
      });
    }

    // After the commit: the rows that named these files are gone, so the
    // files are unreachable whatever happens here. A filesystem error must
    // not turn a completed purge into a reported failure.
    let slipImageDirsDeleted = 0;
    const slipImages = this.deps.slipImages;
    if (slipImages) {
      for (const slipId of slipIds) {
        try {
          await slipImages.delete(slipId);
          slipImageDirsDeleted += 1;
        } catch {
          // Orphaned image directory — nothing references it any more, and
          // `CleanupExpiredSlipsUseCase` is not going to find it either. Not
          // worth failing a purge that has already committed.
        }
      }
    }

    return createSuccess({ householdId, purgedTables, slipImageDirsDeleted });
  }
}
