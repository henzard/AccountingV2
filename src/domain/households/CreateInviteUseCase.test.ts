import { CreateInviteUseCase } from './CreateInviteUseCase';

describe('CreateInviteUseCase', () => {
  it('returns the 6-character code on success', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { code: 'ABC123' }, error: null }) }) }),
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
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'fail' } }) }) }),
      }),
    } as any;
    const uc = new CreateInviteUseCase(supabase, { householdId: 'hh-1', createdByUserId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_CREATE_FAILED');
  });
});
