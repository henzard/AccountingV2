import type { SupabaseClient } from '@supabase/supabase-js';

const mockRequestSyncNow = jest.fn<Promise<void>, [string]>();
jest.mock('../../data/sync/syncRuntime', () => ({
  requestSyncNow: (householdId: string): Promise<void> => mockRequestSyncNow(householdId),
}));

import { RemoveHouseholdMemberUseCase } from './RemoveHouseholdMemberUseCase';

function makeSupabase(rpc: jest.Mock): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

describe('RemoveHouseholdMemberUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestSyncNow.mockResolvedValue(undefined);
  });

  it('calls the RPC with the household and member user id, then requests a sync', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { removed: true }, error: null });

    const result = await new RemoveHouseholdMemberUseCase(makeSupabase(rpc), {
      householdId: 'hh-1',
      memberUserId: 'u-member',
    }).execute();

    expect(rpc).toHaveBeenCalledWith('remove_household_member', {
      p_household_id: 'hh-1',
      p_member_user_id: 'u-member',
    });
    expect(mockRequestSyncNow).toHaveBeenCalledWith('hh-1');
    expect(result.success).toBe(true);
  });

  it('still succeeds when the sync request rejects — the removal is already committed server-side', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { removed: true }, error: null });
    mockRequestSyncNow.mockRejectedValue(new Error('no sync runtime registered'));

    const result = await new RemoveHouseholdMemberUseCase(makeSupabase(rpc), {
      householdId: 'hh-1',
      memberUserId: 'u-member',
    }).execute();

    expect(result.success).toBe(true);
  });

  it.each([
    ['only an owner can remove a member', 'NOT_OWNER'],
    ['cannot remove yourself; leave the household instead', 'CANNOT_REMOVE_SELF'],
    ['cannot remove another owner', 'CANNOT_REMOVE_OWNER'],
    ['not an active member of this household', 'MEMBER_NOT_FOUND'],
  ])('maps the server error %s to %s', async (message, code) => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message } });

    const result = await new RemoveHouseholdMemberUseCase(makeSupabase(rpc), {
      householdId: 'hh-1',
      memberUserId: 'u-member',
    }).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(code);
    expect(mockRequestSyncNow).not.toHaveBeenCalled();
  });

  it('falls back to REMOVE_MEMBER_FAILED for an unrecognised server error', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });

    const result = await new RemoveHouseholdMemberUseCase(makeSupabase(rpc), {
      householdId: 'hh-1',
      memberUserId: 'u-member',
    }).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual({ code: 'REMOVE_MEMBER_FAILED', message: 'boom' });
  });

  it('fails when the RPC responds without removed: true', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: {}, error: null });

    const result = await new RemoveHouseholdMemberUseCase(makeSupabase(rpc), {
      householdId: 'hh-1',
      memberUserId: 'u-member',
    }).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('REMOVE_MEMBER_FAILED');
    expect(mockRequestSyncNow).not.toHaveBeenCalled();
  });
});
