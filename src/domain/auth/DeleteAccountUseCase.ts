/**
 * DeleteAccountUseCase — the client half of the in-app "delete my account"
 * path promised by docs/privacy-policy.md and required by Google Play.
 *
 * Three steps, in this order, because each one depends on the previous having
 * succeeded:
 *
 *   1. Invoke the `delete-account` edge function. It verifies the JWT, runs
 *      `public.delete_my_account_data()` AS THE USER, sweeps the user's slip
 *      images and finally deletes the auth user. Everything server-side is
 *      decided there, not here.
 *   2. Wipe the local SQLite database. Only after (1) succeeds: if the server
 *      call failed, the user still HAS an account, and destroying their local
 *      data would be pure loss. A failed delete must be retryable with
 *      nothing lost.
 *   3. Sign out. This is what makes App.tsx's `onAuthStateChange` listener
 *      fire `resetAllStoresOnSignOut()` (stops the sync scheduler, clears
 *      every zustand store), so the in-memory copy goes the same way as the
 *      on-disk one. Deliberately after the wipe: signing out first would stop
 *      the scheduler but leave a window in which a screen could re-read rows
 *      that are about to vanish.
 *
 * Requires connectivity — the whole point is a server-side erasure. Offline
 * is reported as NETWORK_REQUIRED so the screen can say so plainly instead of
 * showing a generic failure.
 *
 * Dependencies are injected (SupabaseClient, PortableDb), never imported as
 * singletons — same convention as SupabaseAuthService / EdgeFunctionSlipExtractor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortableDb } from '../../data/uow/UnitOfWork';
import { wipeLocalData } from '../../data/local/wipeLocalData';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

/** Shape the edge function returns on success. */
interface DeleteAccountResponse {
  deleted?: boolean;
}

export interface DeleteAccountDeps {
  /** Returns true when the device currently has a usable connection. */
  isOnline: () => boolean;
  /** Clears the local SQLite database. Injectable for tests. */
  wipe?: (db: PortableDb) => string[];
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

    // A 200 with anything other than `deleted: true` means the function did
    // not complete the erasure; treat it as a failure rather than wiping the
    // device on an assumption.
    if (!response || response.deleted !== true) {
      return createFailure({
        code: 'DELETE_FAILED',
        message: 'We could not delete your account. Nothing was removed — please try again.',
      });
    }

    // From here the account is gone server-side. Both remaining steps are
    // local cleanup: if either throws, the account is STILL deleted, so the
    // failure is reported with its own code and the caller must not offer a
    // retry of the deletion itself.
    const wipe = this.deps.wipe ?? wipeLocalData;
    try {
      wipe(this.db);
    } catch (err) {
      return createFailure({
        code: 'LOCAL_WIPE_FAILED',
        message:
          'Your account was deleted, but the copy on this device could not be cleared. Uninstall the app to remove it.',
        context: { cause: err instanceof Error ? err.message : String(err) },
      });
    }

    const { error: signOutError } = await this.supabase.auth.signOut();
    if (signOutError) {
      return createFailure({
        code: 'SIGN_OUT_FAILED',
        message: 'Your account and local data were deleted. Please restart the app.',
        context: { cause: signOutError.message },
      });
    }

    return createSuccess(undefined);
  }
}
