import { SupabaseAuthService } from './SupabaseAuthService';

function makeMockSupabase(overrides?: {
  signInWithPassword?: jest.Mock;
  signOut?: jest.Mock;
  getSession?: jest.Mock;
  getUser?: jest.Mock;
}) {
  return {
    auth: {
      signInWithPassword:
        overrides?.signInWithPassword ??
        jest.fn().mockResolvedValue({
          data: { session: { access_token: 'tok', user: { id: 'u1' } } },
          error: null,
        }),
      signOut: overrides?.signOut ?? jest.fn().mockResolvedValue({ error: null }),
      getSession:
        overrides?.getSession ??
        jest.fn().mockResolvedValue({
          data: { session: { access_token: 'tok', user: { id: 'u1' } } },
          error: null,
        }),
      getUser:
        overrides?.getUser ??
        jest.fn().mockResolvedValue({
          data: { user: { id: 'u1' } },
          error: null,
        }),
    },
  };
}

describe('SupabaseAuthService', () => {
  describe('signIn', () => {
    it('returns success with session on valid credentials', async () => {
      const mock = makeMockSupabase();
      const service = new SupabaseAuthService(mock as any);
      const result = await service.signIn('henza@example.com', 'password');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.access_token).toBe('tok');
    });

    it('returns failure with AUTH_SIGN_IN_FAILED when error is returned', async () => {
      const mock = makeMockSupabase({
        signInWithPassword: jest.fn().mockResolvedValue({
          data: { session: null },
          error: { message: 'Invalid credentials' },
        }),
      });
      const service = new SupabaseAuthService(mock as any);
      const result = await service.signIn('bad@example.com', 'wrong');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('AUTH_SIGN_IN_FAILED');
        expect(result.error.message).toBe('Invalid credentials');
      }
    });

    it('returns failure when no error but session is null', async () => {
      const mock = makeMockSupabase({
        signInWithPassword: jest.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
      });
      const service = new SupabaseAuthService(mock as any);
      const result = await service.signIn('henza@example.com', 'password');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('AUTH_SIGN_IN_FAILED');
        expect(result.error.message).toBe('Sign in failed');
      }
    });
  });

  describe('signOut', () => {
    it('returns success when sign out succeeds', async () => {
      const mock = makeMockSupabase();
      const service = new SupabaseAuthService(mock as any);
      const result = await service.signOut();
      expect(result.success).toBe(true);
    });

    it('returns failure with AUTH_SIGN_OUT_FAILED on error', async () => {
      const mock = makeMockSupabase({
        signOut: jest.fn().mockResolvedValue({ error: { message: 'Network error' } }),
      });
      const service = new SupabaseAuthService(mock as any);
      const result = await service.signOut();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('AUTH_SIGN_OUT_FAILED');
        expect(result.error.message).toBe('Network error');
      }
    });
  });

  describe('getSession', () => {
    it('returns success with current session', async () => {
      const mock = makeMockSupabase();
      const service = new SupabaseAuthService(mock as any);
      const result = await service.getSession();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data?.access_token).toBe('tok');
    });

    it('returns success with null when no active session', async () => {
      const mock = makeMockSupabase({
        getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      });
      const service = new SupabaseAuthService(mock as any);
      const result = await service.getSession();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBeNull();
    });

    it('returns failure with AUTH_GET_SESSION_FAILED on error', async () => {
      const mock = makeMockSupabase({
        getSession: jest
          .fn()
          .mockResolvedValue({ data: { session: null }, error: { message: 'Token expired' } }),
      });
      const service = new SupabaseAuthService(mock as any);
      const result = await service.getSession();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('AUTH_GET_SESSION_FAILED');
        expect(result.error.message).toBe('Token expired');
      }
    });
  });

  describe('validateSession (SEC-RT-009)', () => {
    it('returns session when getUser succeeds', async () => {
      const mock = makeMockSupabase();
      const service = new SupabaseAuthService(mock as any);
      const result = await service.validateSession();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data?.access_token).toBe('tok');
      expect(mock.auth.getUser).toHaveBeenCalled();
    });

    it('returns null when getUser has no user', async () => {
      const mock = makeMockSupabase({
        getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      });
      const service = new SupabaseAuthService(mock as any);
      const result = await service.validateSession();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBeNull();
    });

    it('returns failure when getUser errors', async () => {
      const mock = makeMockSupabase({
        getUser: jest
          .fn()
          .mockResolvedValue({ data: { user: null }, error: { message: 'revoked' } }),
      });
      const service = new SupabaseAuthService(mock as any);
      const result = await service.validateSession();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('AUTH_VALIDATE_SESSION_FAILED');
    });
  });
});
