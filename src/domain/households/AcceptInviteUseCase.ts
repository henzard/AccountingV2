import { randomUUID } from 'expo-crypto';
import type { InferInsertModel } from 'drizzle-orm';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { householdMembers } from '../../data/local/schema';
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
import type { RestoreService } from '../../data/sync/RestoreService';
import type { HouseholdSummary } from './EnsureHouseholdUseCase';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

interface AcceptInviteInput {
  code: string;
  userId: string;
}

export class AcceptInviteUseCase {
  private readonly enqueuer: PendingSyncEnqueuer;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly restoreService: RestoreService,
    private readonly input: AcceptInviteInput,
  ) {
    this.enqueuer = new PendingSyncEnqueuer(db);
  }

  async execute(): Promise<Result<HouseholdSummary>> {
    // 1. Fetch the invitation
    const { data: invite, error: inviteError } = await this.supabase
      .from('invitations')
      .select('household_id, expires_at, used_by')
      .eq('code', this.input.code.toUpperCase())
      .single();

    if (inviteError || !invite) {
      return createFailure({ code: 'INVITE_NOT_FOUND', message: 'Invite code not found' });
    }

    if (new Date(invite.expires_at as string) < new Date()) {
      return createFailure({ code: 'INVITE_EXPIRED', message: 'This invite code has expired' });
    }

    if (invite.used_by) {
      return createFailure({ code: 'INVITE_ALREADY_USED', message: 'This invite code has already been used' });
    }

    const householdId = invite.household_id as string;

    // 2. Add user to household_members in Supabase
    const memberId = randomUUID();
    const now = new Date().toISOString();

    const { error: insertError } = await this.supabase
      .from('household_members')
      .insert({
        id: memberId,
        household_id: householdId,
        user_id: this.input.userId,
        role: 'member',
        joined_at: now,
      });

    if (insertError) {
      return createFailure({ code: 'JOIN_FAILED', message: insertError.message });
    }

    // 3. Mark invitation as used
    await this.supabase
      .from('invitations')
      .update({ used_by: this.input.userId })
      .eq('code', this.input.code.toUpperCase());

    // 4. Insert member row locally
    const localMember: InferInsertModel<typeof householdMembers> = {
      id: memberId,
      householdId,
      userId: this.input.userId,
      role: 'member',
      joinedAt: now,
    };
    await this.db.insert(householdMembers).values(localMember);

    // 5. Restore the household data locally
    const restored = await this.restoreService.restoreHousehold(householdId, 'member', this.input.userId);
    if (!restored) {
      return createFailure({ code: 'RESTORE_FAILED', message: 'Joined but failed to restore household data' });
    }

    const summary: HouseholdSummary = {
      id: restored.id,
      name: restored.name,
      paydayDay: restored.paydayDay,
      userLevel: 1,
    };

    return createSuccess(summary);
  }
}
