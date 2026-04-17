import { AcceptInviteUseCase } from './AcceptInviteUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

const makeSupabase = ({
  inviteData = null as unknown,
  inviteError = null as unknown,
  insertError = null as unknown,
} = {}) => ({
  from: jest.fn().mockImplementation((table: string) => {
    if (table === 'household_members') {
      return {
        insert: () => Promise.resolve({ error: insertError }),
      };
    }
    return {};
  }),
  rpc: jest.fn().mockImplementation((name: string) => {
    if (name === 'lookup_invite_by_code') {
      return { single: () => Promise.resolve({ data: inviteData, error: inviteError }) };
    }
    return Promise.resolve({ error: null });
  }),
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
        if (table === 'household_members') {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      }),
      rpc: jest.fn().mockImplementation((name: string) => {
        if (name === 'lookup_invite_by_code') {
          return { single: jest.fn().mockResolvedValue({ data: mockInvite, error: null }) };
        }
        return Promise.resolve({ error: null });
      }),
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

describe('AcceptInviteUseCase — restore failure graceful degradation', () => {
  it('still succeeds with fallback summary when restoreHousehold returns null', async () => {
    jest.useFakeTimers();
    const mockInvite = {
      id: 'inv-1',
      household_id: 'hh-fallback',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      used_by: null,
    };

    const supabase = {
      from: jest.fn().mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: null }) }),
      rpc: jest.fn().mockImplementation((name: string) => {
        if (name === 'lookup_invite_by_code')
          return { single: jest.fn().mockResolvedValue({ data: mockInvite, error: null }) };
        return Promise.resolve({ error: null });
      }),
    };
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      }),
      insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
      }),
    };
    const restoreService = { restoreHousehold: jest.fn().mockResolvedValue(null) };
    const enqueuer = { enqueue: jest.fn() };

    const uc = new AcceptInviteUseCase(
      supabase as any,
      db as any,
      restoreService as any,
      { userId: 'user-c', code: 'XYZ789' },
      enqueuer as any,
    );

    const resultPromise = uc.execute();
    // Fast-forward the 1500ms retry delay
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    if (result.success) {
      // Falls back to householdId as id, default name/paydayDay
      expect(result.data.id).toBe('hh-fallback');
    }
    jest.useRealTimers();
  });
});

describe('AcceptInviteUseCase — uses lookup_invite_by_code RPC', () => {
  it('calls supabase.rpc("lookup_invite_by_code") not a direct table SELECT', async () => {
    const mockInvite = {
      id: 'inv1',
      household_id: 'h1',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      used_by: null,
    };

    const rpcSingleMock = jest.fn().mockResolvedValue({ data: mockInvite, error: null });
    const rpcClaimMock = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      rpc: jest.fn().mockImplementation((name: string) => {
        if (name === 'lookup_invite_by_code') return { single: rpcSingleMock };
        if (name === 'claim_invite') return rpcClaimMock();
        return { error: null };
      }),
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    };

    const db = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      }),
    };

    const restoreService = {
      restoreHousehold: jest.fn().mockResolvedValue({
        id: 'h1',
        name: 'My House',
        paydayDay: 25,
      }),
    };

    const enqueuer = { enqueue: jest.fn() };

    const useCase = new AcceptInviteUseCase(
      supabase as any,
      db as any,
      restoreService as any,
      { code: 'ABC123', userId: 'user-b' },
      enqueuer as any,
    );

    const result = await useCase.execute();

    expect(result.success).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('lookup_invite_by_code', { invite_code: 'ABC123' });
    // Must NOT call supabase.from('invitations') for SELECT
    const fromCalls: string[] = (supabase.from as jest.Mock).mock.calls.map((c: [string]) => c[0]);
    expect(fromCalls).not.toContain('invitations');
  });

  it('returns INVITE_NOT_FOUND when RPC returns null data', async () => {
    const supabase = {
      rpc: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      }),
      from: jest.fn(),
    };

    const useCase = new AcceptInviteUseCase(supabase as any, {} as any, {} as any, {
      code: 'BAD',
      userId: 'u1',
    });

    const result = await useCase.execute();
    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('INVITE_NOT_FOUND');
  });

  it('returns INVITE_EXPIRED when expires_at is in the past', async () => {
    const supabase = {
      rpc: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'i1',
            household_id: 'h1',
            expires_at: new Date(Date.now() - 1000).toISOString(),
            used_by: null,
          },
          error: null,
        }),
      }),
      from: jest.fn(),
    };

    const useCase = new AcceptInviteUseCase(supabase as any, {} as any, {} as any, {
      code: 'EXP',
      userId: 'u1',
    });

    const result = await useCase.execute();
    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('INVITE_EXPIRED');
  });
});
