import type { SupabaseClient } from '@supabase/supabase-js';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

interface CreateInviteInput {
  householdId: string;
  createdByUserId: string;
}

export interface InviteResult {
  code: string;
  expiresAt: string;
}

interface CreateInvitationRpcResult {
  id: string;
  code: string;
  expires_at: string;
}

export class CreateInviteUseCase {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly input: CreateInviteInput,
  ) {}

  async execute(): Promise<Result<InviteResult>> {
    // Code generation (unbiased 32-char alphabet, no 0/O/1/I) now lives
    // server-side in the create_invitation RPC — the server also enforces
    // that only a household owner may mint a code, which the client cannot
    // safely verify on its own. Direct `insert` into invitations is
    // permission-denied by design.
    const { data, error } = await this.supabase.rpc('create_invitation', {
      p_household_id: this.input.householdId,
    });

    if (error || !data) {
      return createFailure({
        code: 'INVITE_CREATE_FAILED',
        message: error?.message ?? 'Failed to create invite',
      });
    }

    const result = data as CreateInvitationRpcResult;
    return createSuccess({ code: result.code, expiresAt: result.expires_at });
  }
}
