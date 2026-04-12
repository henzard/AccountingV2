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

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export class CreateInviteUseCase {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly input: CreateInviteInput,
  ) {}

  async execute(): Promise<Result<InviteResult>> {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48 hours

    const { data, error } = await this.supabase
      .from('invitations')
      .insert({
        code,
        household_id: this.input.householdId,
        created_by: this.input.createdByUserId,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error || !data) {
      return createFailure({ code: 'INVITE_CREATE_FAILED', message: error?.message ?? 'Failed to create invite' });
    }

    return createSuccess({ code: data.code as string, expiresAt });
  }
}
