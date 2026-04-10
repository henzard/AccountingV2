import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { createSuccess, createFailure, type Result, type DomainError } from '../../domain/shared/types';

export class SupabaseAuthService {
  constructor(private readonly client: SupabaseClient) {}

  async signIn(email: string, password: string): Promise<Result<Session>> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return createFailure<DomainError>({
        code: 'AUTH_SIGN_IN_FAILED',
        message: error?.message ?? 'Sign in failed',
      });
    }
    return createSuccess(data.session);
  }

  async signOut(): Promise<Result<void>> {
    const { error } = await this.client.auth.signOut();
    if (error) {
      return createFailure<DomainError>({ code: 'AUTH_SIGN_OUT_FAILED', message: error.message });
    }
    return createSuccess(undefined);
  }

  async getSession(): Promise<Result<Session | null>> {
    const { data, error } = await this.client.auth.getSession();
    if (error) {
      return createFailure<DomainError>({ code: 'AUTH_GET_SESSION_FAILED', message: error.message });
    }
    return createSuccess(data.session);
  }
}
