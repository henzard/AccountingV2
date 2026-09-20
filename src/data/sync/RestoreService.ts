import { sql, getTableColumns } from 'drizzle-orm';
import { logger } from '../../infrastructure/logging/Logger';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';
import type * as schema from '../local/schema';
import {
  households,
  householdMembers,
  envelopes,
  envelopeContributions,
  transactions,
  debts,
  meterReadings,
  babySteps,
  slipQueue,
  userConsent,
} from '../local/schema';
import { toLocalRow } from './rowConverters';
import { SeedBabyStepsUseCase } from '../../domain/babySteps/SeedBabyStepsUseCase';
import { resolveSyncedRepoCtx, type SyncWriteDeps } from '../../domain/shared/syncWrite';
import { isActiveEmergencyFund, resolveIncomingEmergencyFund } from './emergencyFundConflict';
import type { PortableDb } from '../uow/UnitOfWork';

export interface RestoredHousehold {
  id: string;
  name: string;
  paydayDay: number;
  role: string;
}

/** Supabase caps a single `select` at `max_rows` (1000 by default) and
 * silently returns the truncated page — without `.range()` paging, a
 * household with more than that many transactions restores a partial ledger
 * and the missing rows are never fetched again (SYNC-9). */
const PAGE_SIZE = 1000;

/** How many times `stabiliseCursor` will re-read the server's max oplog seq
 * before giving up and using the pre-fetch value. */
const CURSOR_STABILISE_ATTEMPTS = 3;

/** The local entity tables a snapshot restore repopulates. `audit_events` is
 * deliberately absent: `supabase/migrations/0001_baseline.sql` DROPs
 * `public.audit_events` (the audit trail is server-side `job_log` now), so
 * selecting it always errored — harmless only while restore swallowed errors,
 * and a guaranteed restore failure now that it does not. */
type RestorableTable =
  | typeof envelopes
  | typeof envelopeContributions
  | typeof transactions
  | typeof debts
  | typeof meterReadings
  | typeof babySteps
  | typeof slipQueue;

interface TableSnapshot {
  localTable: RestorableTable;
  rows: Record<string, unknown>[];
}

/** Everything one household restore writes locally, as fetched from the
 * server in one pass. Re-fetched WHOLE by `stabiliseCursor` when the server
 * oplog moved during a pass — see that method for why nothing narrower is
 * sound. */
interface HouseholdSnapshot {
  memberRows: Record<string, unknown>[];
  tables: TableSnapshot[];
  consentRows: Record<string, unknown>[];
}

/**
 * True for the error PostgREST returns when the table itself is absent —
 * either the schema-cache miss (`PGRST205`) or Postgres's own
 * `42P01 relation "..." does not exist`. Recognised by code where one is
 * given, by message otherwise, since the two layers word it differently.
 */
function isMissingRelationError(error: { code?: string; message: string }): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /does not exist|could not find the table/i.test(error.message);
}

/** The transactional handle `db.transaction(...)` hands its callback. */
type RestoreTx = Parameters<Parameters<ExpoSQLiteDatabase<typeof schema>['transaction']>[0]>[0];

