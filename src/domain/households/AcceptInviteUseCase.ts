import type { InferInsertModel } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { householdMembers, households } from '../../data/local/schema';
import type { RestoreService } from '../../data/sync/RestoreService';
import { hydrateHousehold } from './hydrateHousehold';
import type { HouseholdSummary } from './EnsureHouseholdUseCase';
import type { Result } from '../shared/types';
import { createFailure } from '../shared/types';

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
  // supabase/migrations/0007_harden_membership_and_rpcs.sql (DB-5): the
  // server now throttles guessing (10 failed attempts/hour) and collapses
  // not-found/already-used/expired into ONE generic message ("invite code
  // is invalid") so a client can no longer use distinct error text to
  // enumerate valid codes. These two branches match the CURRENT server;
  // the branches below them are kept for an older server (pre-0007) that
  // still raises the specific messages.
  if (lower.includes('too many attempts')) {
    return { code: 'INVITE_THROTTLED', message: 'Too many attempts. Try again in an hour.' };
  }
  if (lower.includes('invite code is invalid')) {
    return {
      code: 'INVITE_INVALID',
      message:
        "That invite code isn't valid. Check it with the person who invited you — codes expire and can only be used once.",
    };
  }
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

// F1 (round 6): join failures that a HALF-COMPLETED join of our own can
// masquerade as, and which must therefore be re-checked against local
// evidence before they are shown to the user.
//
// The server (supabase/migrations/0015_security_followups.sql — the LATEST
// definition of join_household_via_invite) gives us no way to tell these
// apart from the message alone:
//   * Re-entering the code WE already consumed hits the
//     `invite_row.used_by IS NOT NULL` branch FIRST, which returns the
//     generic `{error:'invite_invalid', message:'invite code is invalid'}`
//     RESULT — byte-identical to a code someone else used.
//   * The distinct `already a member of this household` EXCEPTION only
//     fires for a *different* still-valid code to a household we are
//     already an active member of, and it does not carry the household id.
//   * The throttle ('too many attempts') fires BEFORE the code is even
//     looked up, so repeatedly tapping Try again can lock the user out for
//     an hour with the join already done server-side.
// So the discriminator is local: an active household_members row for this
// user whose household has NO local `households` row can only have been
// written by a join of ours that never finished (see
// findUnrestoredMembership).
const RESUMABLE_JOIN_ERROR_CODES = new Set([
  'INVITE_ALREADY_USED',
  'INVITE_INVALID',
  'INVITE_THROTTLED',
]);

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
      return this.failOrResume(mapJoinError(error.message ?? 'Join failed'));
    }

    // An invalid/used/expired code comes back as a RESULT, not an error: the
    // server must commit the failed attempt for its throttle, and raising would
    // roll that back.
    const rejection = data as { error?: string; message?: string } | null;
    if (rejection?.error) {
      return this.failOrResume(mapJoinError(rejection.message ?? rejection.error));
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

    return this.hydrate(householdId);
  }

  /**
   * F1 (round 6): a join that already succeeded SERVER-SIDE must never be
   * reported as a bad invite code. When the mapped failure is one a spent
   * invite of our own can produce, look for the local fingerprint of a
   * half-completed join — an active household_members row with no local
   * `households` row — and, if it is there, RESUME (skip invite
   * consumption, just finish the download) instead of failing.
   */
  private async failOrResume(mapped: {
    code: string;
    message: string;
  }): Promise<Result<HouseholdSummary>> {
    if (!RESUMABLE_JOIN_ERROR_CODES.has(mapped.code)) {
      return createFailure(mapped);
    }

    const pendingHouseholdId = await this.findUnrestoredMembership();
    if (!pendingHouseholdId) {
      // No half-completed join on this device: the code really is spent /
      // invalid / throttled. Surface the server's verdict unchanged.
      return createFailure(mapped);
    }

    return this.hydrate(pendingHouseholdId);
  }

  /**
   * The household id of an ACTIVE membership of this user that has no local
   * `households` row, or null.
   *
   * `deleted_at IS NULL` matches EnsureHouseholdUseCase exactly: membership
   * rows are soft-deleted, and a tombstoned row must never be resumed into
   * a household the user has left or was removed from.
   *
   * A local read failure must not mask the server's original error, so it
   * degrades to "no evidence" rather than throwing.
   */
  private async findUnrestoredMembership(): Promise<string | null> {
    try {
      const memberships = await this.db
        .select({ householdId: householdMembers.householdId })
        .from(householdMembers)
        .where(
          and(eq(householdMembers.userId, this.input.userId), isNull(householdMembers.deletedAt)),
        );

      for (const membership of memberships) {
        const [hh] = await this.db
          .select({ id: households.id })
          .from(households)
          .where(eq(households.id, membership.householdId))
          .limit(1);
        if (!hh) return membership.householdId;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch + persist the local `households` row for an already-established
   * membership. The logic itself lives in `./hydrateHousehold` so the
   * first-time join, the resume path here, and the app-start recovery
   * (EnsureHouseholdUseCase's `household_not_downloaded` → boot gate) all
   * converge on exactly the same local state and the same honest, retryable
   * failure when the network is gone.
   */
  private hydrate(householdId: string): Promise<Result<HouseholdSummary>> {
    return hydrateHousehold({
      supabase: this.supabase,
      db: this.db,
      restoreService: this.restoreService,
      householdId,
      userId: this.input.userId,
    });
  }
}
