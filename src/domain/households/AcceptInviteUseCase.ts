import type { InferInsertModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { householdMembers, households } from '../../data/local/schema';
import type { RestoreService } from '../../data/sync/RestoreService';
import { toLocalRow } from '../../data/sync/rowConverters';
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
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly restoreService: RestoreService,
    private readonly input: AcceptInviteInput,
  ) {}

  async execute(): Promise<Result<HouseholdSummary>> {
    const { data, error } = await this.supabase.rpc('join_household_via_invite', {
      p_invite_code: this.input.code.toUpperCase(),
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

    // The membership row is already created SERVER-SIDE by the
    // join_household_via_invite RPC (spec: docs/superpowers/specs/2026-07-03-
    // oplog-sync-correctness-design.md) — this is only this device's LOCAL
    // copy catching up, not a new fact the server needs to learn. It is
    // deliberately a plain local insert with NO oplog op: appending one here
    // would re-push an `insert` for a row the server already has, which the
    // server should (and does) reject/ignore, but is still the wrong shape —
    // mirrors how RestoreService's own pulled-row inserts never enqueue/
    // append ops either (see RestoreService.ts).
    const localMember: InferInsertModel<typeof householdMembers> = {
      id: memberId,
      householdId,
      userId: this.input.userId,
      role: 'member',
      joinedAt: now,
      updatedAt: now,
    };
    await this.db.insert(householdMembers).values(localMember);

    let restored = await this.restoreService
      .restoreHousehold(householdId, 'member', this.input.userId)
      .catch(() => null);

    if (!restored) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      restored = await this.restoreService
        .restoreHousehold(householdId, 'member', this.input.userId)
        .catch(() => null);
    }

    if (!restored) {
      // M10 (exhaustive audit): both restore attempts failed.
      // RestoreService.restoreHousehold is the ONLY place that persists a
      // local `households` row — it returns null BEFORE that write when its
      // households fetch fails, so at this point the joiner has a local
      // household_members row but NO local household. Silently fabricating
      // name: 'My Household' / paydayDay: 25 here (the old behavior) would
      // corrupt every budget-period boundary the joiner sees in-session
      // (wrong payday), and never inserting a local `households` row means
      // the NEXT cold start's EnsureHouseholdUseCase finds the membership
      // but not the household, returns `no_household`, and strands an
      // already-joined member on the create/join choice screen (where
      // "Create Household" would mint a second, orphaned household).
      //
      // Fall back to a direct, minimal fetch of the real household record
      // (skipping RestoreService's full entity-table catch-up, which the
      // ordinary background restore/sync paths will still complete later)
      // and persist it locally ourselves. Only if THIS also fails (fully
      // offline, not just a flaky restore) do we fail cleanly instead of
      // inventing data.
      const { data: hh, error: hhError } = await this.supabase
        .from('households')
        .select('*')
        .eq('id', householdId)
        .single();

      if (hhError || !hh) {
        return createFailure({
          code: 'HOUSEHOLD_RESTORE_FAILED',
          message:
            'Joined the household, but could not load its details. Please try again once you are back online.',
        });
      }

      const localHousehold = toLocalRow(hh as Record<string, unknown>);
      try {
        await this.db
          .insert(households)
          .values(localHousehold as typeof households.$inferInsert)
          .onConflictDoUpdate({
            target: households.id,
            set: {
              name: sql`excluded.name`,
              paydayDay: sql`excluded.payday_day`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      } catch {
        // A transient local SQLite failure here must not escape as an unhandled
        // rejection — keep the Result contract every other path in execute() uses.
        return createFailure({
          code: 'HOUSEHOLD_RESTORE_FAILED',
          message: 'Could not save the household locally after accepting the invite.',
        });
      }

      restored = {
        id: hh.id as string,
        name: hh.name as string,
        paydayDay: hh.payday_day as number,
        role: 'member',
      };
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
