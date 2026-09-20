import type { SupabaseClient } from '@supabase/supabase-js';
import { ListHouseholdMembersUseCase } from './ListHouseholdMembersUseCase';

function makeSupabase(rpc: jest.Mock): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

describe('ListHouseholdMembersUseCase', () => {
  it('maps the RPC rows to camelCase members', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          user_id: 'u-owner',
          role: 'owner',
          joined_at: '2026-01-01T00:00:00.000Z',
          email: 'owner@test.local',
        },
        {
          user_id: 'u-member',
          role: 'member',
          joined_at: '2026-02-01T00:00:00.000Z',
          email: 'member@test.local',
        },
      ],
      error: null,
    });

    const result = await new ListHouseholdMembersUseCase(makeSupabase(rpc), {
      householdId: 'hh-1',
    }).execute();

    expect(rpc).toHaveBeenCalledWith('list_household_members', { p_household_id: 'hh-1' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual([
      {
        userId: 'u-owner',
        email: 'owner@test.local',
        role: 'owner',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        userId: 'u-member',
        email: 'member@test.local',
        role: 'member',
        joinedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);
  });

  it('keeps a null email and narrows an unrecognised role to member', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        { user_id: 'u-1', role: 'superuser', joined_at: '2026-01-01T00:00:00.000Z', email: null },
      ],
      error: null,
    });

    const result = await new ListHouseholdMembersUseCase(makeSupabase(rpc), {
      householdId: 'hh-1',
    }).execute();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data[0].role).toBe('member');
    expect(result.data[0].email).toBeNull();
  });

  it('returns an empty list when the RPC returns no data', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });

    const result = await new ListHouseholdMembersUseCase(makeSupabase(rpc), {
      householdId: 'hh-1',
    }).execute();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual([]);
  });

  it('fails with MEMBERS_LOAD_FAILED when the caller is not a member', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'not a member of this household' },
    });

    const result = await new ListHouseholdMembersUseCase(makeSupabase(rpc), {
      householdId: 'hh-1',
    }).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('MEMBERS_LOAD_FAILED');
    expect(result.error.message).toBe('not a member of this household');
  });
});
