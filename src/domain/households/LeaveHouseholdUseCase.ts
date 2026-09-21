/**
 * LeaveHouseholdUseCase — the signed-in user leaves a household.
 *
 * Leaving is the ONE membership write a member may make for themselves, so
 * unlike removal it goes through the ordinary synced write path: a
 * `createSyncedRepo` soft delete on the local `household_members` row, which
 * writes the row AND appends the matching `delete` op in one transaction, so
 * it replicates like every other write. `private.apply_one_op`
 * (supabase/migrations/0010_server_writes_via_oplog.sql) accepts exactly this
 * op — target row's `user_id` = caller — with ONE exception.
 *
 * That exception is the last active owner: apply_one_op rejects their delete
 * with code `last_owner`, because a household with no active owner can never
 * be invited to, removed from, or handed over again. A rejected op does not
 * come back to the caller — `SyncEngine.drainPush` classifies reject codes
 * and journals permanent ones as DEAD LETTERS (`oplog.dead_lettered_at`,
 * surfaced later by the Sync Health screen), long after this use case has
 * returned success and the UI has already dropped the household. The user
 * would be told they left, and the server would still have them as owner.
 *
 * So the last-owner rule is ALSO checked here, locally, BEFORE the write —
 * from the same local `household_members` rows the server decides on, using
 * the server's exact condition (no OTHER active owner), so the two cannot
 * disagree. The local check is the UX; apply_one_op remains the guarantee.
 *
 * ---------------------------------------------------------------------------
 * Leaving also PURGES the household from this phone, and the order that
 * happens in is the whole design. The sequence is:
 *
 *   1. SYNC FIRST, AND PROVE IT. One immediate round (`requestSyncNow`), then
 *      the LOCAL oplog is asked whether anything for this household is still
 *      unpushed. If it is, nothing is written and nothing is destroyed — the
 *      caller gets `UNSYNCED_CHANGES` and the phone is exactly as it was.
 *      Purging first and syncing afterwards would silently destroy the only
 *      copy of a transaction the user typed on a plane.
 *
 *      DEAD LETTERS are the deliberate exception. A dead letter is a write
 *      `apply_one_op` permanently REJECTED — the server will never take it,
 *      no matter how long we wait — so blocking on them would mean a user
 *      who can never leave. They are counted and shown in the confirmation
 *      (`inspectLeaveHouseholdPreflight`) so the user agrees to discard them,
 *      rather than being blocked forever by them.
 *
 *   2. LEAVE, AND GET THE LEAVE OP PUSHED. The membership soft delete is an
 *      ordinary local op. Purging while it is still only local would delete
 *      the oplog row that carries it, and the server would NEVER learn the
 *      user left. So the op is pushed and the oplog re-checked; if it is
 *      still local the caller gets `LEAVE_NOT_SYNCED` and NOTHING is purged.
 *
 *   3. PURGE. `PurgeLocalHouseholdDataUseCase`, one transaction, every
 *      household-scoped table plus the `households` row and the slip images
 *      on disk.
 *
 * Re-running after a failure at step 2 is SAFE and RESUMES: the caller's own
 * membership row is already soft-deleted, so `execute` detects that, skips
 * the write (a second `softDelete` would throw and append a second delete op)
 * and picks up at the push. That is why the membership query below reads ALL
 * rows and filters in memory instead of asking SQLite for the active ones.
 */

