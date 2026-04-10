import { SupabaseAuthService } from './SupabaseAuthService';

const mockSupabase = {
  auth: {
    signInWithPassword: jest.fn().mockResolvedValue({
      data: { session: { access_token: 'tok', user: { id: 'u1' } } },
      error: null,
    }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
    getSession: jest.fn().mockResolvedValue({
      data: { session: { access_token: 'tok', user: { id: 'u1' } } },
      error: null,
    }),
  },
};

describe('SupabaseAuthService', () => {
  const service = new SupabaseAuthService(mockSupabase as any);

  it('signIn returns success with session', async () => {
    const result = await service.signIn('henza@example.com', 'password');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.access_token).toBe('tok');
  });

  it('signOut returns success', async () => {
    const result = await service.signOut();
    expect(result.success).toBe(true);
  });

  it('getSession returns current session', async () => {
    const result = await service.getSession();
    expect(result.success).toBe(true);
  });
});
