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
        select: () => ({
          eq: () => ({ single: () => Promise.resolve({ data: inviteData, error: inviteError }) }),
        }),
      };
    }
    if (table === 'household_members') {
      return {
        insert: () => Promise.resolve({ error: insertError }),
      };
    }
    return {};
  }),
  rpc: jest.fn().mockResolvedValue({ error: null }),
});

describe('AcceptInviteUseCase', () => {
  it('returns INVITE_NOT_FOUND when code does not exist', async () => {
    const supabase = makeSupabase({ inviteData: null, inviteError: { message: 'not found' } });
    const db = {} as any;
    const restoreSvc = {} as any;
    const uc = new AcceptInviteUseCase(supabase as any, db, restoreSvc, {
      code: 'ZZZ999',
      userId: 'u-1',
    });
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
    const uc = new AcceptInviteUseCase(supabase as any, db, restoreSvc, {
      code: 'ABC123',
      userId: 'u-1',
    });
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
    const uc = new AcceptInviteUseCase(supabase as any, db, restoreSvc, {
      code: 'ABC123',
      userId: 'u-1',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_ALREADY_USED');
  });
});

describe('AcceptInviteUseCase — success path', () => {
  it('inserts household_members locally, enqueues sync, and triggers restore', async () => {
    const mockInvite = {
      id: 'inv-1',
      household_id: 'h1',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      used_by: null,
    };

    const supabase = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'invitations') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: mockInvite, error: null }),
          };
        }
        if (table === 'household_members') {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      }),
      rpc: jest.fn().mockResolvedValue({ error: null }),
    };

    const dbInsertMock = jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    });
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      }),
      insert: dbInsertMock,
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
      }),
    };

    const restoreService = {
      restoreHousehold: jest.fn().mockResolvedValue({
        id: 'h1',
        name: 'Test Household',
        paydayDay: 25,
        role: 'member',
      }),
    };

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restoreService as any, {
      userId: 'user-b',
      code: 'ABC123',
    });
    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(dbInsertMock).toHaveBeenCalled();
    expect(restoreService.restoreHousehold).toHaveBeenCalledWith('h1', 'member', 'user-b');
  });
});