export class RestoreService {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly supabase: SupabaseClient,
    // Forwarded to the internal baby_steps backfill seeder below — lets tests
    // inject a fake SyncedRepo instead of needing a real db.transaction.
    // Defaults to {} (the seeder builds its own real synced repo over `db`),
    // so this is a no-op for every production call site.
    private readonly seedDeps: SyncWriteDeps = {},
  ) {}

  async restore(userId: string): Promise<RestoredHousehold[]> {
    // 1. Fetch memberships from Supabase. `deleted_at IS NULL` is explicit,
    // not implied: membership removal is a SOFT delete (the row stays,
    // stamped), and today only RLS keeps the retired row out of this result.
    // A restore that resurrected a household the user has LEFT (or been
    // removed from) would put it back on the device, complete with a local
    // membership row for `EnsureHouseholdUseCase` to find — undoing
    // `SyncEngine.evictHousehold` — the moment that RLS policy is relaxed.
    // The filter costs nothing and makes the intent the query's own.
    const { data: members, error: memberError } = await this.supabase
      .from('household_members')
      .select('household_id, role')
      .eq('user_id', userId)
      .is('deleted_at', null);

    if (memberError) throw new Error(memberError.message);
    if (!members || members.length === 0) return [];

    const summaries: RestoredHousehold[] = [];

    for (const member of members) {
      const summary = await this.restoreHousehold(
        member.household_id as string,
        member.role as string,
        userId,
      );
      if (summary) summaries.push(summary);
    }

    return summaries;
  }

  /**
   * Restores one household's server snapshot into local SQLite.
   *
   * A snapshot is the household's CURRENT state, i.e. every historical op
   * already folded in. The puller must therefore start from the oplog
   * position that snapshot corresponds to — otherwise the first pull replays
   * the household's whole oplog from seq 0 on top of final balances and every
   * historical `increment` is applied a second time (SYNC-2: a restored
   * device shows double the money). So:
   *
   *   - the household's max oplog `seq` is read BEFORE any table is fetched
   *     (an op that lands mid-restore is then <= the snapshot but > the
   *     cursor, and re-applying an absolute-value op is a converging no-op);
   *   - it is written to `sync_cursor` in the SAME local transaction as the
   *     upserts, so a cursor can never exist for data that did not commit;
   *   - every network fetch happens BEFORE that transaction opens, so a
   *     failed restore throws with nothing written at all.
   *
   * Restore is SNAPSHOT-ONLY: it runs just once per household, while there is
   * no `sync_cursor` row. After that the oplog puller is authoritative and
   * an unconditional overwrite would clobber newer local state.
   */
  async restoreHousehold(
    householdId: string,
    role: string,
    userId: string,
  ): Promise<RestoredHousehold | null> {
    // Fetch household row
    const { data: hh, error: hhError } = await this.supabase
      .from('households')
      .select('*')
      .eq('id', householdId)
      .maybeSingle();
    if (hhError) throw new Error(`restore: households fetch failed: ${hhError.message}`);
    if (!hh) return null;

    const summary: RestoredHousehold = {
      id: hh.id as string,
      name: hh.name as string,
      paydayDay: hh.payday_day as number,
      role,
    };

    if (this.hasSyncCursor(householdId)) {
      // Already sync-bootstrapped — the puller owns this household's state.
      logger.info(
        'RestoreService: household already has a sync cursor, skipping snapshot restore',
        {
          householdId,
        },
      );
      return summary;
    }

    // Cursor FIRST (see the doc comment above), then the snapshot itself.
    const firstSeq = await this.readServerMaxSeq(householdId);

    let snapshot = await this.fetchSnapshot(householdId, userId);
    const stabilised = await this.stabiliseCursor(householdId, firstSeq, () =>
      this.fetchSnapshot(householdId, userId),
    );
    const cursorSeq = stabilised.cursorSeq;
    if (stabilised.snapshot) snapshot = stabilised.snapshot;
    const { memberRows, tables: snapshots, consentRows } = snapshot;

    // Rows this device still owes the server. An unconditional overwrite here
    // would silently discard a local edit that has not been pushed yet — the
    // op would still be in the outbox, so the server would later receive an
    // update built on state the user can no longer see (SYNC-9).
    const unpushedRowIds = this.unpushedRowIds(householdId);

    this.db.transaction((tx) => {
      tx.insert(households)
        .values(toLocalRow(hh as Record<string, unknown>) as typeof households.$inferInsert)
        .onConflictDoUpdate({
          target: households.id,
          set: {
            name: sql`excluded.name`,
            paydayDay: sql`excluded.payday_day`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .run();

      for (const m of memberRows) {
        // household_members has no isSynced column; toLocalRow() adds a
        // generic isSynced:true marker for tables that have one, so strip it
        // here — it would otherwise be silently ignored by drizzle, but
        // stripping it is clearer than relying on that.
        const { isSynced: _ignored, ...insertableMember } = toLocalRow(m);
        tx.insert(householdMembers)
          .values(insertableMember as typeof householdMembers.$inferInsert)
          .onConflictDoNothing()
          .run();
      }

      for (const snapshot of snapshots) {
        this.upsertRows(tx, snapshot, unpushedRowIds);
      }

      for (const row of consentRows) {
        tx.insert(userConsent)
          .values(toLocalRow(row) as typeof userConsent.$inferInsert)
          .onConflictDoUpdate({
            target: userConsent.userId,
            set: {
              slipScanConsentAt: sql`excluded.slip_scan_consent_at`,
              updatedAt: sql`excluded.updated_at`,
            },
          })
          .run();
      }

      // R6-shaped guarantee: the cursor commits with the data it describes,
      // or not at all. MAX() keeps it monotonic against a cursor a concurrent
      // pull may have advanced further.
      tx.run(sql`
        INSERT INTO sync_cursor (household_id, last_pulled_seq)
        VALUES (${householdId}, ${cursorSeq})
        ON CONFLICT (household_id) DO UPDATE
          SET last_pulled_seq = MAX(sync_cursor.last_pulled_seq, excluded.last_pulled_seq)
      `);
    });

    // Backfill any missing baby_steps rows (idempotent — INSERT OR IGNORE).
    // Outside the transaction above: it runs its own unit of work and writes
    // oplog ops of its own.
    const seeder = new SeedBabyStepsUseCase(this.db, this.seedDeps);
    await seeder.execute(householdId);

    return summary;
  }

  /** One complete server-side read of everything a household restore writes
   * locally. Every fetch happens before the local transaction opens, so a
   * failure throws with nothing written (see `restoreHousehold`). */
  private async fetchSnapshot(householdId: string, userId: string): Promise<HouseholdSnapshot> {
    const memberRows = await this.fetchAll('household_members', 'household_id', householdId);
    const tables: TableSnapshot[] = [
      {
        localTable: envelopes,
        rows: await this.fetchAll('envelopes', 'household_id', householdId),
      },
      {
        // AFTER envelopes: a savings fund's balance is the sum of its
        // contributions, so a device that joins by restore shows every fund
        // at R0 without them. Tolerates an older server that has not yet run
        // migration 0008 (see `fetchAll`'s `optional` flag).
        localTable: envelopeContributions,
        rows: await this.fetchAll('envelope_contributions', 'household_id', householdId, {
          optional: true,
        }),
      },
      {
        localTable: transactions,
        rows: await this.fetchAll('transactions', 'household_id', householdId),
      },
      { localTable: debts, rows: await this.fetchAll('debts', 'household_id', householdId) },
      {
        localTable: meterReadings,
        rows: await this.fetchAll('meter_readings', 'household_id', householdId),
      },
      {
        localTable: babySteps,
        rows: await this.fetchAll('baby_steps', 'household_id', householdId),
      },
      {
        localTable: slipQueue,
        rows: await this.fetchAll('slip_queue', 'household_id', householdId),
      },
    ];
    const consentRows = await this.fetchAll('user_consent', 'user_id', userId);
    return { memberRows, tables, consentRows };
  }

  /**
   * Narrows the one window the cursor-before-fetch ordering leaves open.
   *
   * Reading the cursor BEFORE the snapshot guarantees no op is missed, but an
   * op committed DURING the fetch is then both folded into the snapshot AND
   * re-delivered by the first pull. For an absolute-value op that is a
   * converging no-op; for an `increment` it double-counts.
   *
   * So: re-read the max seq after a pass. If it did not move, NO op committed
   * between the seq read that opened the pass and this one, so that pass's
   * snapshot contains exactly the ops up to `candidate` and adopting it as
   * the cursor is exact — nothing missed, nothing double-applied. If it DID
   * move, the pass is re-run WHOLE and the newer seq becomes the candidate
   * for the next round of the same argument.
   *
   * SEC2-3: the previous version adopted the newer seq after re-fetching only
   * `debts`. That is unsound in the "missed op forever" direction, which is
   * strictly worse than the double-apply it was shrinking: an op committed
   * after the transactions fetch but before the second seq read is in neither
   * the snapshot (the transactions page was already taken) nor the pull range
   * (the cursor now sits past it), so that transaction never appears on this
   * device again.
   *
   * A narrower fix was considered and rejected as NOT provably sound:
   * pre-inserting the `increment` ops in `(firstSeq, latest]` into
   * `oplog_applied` when the re-fetched `debts` snapshot already contains
   * their effect. The point in the seq order at which a Supabase table fetch
   * observed the database is not observable to this client, so an increment
   * committed after the debts re-fetch but before the seq read cannot be
   * distinguished from one committed before it — and marking such an op
   * applied loses a real debt payment. Sandwiching the fetch between two seq
   * reads only shrinks that ambiguous window without closing it, and it does
   * nothing for the non-debts tables. Re-fetching everything closes the
   * window outright whenever the household settles, which is the common case.
   *
   * Bounded: a household busy enough to move on every attempt falls back to
   * `firstSeq` — the conservative never-miss-an-op behaviour, at the cost of
   * the narrow increment double-apply window this exists to shrink.
   *
   * Returns the cursor to write, plus the re-fetched snapshot when a later
   * pass replaced the caller's (the cursor and the data it describes must
   * always come from the SAME pass).
   */
  private async stabiliseCursor(
    householdId: string,
    firstSeq: number,
    refetch: () => Promise<HouseholdSnapshot>,
  ): Promise<{ cursorSeq: number; snapshot: HouseholdSnapshot | null }> {
    let candidate = firstSeq;
    let snapshot: HouseholdSnapshot | null = null;

    for (let attempt = 0; attempt < CURSOR_STABILISE_ATTEMPTS; attempt += 1) {
      const latest = await this.readServerMaxSeq(householdId);
      if (latest === candidate) return { cursorSeq: candidate, snapshot };

      snapshot = await refetch();
      candidate = latest;
    }

    logger.warn(
      'RestoreService: server oplog kept advancing during restore, using the pre-fetch cursor',
      { householdId, firstSeq, candidate },
    );
    // firstSeq describes the FIRST pass, but every later pass is a superset of
    // it (ops only accumulate) and the pull will replay (firstSeq, ...] on top
    // of whichever one committed — so the freshest snapshot is still correct
    // and strictly closer to server truth.
    return { cursorSeq: firstSeq, snapshot };
  }

  /** True once this household has been sync-bootstrapped (by a restore or by
   * the puller) — the signal that a snapshot overwrite is no longer safe. */
  private hasSyncCursor(householdId: string): boolean {
    const row = this.db.get<{ x: number }>(
      sql`SELECT 1 AS x FROM sync_cursor WHERE household_id = ${householdId}`,
    );
    return row != null;
  }

  /** Row ids with a local op still owed to the server (not pushed, not
   * dead-lettered) — these rows must not be overwritten by the snapshot. */
  private unpushedRowIds(householdId: string): Set<string> {
    const rows = this.db.all<{ row_id: string }>(sql`
      SELECT DISTINCT row_id FROM oplog
      WHERE household_id = ${householdId}
        AND pushed_at IS NULL
        AND dead_lettered_at IS NULL
    `);
    return new Set(rows.map((r) => r.row_id));
  }

  /**
   * The household's highest server oplog `seq` — the pull position this
   * snapshot corresponds to. A plain RLS-scoped SELECT (the `oplog_select`
   * policy already limits rows to the caller's households), not a new RPC.
   * Returns 0 for a household with no ops yet, which is also the correct
   * starting cursor.
   */
  private async readServerMaxSeq(householdId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('oplog')
      .select('seq')
      .eq('household_id', householdId)
      .order('seq', { ascending: false })
      .limit(1);

    if (error) throw new Error(`restore: oplog cursor read failed: ${error.message}`);
    const seq = data?.[0]?.seq;
    return seq == null ? 0 : Number(seq);
  }

  /**
   * Fetches every row of `table` matching `column = value`, paging until a
   * short page. Throws on error — a restore that silently returns nothing is
   * indistinguishable from an empty household and would go on to write a
   * sync cursor for data it never restored.
   *
   * `optional` narrows that for a table the server may not have yet (a client
   * that ships ahead of its server migration): a "relation does not exist"
   * error for THAT table alone is logged and read as empty, so a rollout gap
   * degrades one table instead of blocking every restore. Any other error
   * still throws.
   */
  private async fetchAll(
    table: string,
    column: string,
    value: string,
    opts: { optional?: boolean } = {},
  ): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await this.supabase
        .from(table)
        .select('*')
        .eq(column, value)
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        if (opts.optional && isMissingRelationError(error)) {
          logger.warn('RestoreService: table not present server-side, restored as empty', {
            table,
            error: error.message,
          });
          return all;
        }
        throw new Error(`restore: ${table} fetch failed: ${error.message}`);
      }
      const page = (data ?? []) as Record<string, unknown>[];
      all.push(...page);
      if (page.length < PAGE_SIZE) return all;
    }
  }

  private upsertRows(
    tx: RestoreTx,
    snapshot: TableSnapshot,
    unpushedRowIds: ReadonlySet<string>,
  ): void {
    // Build the set clause from all non-id columns so remote overwrites stale
    // local rows. Remote is authoritative on a first-time snapshot restore.
    // These local tables no longer have an isSynced column (sync state is
    // tracked by the oplog outbox instead), so toLocalRow()'s generic
    // isSynced:true marker is simply ignored by drizzle for any table that
    // lacks the column.
    const columns = Object.keys(getTableColumns(snapshot.localTable)).filter((col) => col !== 'id');
    const setClause = Object.fromEntries(
      columns.map((col) => {
        // Map camelCase col to snake_case for the EXCLUDED reference
        const snakeCol = col.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`);
        return [col, sql.raw(`excluded.${snakeCol}`)];
      }),
    );

    for (const row of snapshot.rows) {
      if (typeof row.id === 'string' && unpushedRowIds.has(row.id)) {
        logger.info('RestoreService: row has unpushed local ops, snapshot skipped', {
          rowId: row.id,
        });
        continue;
      }
      // SYNC-5: an inbound ACTIVE emergency_fund can violate migration 0013's
      // partial unique index rather than the primary key, and this upsert
      // only targets `id` — so the index violation used to THROW and abort
      // the whole household restore. Resolve it with the same deterministic
      // rule the puller uses (emergencyFundConflict.ts) so both paths always
      // agree, demoting the local row (with its own replicating `update` op)
      // when the inbound one is older.
      const resolved = this.resolveEmergencyFund(tx, snapshot, row);
      tx.insert(snapshot.localTable)
        .values(toLocalRow(resolved) as typeof snapshot.localTable.$inferInsert)
        .onConflictDoUpdate({
          target: (snapshot.localTable as typeof envelopes).id,
          set: setClause,
        })
        .run();
    }
  }

  /** Applies the shared emergency-fund rule to one snapshot row, returning
   * the row to store (with `envelope_type` rewritten when it must land as
   * `savings`). A no-op for every table and row the rule does not cover. */
  private resolveEmergencyFund(
    tx: RestoreTx,
    snapshot: TableSnapshot,
    row: Record<string, unknown>,
  ): Record<string, unknown> {
    if (snapshot.localTable !== envelopes) return row;
    if (!isActiveEmergencyFund(row)) return row;
    if (typeof row.id !== 'string' || typeof row.household_id !== 'string') return row;

    const storedType = resolveIncomingEmergencyFund(tx as unknown as PortableDb, {
      householdId: row.household_id,
      incomingId: row.id,
      incomingCreatedAt: typeof row.created_at === 'string' ? row.created_at : '',
      ctx: resolveSyncedRepoCtx(this.seedDeps),
    });
    return { ...row, envelope_type: storedType };
  }
}
