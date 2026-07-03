import type { SupabaseClient, Session } from '@supabase/supabase-js';
import {
  createSuccess,
  createFailure,
  type Result,
  type DomainError,
} from '../../domain/shared/types';

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
      return createFailure<DomainError>({
        code: 'AUTH_GET_SESSION_FAILED',
        message: error.message,
      });
    }
    return createSuccess(data.session);
  }

  /** SEC-RT-009: verify JWT with Supabase Auth server (not local cache only). */
  async validateSession(): Promise<Result<Session | null>> {
    const { data: userData, error: userError } = await this.client.auth.getUser();
    if (userError || !userData.user) {
      if (userError) {
        return createFailure<DomainError>({
          code: 'AUTH_VALIDATE_SESSION_FAILED',
          message: userError.message,
        });
      }
      return createSuccess(null);
    }
    return this.getSession();
  }
}
