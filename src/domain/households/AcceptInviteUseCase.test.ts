import { AcceptInviteUseCase } from './AcceptInviteUseCase';
import { households } from '../../data/local/schema';

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
  it('calls join_household_via_invite, inserts locally (no oplog op — server already has it), and triggers restore', async () => {
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

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restoreService as any, {
      userId: 'user-b',
      code: 'abc123',
    });
    const result = await uc.execute();

    expect(supabase.rpc).toHaveBeenCalledWith('join_household_via_invite', {
      p_invite_code: 'ABC123',
    });
    expect(result.success).toBe(true);
    expect(dbInsertMock).toHaveBeenCalled();
    const [row] = dbInsertMock.mock.results[0].value.values.mock.calls[0];
    expect(row.id).toBe('member-1');
    expect(row.householdId).toBe('h1');
    expect(restoreService.restoreHousehold).toHaveBeenCalledWith('h1', 'member', 'user-b');
  });
});

describe('AcceptInviteUseCase — M10: restore failure no longer fabricates household data', () => {
  // Regression tests for M10 (exhaustive audit, 2026-07-05): when both
  // RestoreService.restoreHousehold attempts fail, the use case used to
  // silently substitute paydayDay: 25 / name: 'My Household' and never
  // persist a local `households` row (only `household_members`) — corrupting
  // the joiner's budget-period boundary and stranding them on the
  // create/join screen on the next cold start (EnsureHouseholdUseCase finds
  // the membership but not the household). It must now either (a) fetch the
  // real household directly and persist a local row, or (b) fail cleanly —
  // never fabricate.

  function makeDb(): { insert: jest.Mock } {
    return {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    };
  }

  function makeSupabaseWithHouseholdFetch(householdFetchResult: {
    data: unknown;
    error: { message: string } | null;
  }) {
    const base = makeSupabase({ joinData: { member_id: 'member-2', household_id: 'hh-fallback' } });
    return {
      ...base,
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'households') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue(householdFetchResult),
              }),
            }),
          };
        }
        return {};
      }),
    };
  }

  it('falls back to a direct household fetch and persists a local households row with the REAL data (not fabricated)', async () => {
    jest.useFakeTimers();
    const supabase = makeSupabaseWithHouseholdFetch({
      data: {
        id: 'hh-fallback',
        name: 'The Real Household Name',
        payday_day: 3,
        user_level: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      error: null,
    });
    const db = makeDb();
    const restoreService = { restoreHousehold: jest.fn().mockResolvedValue(null) };

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restoreService as any, {
      userId: 'user-c',
      code: 'XYZ789',
    });

    const resultPromise = uc.execute();
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    if (result.success) {
      // The REAL fetched values, never the old fabricated 25 / 'My Household'.
      expect(result.data.id).toBe('hh-fallback');
      expect(result.data.name).toBe('The Real Household Name');
      expect(result.data.paydayDay).toBe(3);
    }

    // A local `households` row must actually be persisted (in addition to
    // the household_members row every join already writes), so the joiner
    // has a valid household on the next cold start (EnsureHouseholdUseCase).
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.insert.mock.calls[1][0]).toBe(households);
    jest.useRealTimers();
  });

  it('returns a clean failure (never fabricated data) when both restoreHousehold attempts AND the direct household fetch fail', async () => {
    jest.useFakeTimers();
    const supabase = makeSupabaseWithHouseholdFetch({
      data: null,
      error: { message: 'network error' },
    });
    const db = makeDb();
    const restoreService = { restoreHousehold: jest.fn().mockResolvedValue(null) };

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restoreService as any, {
      userId: 'user-c',
      code: 'XYZ789',
    });

    const resultPromise = uc.execute();
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('HOUSEHOLD_RESTORE_FAILED');
    }
    // The household_members catch-up insert (always written by the RPC
    // success path, unrelated to restore) is the ONLY insert — no local
    // households row is fabricated/persisted on total failure.
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert.mock.calls[0][0]).not.toBe(households);
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

    const useCase = new AcceptInviteUseCase(supabase as any, db as any, restoreService as any, {
      code: 'ABC123',
      userId: 'user-b',
    });

    const result = await useCase.execute();
    expect(result.success).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