import { eq, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { householdMembers } from '../../data/local/schema';
import { requestSyncNow } from '../../data/sync/syncRuntime';
import type { PortableDb } from '../../data/uow/UnitOfWork';
import type { ISlipImageLocalStore } from '../slipScanning/CleanupExpiredSlipsUseCase';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import {
  PurgeLocalHouseholdDataUseCase,
  type PurgeLocalHouseholdDataOutcome,
} from './PurgeLocalHouseholdDataUseCase';

interface LeaveHouseholdInput {
  householdId: string;
  userId: string;
}

/** What the confirmation dialog has to tell the user BEFORE they agree. */
export interface LeaveHouseholdPreflight {
  /** Local ops for this household still waiting to reach the server. They
   * will be synced before anything is removed — and if they cannot be, the
   * leave is refused rather than losing them. */
  unsyncedCount: number;
  /** Local ops the server permanently REJECTED. The purge discards these —
   * they are already unrecoverable, and waiting for them is waiting forever. */
  deadLetteredCount: number;
}

interface PreflightRow {
  unsynced: number;
  dead_lettered: number;
}

/**
 * Counts this household's un-pushed and dead-lettered local ops.
 *
 * Deliberately synchronous and side-effect free: the confirmation dialog
 * needs these numbers to WORD ITSELF, before the user has agreed to anything.
 */
export function inspectLeaveHouseholdPreflight(
  db: PortableDb,
  householdId: string,
): LeaveHouseholdPreflight {
  // SUM(CASE ...) rather than COUNT(*) FILTER: the aggregate FILTER clause
  // needs SQLite 3.30+, and this query has to give the same answer on every
  // engine the app ships against.
  const row = db.get<PreflightRow>(sql`
    SELECT
      SUM(CASE WHEN pushed_at IS NULL AND dead_lettered_at IS NULL THEN 1 ELSE 0 END) AS unsynced,
      SUM(CASE WHEN dead_lettered_at IS NOT NULL THEN 1 ELSE 0 END) AS dead_lettered
    FROM oplog
    WHERE household_id = ${householdId}
  `);
  return {
    unsyncedCount: row?.unsynced ?? 0,
    deadLetteredCount: row?.dead_lettered ?? 0,
  };
}

export interface LeaveHouseholdDeps extends SyncWriteDeps {
  /** Injection seam for the local purge. Production omits it and gets
   * `PurgeLocalHouseholdDataUseCase` over the same `db`. */
  purge?: (householdId: string) => Promise<Result<PurgeLocalHouseholdDataOutcome>>;
  /** Handed to the purge so the household's slip images leave the disk with
   * its rows. Omitted by callers that have no filesystem. */
  slipImages?: ISlipImageLocalStore;
}

export interface LeaveHouseholdOutcome {
  /** The household that was left — the caller drops it from its own list. */
  householdId: string;
  /** Tables the purge actually cleared, for logging and for the tests. */
  purgedTables: string[];
  /** Permanently rejected local ops discarded by the purge — the number the
   * user was warned about in the confirmation. */
  deadLetteredDiscarded: number;
}

/** The message the user sees when their own writes have not reached the
 * server yet. Exported so the screen can recognise it without re-typing it. */
export const UNSYNCED_CHANGES_MESSAGE =
  "Some changes haven't synced yet. Connect to the internet and try again.";

export class LeaveHouseholdUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly input: LeaveHouseholdInput,
    private readonly deps: LeaveHouseholdDeps = {},
  ) {}

  async execute(): Promise<Result<LeaveHouseholdOutcome>> {
    const { householdId, userId } = this.input;

    // ALL rows, active and tombstoned — a resumed attempt (see the header)
    // needs to see its own already-soft-deleted membership row.
    const rows = await this.db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.householdId, householdId));

    // The ACTIVE row wins. Someone who left and later rejoined has BOTH an old
    // tombstoned row and a new active one; picking the tombstone would read as
    // "already left", skip the leave op, and purge the phone while the server
    // still counts them as a member. A tombstone is only "mine" for a resumed
    // attempt, i.e. when no active row exists.
    const ownRows = rows.filter((row) => row.userId === userId);
    const own = ownRows.find((row) => row.deletedAt == null) ?? ownRows[0];
    if (!own) {
      return createFailure({
        code: 'NOT_A_MEMBER',
        message: 'You are not a member of this household.',
      });
    }

    const active = rows.filter((row) => row.deletedAt == null);
    const stillAMember = own.deletedAt == null;

    if (
      stillAMember &&
      own.role === 'owner' &&
      !active.some((row) => row.role === 'owner' && row.id !== own.id)
    ) {
      // Mirrors apply_one_op's `last_owner` rejection exactly. Two shapes,
      // because they need different things from the user: hand the household
      // over first, or accept that a one-person household has nothing to hand
      // over and so cannot be left at all.
      const othersRemain = active.some((row) => row.id !== own.id);
      return createFailure({
        code: 'LAST_OWNER',
        message: othersRemain
          ? 'You are the only owner of this household. Another member has to become an owner before you can leave.'
          : 'You are the only person in this household, so there is nobody to hand it over to — it cannot be left.',
      });
    }

    // ---- 1. Sync first, and prove it -------------------------------------
    // Only on a FIRST attempt: a resumed one has a leave op of its own in the
    // oplog, which the step-2 check below is what actually clears.
    if (stillAMember) {
      await requestSyncNow(householdId).catch(() => undefined);
      if (this.countUnsynced(householdId) > 0) {
        return createFailure({ code: 'UNSYNCED_CHANGES', message: UNSYNCED_CHANGES_MESSAGE });
      }

      // ---- 2a. Leave ------------------------------------------------------
      const repo = resolveSyncedRepo(this.db, 'household_members', this.deps);
      try {
        repo.softDelete(own.id, householdId, resolveSyncedRepoCtx(this.deps));
      } catch (err) {
        return createFailure({
          code: 'LEAVE_FAILED',
          message: err instanceof Error ? err.message : 'Could not leave the household.',
        });
      }
    }

    // ---- 2b. Get the leave op pushed -------------------------------------
    // The purge deletes this household's oplog rows, so an unpushed leave op
    // would be destroyed and the server would never learn the user left.
    await requestSyncNow(householdId).catch(() => undefined);
    if (this.countUnsynced(householdId) > 0) {
      // A member-in-limbo: gone locally, still a member server-side. Safe —
      // nothing has been destroyed, the op is queued, and re-running this use
      // case resumes from exactly here.
      return createFailure({
        code: 'LEAVE_NOT_SYNCED',
        message:
          "You've been taken out of this household on this phone, but the change hasn't reached " +
          'the other members yet. Connect to the internet and try again — nothing was removed.',
      });
    }

    // ---- 3. Purge ---------------------------------------------------------
    const deadLetteredDiscarded = inspectLeaveHouseholdPreflight(
      this.db,
      householdId,
    ).deadLetteredCount;

    const purge =
      this.deps.purge ??
      ((id: string): Promise<Result<PurgeLocalHouseholdDataOutcome>> =>
        new PurgeLocalHouseholdDataUseCase(
          this.db,
          { householdId: id },
          { slipImages: this.deps.slipImages },
        ).execute());

    const purged = await purge(householdId);
    if (!purged.success) return purged;

    return createSuccess({
      householdId,
      purgedTables: purged.data.purgedTables,
      deadLetteredDiscarded,
    });
  }

  /** Ops for this household that are still only on this phone. Dead letters
   * are excluded on purpose — see the header. */
  private countUnsynced(householdId: string): number {
    return inspectLeaveHouseholdPreflight(this.db, householdId).unsyncedCount;
  }
}
