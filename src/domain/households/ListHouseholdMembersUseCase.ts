/**
 * ListHouseholdMembersUseCase — who else is in this household.
 *
 * `household_members` carries only `user_id` (no name, no email) and there is
 * no profiles table, so a roster built from the synced local table alone
 * would be a list of raw UUIDs. The identity therefore comes from the server:
 * `public.list_household_members` (supabase/migrations/0011_member_
 * management.sql) is SECURITY DEFINER, refuses any caller who is not an
 * ACTIVE member of the household, and joins each active membership row to its
 * `auth.users` email — and nothing else from `auth.users`.
 *
 * Deliberately server-read rather than local-read: the roster must be
 * authoritative at the moment it is shown (an owner is about to remove
 * someone from it), and the email simply is not present locally.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

export type HouseholdMemberRole = 'owner' | 'member';

export interface HouseholdMember {
  userId: string;
  /** The member's sign-in email, or null if the auth record has none. */
  email: string | null;
  role: HouseholdMemberRole;
  /** ISO-8601 timestamp. */
  joinedAt: string;
}

interface ListHouseholdMembersRpcRow {
  user_id: string;
  role: string;
  joined_at: string;
  email: string | null;
}

export class ListHouseholdMembersUseCase {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly input: { householdId: string },
  ) {}

  async execute(): Promise<Result<HouseholdMember[]>> {
    const { data, error } = await this.supabase.rpc('list_household_members', {
      p_household_id: this.input.householdId,
    });

    if (error) {
      return createFailure({
        code: 'MEMBERS_LOAD_FAILED',
        message: error.message || 'Could not load the household members.',
      });
    }

    const rows = (data ?? []) as ListHouseholdMembersRpcRow[];
    return createSuccess(
      rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        // The server column is a free-text `role`; only these two values are
        // ever written (apply_one_op rejects anything else on insert), so an
        // unknown value is narrowed to the least-privileged one rather than
        // cast blindly.
        role: row.role === 'owner' ? 'owner' : 'member',
        joinedAt: row.joined_at,
      })),
    );
  }
}
