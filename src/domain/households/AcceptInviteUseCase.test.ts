import { AcceptInviteUseCase } from './AcceptInviteUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

const makeSupabase = ({
  joinData = null as unknown,
  joinError = null as { message: string } | null,
} = {}) => ({
  rpc: jest.fn().mockImplementation((name: string) => {
    if (name === 'join_household_via_invite') {
      return Promise.resolve({ data: joinData, error: joinError });
    }
    return Promise.resolve({ data: null, error: null });
  }),
  from: jest.fn(),
});

describe('AcceptInviteUseCase', () => {
  it('returns INVITE_NOT_FOUND when RPC reports invite not found', async () => {
    const supabase = makeSupabase({ joinError: { message: 'invite not found' } });
    const uc = new AcceptInviteUseCase(supabase as any, {} as any, {} as any, {
      code: 'ZZZ999',
      userId: 'u-1',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_NOT_FOUND');
  });

  it('returns INVITE_EXPIRED when RPC reports expired', async () => {
    const supabase = makeSupabase({ joinError: { message: 'invite expired' } });
    const uc = new AcceptInviteUseCase(supabase as any, {} as any, {} as any, {
      code: 'ABC123',
      userId: 'u-1',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_EXPIRED');
  });

  it('returns INVITE_ALREADY_USED when RPC reports already used', async () => {
    const supabase = makeSupabase({ joinError: { message: 'invite already used' } });
    const uc = new AcceptInviteUseCase(supabase as any, {} as any, {} as any, {
      code: 'ABC123',
      userId: 'u-1',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_ALREADY_USED');
  });
});

describe('AcceptInviteUseCase — success path', () => {
  it('calls join_household_via_invite, inserts locally, enqueues sync, and triggers restore', async () => {
    const supabase = makeSupabase({
      joinData: { member_id: 'member-1', household_id: 'h1' },
    });

    const dbInsertMock = jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    });
    const db = { insert: dbInsertMock };

    const restoreService = {
      restoreHousehold: jest.fn().mockResolvedValue({
        id: 'h1',
        name: 'Test Household',
        paydayDay: 25,
        role: 'member',
      }),
    };

    const enqueuer = { enqueue: jest.fn() };

    const uc = new AcceptInviteUseCase(
      supabase as any,
      db as any,
      restoreService as any,
      { userId: 'user-b', code: 'abc123' },
      enqueuer as any,
    );
    const result = await uc.execute();

    expect(supabase.rpc).toHaveBeenCalledWith('join_household_via_invite', {
      invite_code: 'ABC123',
    });
    expect(result.success).toBe(true);
    expect(dbInsertMock).toHaveBeenCalled();
    expect(enqueuer.enqueue).toHaveBeenCalledWith('household_members', 'member-1', 'INSERT');
    expect(restoreService.restoreHousehold).toHaveBeenCalledWith('h1', 'member', 'user-b');
  });
});

describe('AcceptInviteUseCase — restore failure graceful degradation', () => {
  it('still succeeds with fallback summary when restoreHousehold returns null', async () => {
    jest.useFakeTimers();
    const supabase = makeSupabase({
      joinData: { member_id: 'member-2', household_id: 'hh-fallback' },
    });
    const db = {
      insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
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
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('hh-fallback');
    }
    jest.useRealTimers();
  });
});

describe('AcceptInviteUseCase — uses join_household_via_invite RPC only', () => {
  it('does not call direct household_members insert on Supabase', async () => {
    const supabase = makeSupabase({
      joinData: { member_id: 'member-3', household_id: 'h1' },
    });

    const db = {
      insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
    };
    const restoreService = {
      restoreHousehold: jest.fn().mockResolvedValue({ id: 'h1', name: 'My House', paydayDay: 25 }),
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
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
