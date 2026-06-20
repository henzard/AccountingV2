import type { InferInsertModel } from 'drizzle-orm';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { householdMembers } from '../../data/local/schema';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
import type { RestoreService } from '../../data/sync/RestoreService';
import type { HouseholdSummary } from './EnsureHouseholdUseCase';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

interface AcceptInviteInput {
  code: string;
  userId: string;
}

interface JoinHouseholdRpcResult {
  member_id: string;
  household_id: string;
}

function mapJoinError(message: string): { code: string; message: string } {
  const lower = message.toLowerCase();
  if (lower.includes('expired')) {
    return { code: 'INVITE_EXPIRED', message: 'This invite code has expired' };
  }
  if (lower.includes('already used') || lower.includes('already a member')) {
    return { code: 'INVITE_ALREADY_USED', message: 'This invite code has already been used' };
  }
  if (lower.includes('not found') || lower.includes('invite not found')) {
    return { code: 'INVITE_NOT_FOUND', message: 'Invite code not found' };
  }
  return { code: 'JOIN_FAILED', message };
}

export class AcceptInviteUseCase {
  private readonly enqueuer: ISyncEnqueuer;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly restoreService: RestoreService,
    private readonly input: AcceptInviteInput,
    enqueuer?: ISyncEnqueuer,
  ) {
    this.enqueuer = enqueuer ?? new PendingSyncEnqueuerAdapter(db);
  }

  async execute(): Promise<Result<HouseholdSummary>> {
    const { data, error } = await this.supabase.rpc('join_household_via_invite', {
      invite_code: this.input.code.toUpperCase(),
    });

    if (error) {
      const mapped = mapJoinError(error.message ?? 'Join failed');
      return createFailure(mapped);
    }

    const join = data as JoinHouseholdRpcResult | null;
    if (!join?.member_id || !join?.household_id) {
      return createFailure({ code: 'JOIN_FAILED', message: 'Invalid join response from server' });
    }

    const memberId = join.member_id;
    const householdId = join.household_id;
    const now = new Date().toISOString();

    const localMember: InferInsertModel<typeof householdMembers> = {
      id: memberId,
      householdId,
      userId: this.input.userId,
      role: 'member',
      joinedAt: now,
      updatedAt: now,
    };
    await this.db.insert(householdMembers).values(localMember);
    await this.enqueuer.enqueue('household_members', memberId, 'INSERT');

    let restored = await this.restoreService
      .restoreHousehold(householdId, 'member', this.input.userId)
      .catch(() => null);

    if (!restored) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      restored = await this.restoreService
        .restoreHousehold(householdId, 'member', this.input.userId)
        .catch(() => null);
    }

    const summary: HouseholdSummary = {
      id: restored?.id ?? householdId,
      name: restored?.name ?? 'My Household',
      paydayDay: restored?.paydayDay ?? 25,
      userLevel: 1,
    };

    return createSuccess(summary);
  }
}
