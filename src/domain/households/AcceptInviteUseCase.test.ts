import { AcceptInviteUseCase } from './AcceptInviteUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

const makeSupabase = ({
  inviteData = null as unknown,
  inviteError = null as unknown,
  insertError = null as unknown,
} = {}) => ({
  from: jest.fn().mockImplementation((table: string) => {
    if (table === 'invitations') {
      return {
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: inviteData, error: inviteError }) }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'household_members') {
      return {
        insert: () => Promise.resolve({ error: insertError }),
      };
    }
    return {};
  }),
});

describe('AcceptInviteUseCase', () => {
  it('returns INVITE_NOT_FOUND when code does not exist', async () => {
    const supabase = makeSupabase({ inviteData: null, inviteError: { message: 'not found' } });
    const db = {} as any;
    const restoreSvc = {} as any;
    const uc = new AcceptInviteUseCase(supabase as any, db, restoreSvc, { code: 'ZZZ999', userId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_NOT_FOUND');
  });

  it('returns INVITE_EXPIRED when expiry is in the past', async () => {
    const supabase = makeSupabase({
      inviteData: {
        household_id: 'hh-1',
        expires_at: new Date(Date.now() - 1000).toISOString(),
        used_by: null,
      },
    });
    const db = {} as any;
    const restoreSvc = {} as any;
    const uc = new AcceptInviteUseCase(supabase as any, db, restoreSvc, { code: 'ABC123', userId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_EXPIRED');
  });

  it('returns INVITE_ALREADY_USED when used_by is set', async () => {
    const supabase = makeSupabase({
      inviteData: {
        household_id: 'hh-1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        used_by: 'someone-else',
      },
    });
    const db = {} as any;
    const restoreSvc = {} as any;
    const uc = new AcceptInviteUseCase(supabase as any, db, restoreSvc, { code: 'ABC123', userId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_ALREADY_USED');
  });
});
