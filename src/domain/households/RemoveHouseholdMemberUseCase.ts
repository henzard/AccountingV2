/**
 * RemoveHouseholdMemberUseCase — an owner removes another member.
 *
 * There is no client-side write path for this: `private.apply_one_op`
 * (supabase/migrations/0010_server_writes_via_oplog.sql) lets a caller
 * soft-delete only their OWN `household_members` row, so a `delete` op pushed
 * for somebody else's row comes back `forbidden_member`. Removal therefore
 * goes through `public.remove_household_member`
 * (supabase/migrations/0011_member_management.sql), which does the
 * authorization (active owner, not self, target is not an owner), performs
 * the soft delete, and appends the matching oplog `delete` row itself.
 *
 * Because the write happens entirely server-side, this device's local
 * `household_members` copy is stale until it pulls that oplog row — so we ask
 * for an immediate sync round. That request is best-effort: the removal is
 * already committed on the server, and a failed round only means this device
 * catches up on its next scheduled sync, which must not be reported to the
 * user as a failed removal.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { requestSyncNow } from '../../data/sync/syncRuntime';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

interface RemoveHouseholdMemberInput {
  householdId: string;
  /** The `auth.uid()` of the member to remove — NOT their membership row id. */
  memberUserId: string;
}

function mapRemoveError(message: string): { code: string; message: string } {
  const lower = message.toLowerCase();
  if (lower.includes('only an owner')) {
    return {
      code: 'NOT_OWNER',
      message: 'Only a household owner can remove members.',
    };
  }
  if (lower.includes('cannot remove yourself')) {
    return {
      code: 'CANNOT_REMOVE_SELF',
      message: 'You cannot remove yourself — use "Leave household" instead.',
    };
  }
  if (lower.includes('cannot remove another owner')) {
    return {
      code: 'CANNOT_REMOVE_OWNER',
      message: 'Owners cannot remove each other. They have to leave the household themselves.',
    };
  }
  if (lower.includes('not an active member')) {
    return {
      code: 'MEMBER_NOT_FOUND',
      message: 'That person is no longer a member of this household.',
    };
  }
  return { code: 'REMOVE_MEMBER_FAILED', message };
}

export class RemoveHouseholdMemberUseCase {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly input: RemoveHouseholdMemberInput,
  ) {}

  async execute(): Promise<Result<void>> {
    const { data, error } = await this.supabase.rpc('remove_household_member', {
      p_household_id: this.input.householdId,
      p_member_user_id: this.input.memberUserId,
    });

    if (error) {
      return createFailure(mapRemoveError(error.message ?? 'Could not remove that member.'));
    }

    const result = data as { removed?: boolean } | null;
    if (!result?.removed) {
      return createFailure({
        code: 'REMOVE_MEMBER_FAILED',
        message: 'Invalid response from the server while removing that member.',
      });
    }

    // Best effort — see the file header. `requestSyncNow` rejects when no sync
    // runtime is registered (signed out / boot not finished) or when the round
    // could not reach the server; neither undoes the removal.
    await requestSyncNow(this.input.householdId).catch(() => undefined);

    return createSuccess(undefined);
  }
}
