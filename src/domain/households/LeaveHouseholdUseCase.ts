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
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { householdMembers } from '../../data/local/schema';
import { requestSyncNow } from '../../data/sync/syncRuntime';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

interface LeaveHouseholdInput {
  householdId: string;
  userId: string;
}

export interface LeaveHouseholdOutcome {
  /** The household that was left — the caller drops it from its own list. */
  householdId: string;
}

export class LeaveHouseholdUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly input: LeaveHouseholdInput,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<LeaveHouseholdOutcome>> {
    const { householdId, userId } = this.input;

    const active = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(eq(householdMembers.householdId, householdId), isNull(householdMembers.deletedAt)),
      );

    const own = active.find((row) => row.userId === userId);
    if (!own) {
      return createFailure({
        code: 'NOT_A_MEMBER',
        message: 'You are not a member of this household.',
      });
    }

    if (own.role === 'owner' && !active.some((row) => row.role === 'owner' && row.id !== own.id)) {
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

    const repo = resolveSyncedRepo(this.db, 'household_members', this.deps);
    try {
      repo.softDelete(own.id, householdId, resolveSyncedRepoCtx(this.deps));
    } catch (err) {
      return createFailure({
        code: 'LEAVE_FAILED',
        message: err instanceof Error ? err.message : 'Could not leave the household.',
      });
    }

    // Best effort: push the delete op now so the other members see the
    // departure immediately. The op is already committed to the local oplog,
    // so a failed round only delays it to the next scheduled sync — it is not
    // a failed leave, and must not be reported as one.
    await requestSyncNow(householdId).catch(() => undefined);

    return createSuccess({ householdId });
  }
}
