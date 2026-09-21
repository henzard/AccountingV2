import { AcceptInviteUseCase } from './AcceptInviteUseCase';
import { households, householdMembers } from '../../data/local/schema';

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

  // supabase/migrations/0007_harden_membership_and_rpcs.sql (DB-5): the
  // current server collapses not-found/already-used/expired into one
  // generic message, and throttles guessing. The branches above remain for
  // an older (pre-0007) server that still raises the specific messages.
  it("returns INVITE_INVALID with a clear, generic message for the current server's collapsed not-found/used/expired error", async () => {
    const supabase = makeSupabase({ joinError: { message: 'invite code is invalid' } });
    const uc = new AcceptInviteUseCase(supabase as any, {} as any, {} as any, {
      code: 'ZZZ999',
      userId: 'u-1',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVITE_INVALID');
      expect(result.error.message).toMatch(/isn't valid/i);
    }
  });

  it('returns INVITE_INVALID when the server reports the rejection as a RESULT (so its throttle row commits)', async () => {
    const supabase = makeSupabase({
      joinData: { error: 'invite_invalid', message: 'invite code is invalid' },
    });
    const uc = new AcceptInviteUseCase(supabase as any, {} as any, {} as any, {
      code: 'ZZZ999',
      userId: 'u-1',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_INVALID');
  });

  it('returns INVITE_THROTTLED when the server reports too many attempts', async () => {
    const supabase = makeSupabase({
      joinError: { message: 'too many attempts, try again later' },
    });
    const uc = new AcceptInviteUseCase(supabase as any, {} as any, {} as any, {
      code: 'ZZZ999',
      userId: 'u-1',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVITE_THROTTLED');
      expect(result.error.message).toMatch(/too many attempts/i);
    }
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

describe('AcceptInviteUseCase — F1: resuming a half-completed join', () => {
  // F1 (round 6): the RPC creates the SERVER membership before this device
  // has a local `households` row. If connectivity drops in that window the
  // join is done server-side but invisible locally, and re-entering the
  // same code hits the server's "this invite is spent" branch — a permanent
  // dead end on the create/join gate. The local fingerprint of that state
  // (an active household_members row whose household has no local
  // `households` row) must be treated as RESUME, not as a bad code.

  function makeLocalDb({
    memberHouseholdIds = [] as string[],
    localHouseholdIds = [] as string[],
  }) {
    const insert = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
      }),
    });
    const select = jest.fn().mockImplementation(() => ({
      from: jest.fn().mockImplementation((table: unknown) => {
        if (table === householdMembers) {
          return {
            where: jest
              .fn()
              .mockResolvedValue(memberHouseholdIds.map((id) => ({ householdId: id }))),
          };
        }
        return {
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(localHouseholdIds.map((id) => ({ id }))),
          }),
        };
      }),
    }));
    return { insert, select };
  }

  function makeSupabaseForResume({
    joinData = null as unknown,
    joinError = null as { message: string } | null,
    householdFetch = {
      data: null,
      error: { message: 'network error' },
    } as { data: unknown; error: { message: string } | null },
  }) {
    return {
      rpc: jest.fn().mockResolvedValue({ data: joinData, error: joinError }),
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'households') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue(householdFetch),
              }),
            }),
          };
        }
        return {};
      }),
    };
  }

  const resumedHousehold = { id: 'hh-orphan', name: 'Resumed Household', paydayDay: 7 };

  it('resumes (and succeeds) when the server says the caller is ALREADY A MEMBER and a local membership has no local household row', async () => {
    const supabase = makeSupabaseForResume({
      joinError: { message: 'already a member of this household' },
    });
    const db = makeLocalDb({ memberHouseholdIds: ['hh-orphan'], localHouseholdIds: [] });
    const restoreService = { restoreHousehold: jest.fn().mockResolvedValue(resumedHousehold) };

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restoreService as any, {
      code: 'ABC123',
      userId: 'user-r',
    });
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('hh-orphan');
      expect(result.data.paydayDay).toBe(7);
    }
    expect(restoreService.restoreHousehold).toHaveBeenCalledWith('hh-orphan', 'member', 'user-r');
    // The membership row already exists locally — resuming must NOT write a
    // second household_members row.
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('resumes when the CURRENT server reports the re-entered code as the generic invite_invalid RESULT', async () => {
    // 0015_security_followups.sql: re-entering the code WE consumed hits the
    // `used_by IS NOT NULL` branch first, whose response is byte-identical
    // to a code someone else used — only the local evidence separates them.
    const supabase = makeSupabaseForResume({
      joinData: { error: 'invite_invalid', message: 'invite code is invalid' },
    });
    const db = makeLocalDb({ memberHouseholdIds: ['hh-orphan'], localHouseholdIds: [] });
    const restoreService = { restoreHousehold: jest.fn().mockResolvedValue(resumedHousehold) };

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restoreService as any, {
      code: 'ABC123',
      userId: 'user-r',
    });
    const result = await uc.execute();

    expect(result.success).toBe(true);
  });

  it('still reports INVITE_ALREADY_USED for a genuinely spent code when there is no half-completed join', async () => {
    const supabase = makeSupabaseForResume({ joinError: { message: 'invite already used' } });
    const db = makeLocalDb({ memberHouseholdIds: [], localHouseholdIds: [] });
    const restoreService = { restoreHousehold: jest.fn() };

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restoreService as any, {
      code: 'ABC123',
      userId: 'user-r',
    });
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_ALREADY_USED');
    expect(restoreService.restoreHousehold).not.toHaveBeenCalled();
  });

  it('does not resume into a household that already has a local households row (a real "already a member")', async () => {
    const supabase = makeSupabaseForResume({
      joinError: { message: 'already a member of this household' },
    });
    const db = makeLocalDb({ memberHouseholdIds: ['hh-known'], localHouseholdIds: ['hh-known'] });
    const restoreService = { restoreHousehold: jest.fn() };

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restoreService as any, {
      code: 'ABC123',
      userId: 'user-r',
    });
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_ALREADY_USED');
    expect(restoreService.restoreHousehold).not.toHaveBeenCalled();
  });

  it('fails with the SAME recoverable HOUSEHOLD_RESTORE_FAILED when the resume cannot reach the server either', async () => {
    jest.useFakeTimers();
    const supabase = makeSupabaseForResume({
      joinData: { error: 'invite_invalid', message: 'invite code is invalid' },
      householdFetch: { data: null, error: { message: 'network error' } },
    });
    const db = makeLocalDb({ memberHouseholdIds: ['hh-orphan'], localHouseholdIds: [] });
    const restoreService = { restoreHousehold: jest.fn().mockResolvedValue(null) };

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restoreService as any, {
      code: 'ABC123',
      userId: 'user-r',
    });
    const resultPromise = uc.execute();
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('HOUSEHOLD_RESTORE_FAILED');
      // Honest copy: the join DID work, only the download did not.
      expect(result.error.message).toMatch(/you've joined/i);
      expect(result.error.message).toMatch(/try again/i);
    }
    expect(db.insert).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('resumes past the per-caller throttle rather than locking an already-joined user out for an hour', async () => {
    // The throttle is checked BEFORE the code is looked up, so a user who
    // taps Try again a few times would otherwise be stuck for an hour with
    // the join already committed server-side.
    const supabase = makeSupabaseForResume({
      joinError: { message: 'too many attempts, try again later' },
    });
    const db = makeLocalDb({ memberHouseholdIds: ['hh-orphan'], localHouseholdIds: [] });
    const restoreService = { restoreHousehold: jest.fn().mockResolvedValue(resumedHousehold) };

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restoreService as any, {
      code: 'ABC123',
      userId: 'user-r',
    });
    const result = await uc.execute();

    expect(result.success).toBe(true);
  });
});
