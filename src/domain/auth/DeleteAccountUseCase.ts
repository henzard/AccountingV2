/**
 * DeleteAccountUseCase — the client half of the in-app "delete my account"
 * path promised by docs/privacy-policy.md and required by Google Play.
 *
 * The order below is the whole use case; every step depends on the previous
 * one having succeeded.
 *
 *   0. FLUSH FIRST (REG-11). Account deletion destroys this device's local
 *      database, and with it the oplog outbox. Any write still sitting in
 *      that outbox is a write the user made and the server never saw — and
 *      in a SHARED household those writes are their partner's data too
 *      (a transaction they booked, an envelope they created). So: run one
 *      awaited sync round per household, then re-check. If a household that
 *      has OTHER active members still owes the server ops, the deletion is
 *      refused with UNSYNCED_CHANGES rather than silently discarding
 *      partner-visible writes. A solo household has nobody to lose data to —
 *      its leftovers go with the rest of the account.
 *   1. Invoke the `delete-account` edge function. It verifies the JWT, runs
 *      `public.delete_my_account_data()` AS THE USER, sweeps the user's slip
 *      images and finally deletes the auth user. Everything server-side is
 *      decided there, not here.
 *   2. Stop the sync runtime and wait out the round in flight, BEFORE the
 *      wipe — otherwise a pull mid-apply either writes rows back into the
 *      just-emptied schema or throws inside the wipe's own transaction.
 *   3. Wipe the local SQLite database. Only after (1) succeeds: if the server
 *      call failed, the user still HAS an account, and destroying their local
 *      data would be pure loss. A failed delete must be retryable with
 *      nothing lost.
 *   4. Sign out — ALWAYS, even when the wipe threw. This is what makes
 *      App.tsx's `onAuthStateChange` listener fire `resetAllStoresOnSignOut()`
 *      (clears every zustand store), so the in-memory copy goes the same way
 *      as the on-disk one. Leaving a device signed in as a deleted account on
 *      top of a half-wiped database is the worst of both outcomes, so the
 *      wipe failure is reported AFTER the sign-out rather than instead of it.
 *
 * Requires connectivity — the whole point is a server-side erasure. Offline
 * is reported as NETWORK_REQUIRED so the screen can say so plainly instead of
 * showing a generic failure.
 *
 * Dependencies are injected (SupabaseClient, PortableDb), never imported as
 * singletons — same convention as SupabaseAuthService / EdgeFunctionSlipExtractor.
 */

import { sql } from 'drizzle-orm';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortableDb } from '../../data/uow/UnitOfWork';
import { wipeLocalData } from '../../data/local/wipeLocalData';
import { requestSyncNow, stopSyncRuntime } from '../../data/sync/syncRuntime';
import { logger } from '../../infrastructure/logging/Logger';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

/**
 * Shape the edge function returns. `deleted: true` is a complete erasure.
 * `{ deleted: false, data_deleted: true }` is the PARTIAL outcome the
 * function reports when the household data went but the auth user could not
 * be removed — the account still exists and the user must retry.
 */
interface DeleteAccountResponse {
  deleted?: boolean;
  data_deleted?: boolean;
}

/** One of the user's households, as the flush gate sees it. */
interface HouseholdFlushRow {
  household_id: string;
  unpushed_ops: number;
  other_members: number;
}

export interface DeleteAccountDeps {
  /** Returns true when the device currently has a usable connection. */
  isOnline: () => boolean;
  /** Clears the local SQLite database. Injectable for tests. */
  wipe?: (db: PortableDb) => string[];
  /** Runs one awaited sync round for a household. Rejects if it did not
   * reach the server (see data/sync/syncRuntime.ts). */
  requestSync?: (householdId: string) => Promise<void>;
  /** Unwires every sync trigger and waits out the round in flight. */
  stopSync?: () => Promise<void>;
}

