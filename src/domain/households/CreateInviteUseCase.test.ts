import { CreateInviteUseCase } from './CreateInviteUseCase';

describe('CreateInviteUseCase', () => {
  it('calls create_invitation with p_household_id and returns the server-generated code', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { id: 'inv-1', code: 'ABC123', expires_at: '2026-01-03T00:00:00.000Z' },
      error: null,
    });
    const supabase = { rpc } as any;
    const uc = new CreateInviteUseCase(supabase, { householdId: 'hh-1', createdByUserId: 'u-1' });
    const result = await uc.execute();

    expect(rpc).toHaveBeenCalledWith('create_invitation', { p_household_id: 'hh-1' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('ABC123');
      expect(result.data.expiresAt).toBe('2026-01-03T00:00:00.000Z');
    }
  });

  it('returns INVITE_CREATE_FAILED when the RPC errors', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'fail' } });
    const supabase = { rpc } as any;
    const uc = new CreateInviteUseCase(supabase, { householdId: 'hh-1', createdByUserId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_CREATE_FAILED');
  });
});
