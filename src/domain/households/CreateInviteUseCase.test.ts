// Mock expo-crypto to provide bytes for generateCode
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid',
  getRandomBytes: (size: number) => {
    // Use Math.random for test purposes — uniqueness test requires varied bytes per call
    return new Uint8Array(Array.from({ length: size }, () => Math.floor(Math.random() * 256)));
  },
}));

import { CreateInviteUseCase, generateCode } from './CreateInviteUseCase';

describe('generateCode', () => {
  it('produces codes of length 6 from the safe alphabet', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i += 1) codes.add(generateCode());
    expect(codes.size).toBeGreaterThan(990); // allow a tiny birthday collision
    codes.forEach((c) => {
      expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    });
  });
});

describe('CreateInviteUseCase', () => {
  it('returns the 6-character code on success', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { code: 'ABC123' }, error: null }),
          }),
        }),
      }),
    } as any;
    const uc = new CreateInviteUseCase(supabase, { householdId: 'hh-1', createdByUserId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toHaveLength(6);
      expect(result.data.code).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it('returns INVITE_CREATE_FAILED when Supabase errors', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { message: 'fail' } }),
          }),
        }),
      }),
    } as any;
    const uc = new CreateInviteUseCase(supabase, { householdId: 'hh-1', createdByUserId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_CREATE_FAILED');
  });
});