export class DeleteAccountUseCase {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly db: PortableDb,
    private readonly deps: DeleteAccountDeps,
  ) {}

  async execute(): Promise<Result<void>> {
    if (!this.deps.isOnline()) {
      return createFailure({
        code: 'NETWORK_REQUIRED',
        message: 'Deleting your account needs an internet connection. Reconnect and try again.',
      });
    }

    const { data: sessionData } = await this.supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id ?? null;
    if (!userId) {
      return createFailure({
        code: 'NOT_AUTHENTICATED',
        message: 'Your session expired. Sign in again and retry.',
      });
    }

    const blocked = await this.flushPendingWrites(userId);
    if (blocked) return blocked;

    let response: DeleteAccountResponse | null;
    try {
      const { data, error } = await this.supabase.functions.invoke<DeleteAccountResponse>(
        'delete-account',
        { body: {} },
      );
      if (error) {
        // Same status-extraction idiom as EdgeFunctionSlipExtractor: the
        // FunctionsHttpError carries the HTTP status on `context`.
        const status = (error as { context?: { status?: number } }).context?.status ?? 0;
        return createFailure({
          code: status === 401 ? 'NOT_AUTHENTICATED' : 'DELETE_FAILED',
          message:
            status === 401
              ? 'Your session expired. Sign in again and retry.'
              : 'We could not delete your account. Nothing was removed — please try again.',
          context: { status },
        });
      }
      response = data;
    } catch (err) {
      return createFailure({
        code: 'DELETE_FAILED',
        message: 'We could not delete your account. Nothing was removed — please try again.',
        context: { cause: err instanceof Error ? err.message : String(err) },
      });
    }

    // The household data went, the auth user did not. Nothing local is wiped
    // and the session is kept: the user is still signed in and a retry is the
    // only thing that finishes the job.
    if (response?.deleted !== true && response?.data_deleted === true) {
      return createFailure({
        code: 'PARTIAL_DELETE',
        message:
          'Your data was deleted, but your sign-in account could not be removed. Please try again to finish deleting it.',
      });
    }

    // A 200 with anything other than `deleted: true` means the function did
    // not complete the erasure; treat it as a failure rather than wiping the
    // device on an assumption.
    if (!response || response.deleted !== true) {
      return createFailure({
        code: 'DELETE_FAILED',
        message: 'We could not delete your account. Nothing was removed — please try again.',
      });
    }

    // From here the account is gone server-side. Everything remaining is
    // local cleanup: the deletion itself must never be offered as a retry.
    const stopSync = this.deps.stopSync ?? stopSyncRuntime;
    try {
      await stopSync();
    } catch (err) {
      // A scheduler that refuses to stop must not strand the user signed in
      // to a deleted account — carry on and let the wipe report any damage.
      logger.warn('DeleteAccountUseCase: stopping the sync runtime failed, continuing', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const wipe = this.deps.wipe ?? wipeLocalData;
    let wipeError: string | null = null;
    try {
      wipe(this.db);
    } catch (err) {
      wipeError = err instanceof Error ? err.message : String(err);
    }

    const { error: signOutError } = await this.supabase.auth.signOut();

    if (wipeError !== null) {
      return createFailure({
        code: 'LOCAL_WIPE_FAILED',
        message:
          'Your account was deleted, but the copy on this device could not be cleared. Uninstall the app to remove it.',
        context: { cause: wipeError },
      });
    }
    if (signOutError) {
      return createFailure({
        code: 'SIGN_OUT_FAILED',
        message: 'Your account and local data were deleted. Please restart the app.',
        context: { cause: signOutError.message },
      });
    }

    return createSuccess(undefined);
  }

  /**
   * Pushes everything this device still owes the server, and returns a
   * failure Result when writes that OTHER members would lose are still
   * queued afterwards (REG-11 / SEC2-6). Returns `null` when it is safe to
   * proceed.
   *
   * Individual round failures are not reported directly — the re-read below
   * is the real gate, and a household with nothing pending does not care that
   * its round could not reach the server.
   */
  private async flushPendingWrites(userId: string): Promise<Result<void> | null> {
    const before = this.readHouseholdFlushState(userId);
    const requestSync = this.deps.requestSync ?? requestSyncNow;

    for (const row of before) {
      if (row.unpushed_ops === 0) continue;
      try {
        await requestSync(row.household_id);
      } catch (err) {
        logger.info('DeleteAccountUseCase: pre-delete sync round failed', {
          householdId: row.household_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const stillOwed = this.readHouseholdFlushState(userId).filter(
      (row) => row.unpushed_ops > 0 && row.other_members > 0,
    );
    if (stillOwed.length === 0) return null;

    return createFailure({
      code: 'UNSYNCED_CHANGES',
      message:
        "You have changes that haven't synced yet, and deleting your account now would lose them for the people you share with. Reconnect, wait for the sync to finish, and try again.",
      context: { households: stillOwed.length },
    });
  }

  /** Per-household: how much this device still owes the server, and whether
   * anyone else is still an active member of that household. */
  private readHouseholdFlushState(userId: string): HouseholdFlushRow[] {
    return this.db.all<HouseholdFlushRow>(sql`
      SELECT m.household_id AS household_id,
             (SELECT COUNT(*) FROM oplog o
               WHERE o.household_id = m.household_id
                 AND o.pushed_at IS NULL
                 AND o.dead_lettered_at IS NULL) AS unpushed_ops,
             (SELECT COUNT(*) FROM household_members other
               WHERE other.household_id = m.household_id
                 AND other.user_id <> ${userId}
                 AND other.deleted_at IS NULL) AS other_members
      FROM household_members m
      WHERE m.user_id = ${userId} AND m.deleted_at IS NULL
    `);
  }
}
