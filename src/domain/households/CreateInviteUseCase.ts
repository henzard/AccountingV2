import * as Crypto from 'expo-crypto';
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

export function generateCode(): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I
  const bytes = Crypto.getRandomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
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
      return createFailure({
        code: 'INVITE_CREATE_FAILED',
        message: error?.message ?? 'Failed to create invite',
      });
    }

    return createSuccess({ code: data.code as string, expiresAt });
  }
}
