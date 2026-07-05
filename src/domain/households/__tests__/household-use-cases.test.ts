import { CreateHouseholdUseCase } from '../CreateHouseholdUseCase';
import { AcceptInviteUseCase } from '../AcceptInviteUseCase';
import { CreateInviteUseCase } from '../CreateInviteUseCase';
import { EnsureHouseholdUseCase } from '../EnsureHouseholdUseCase';
import { UpdateHouseholdPaydayDayUseCase } from '../UpdateHouseholdPaydayDayUseCase';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-test-' + Math.random().toString(36).slice(2, 8)),
  getRandomBytes: jest.fn((n: number) => new Uint8Array(n).fill(7)),
}));

jest.mock('../../babySteps/SeedBabyStepsUseCase', () => ({
  SeedBabyStepsUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, data: undefined }),
  })),
}));

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-19T10:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

function makeFakeRepo() {
  return {
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// CreateHouseholdUseCase
// ---------------------------------------------------------------------------

describe('CreateHouseholdUseCase', () => {
  let lastTxRun: jest.Mock;
  function makeDb() {
    // households insert AND the owner household_members insert are both raw
    // runInUnitOfWork writes sharing ONE transaction (atomicity fix). Only
    // baby_steps seeding (mocked above) goes through deps.repo. `lastTxRun`
    // captures the raw statements run inside that transaction.
    lastTxRun = jest.fn(() => ({ changes: 1 }));
    return {
      transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({ run: lastTxRun })),
    };
  }

  function makeAudit() {
    return { log: jest.fn().mockResolvedValue(undefined) };
  }

  it('succeeds with valid name and payday', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const repo = makeFakeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'My House', paydayDay: 25 },
      { repo },
    );
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My House');
      expect(result.data.paydayDay).toBe(25);
      expect(result.data.userLevel).toBe(1);
    }
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // household + owner-membership commit in ONE transaction now; baby steps
    // are mocked, so nothing goes through the injected synced-repo fake.
    expect(repo.insert).toHaveBeenCalledTimes(0);
    // 2 entity inserts + 2 oplog appends inside the single transaction.
    expect(lastTxRun).toHaveBeenCalledTimes(4);
  });

  it('trims whitespace from name', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const repo = makeFakeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: '  Trimmed  ', paydayDay: 15 },
      { repo },
    );
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Trimmed');
  });

  it('returns INVALID_NAME when name is empty', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const repo = makeFakeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: '', paydayDay: 15 },
      { repo },
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns INVALID_NAME when name is only whitespace', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const repo = makeFakeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: '   ', paydayDay: 15 },
      { repo },
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
  });

  it('returns INVALID_PAYDAY when payday is 0', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const repo = makeFakeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'House', paydayDay: 0 },
      { repo },
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('returns INVALID_PAYDAY when payday is 29', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const repo = makeFakeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'House', paydayDay: 29 },
      { repo },
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('accepts payday boundary value 1', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const repo = makeFakeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'House', paydayDay: 1 },
      { repo },
    );
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.paydayDay).toBe(1);
  });

  it('accepts payday boundary value 28', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const repo = makeFakeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'House', paydayDay: 28 },
      { repo },
    );
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.paydayDay).toBe(28);
  });

  it('inserts the owner household_members row inside the same unit of work', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const repo = makeFakeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'House', paydayDay: 15 },
      { repo },
    );
    await uc.execute();

    // The owner membership is now written raw inside the household transaction
    // (not via the injected synced-repo fake), so it commits atomically with
    // the household. Its entity insert + oplog op carry role='owner' and the
    // session user_id — assert on the raw statements the transaction ran.
    const runText = JSON.stringify(lastTxRun.mock.calls);
    expect(runText).toContain('household_members');
    expect(runText).toContain('owner');
    expect(runText).toContain('u1');
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AcceptInviteUseCase
// ---------------------------------------------------------------------------

describe('AcceptInviteUseCase', () => {
  function makeSupabase(joinResult: { data?: unknown; error?: { message: string } | null } = {}) {
    return {
      rpc: jest.fn().mockImplementation((name: string) => {
        if (name === 'join_household_via_invite') {
          return Promise.resolve(joinResult);
        }
        return Promise.resolve({ data: null, error: null });
      }),
      from: jest.fn(),
    };
  }

  function makeDb() {
    // `.values(...)` supports both the plain household_members insert (just
    // awaited directly) and the M10 fallback's `.onConflictDoUpdate(...)`
    // chain for the local `households` upsert.
    const valuesFn = jest.fn().mockReturnValue({
      onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
    });
    const insertFn = jest.fn().mockReturnValue({ values: valuesFn });
    return { insert: insertFn };
  }

  function makeRestoreService(result: any = null) {
    return {
      restoreHousehold: jest.fn().mockResolvedValue(result),
    };
  }

  it('succeeds with valid invite code', async () => {
    const supabase = makeSupabase({
      data: { member_id: 'member-1', household_id: 'hh-1' },
      error: null,
    });
    const db = makeDb();
    const restore = makeRestoreService({ id: 'hh-1', name: 'Test House', paydayDay: 25 });

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restore as any, {
      code: 'ABC123',
      userId: 'u2',
    });
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('hh-1');
      expect(result.data.name).toBe('Test House');
    }
  });

  it('uppercases the invite code before lookup', async () => {
    const supabase = makeSupabase({
      data: { member_id: 'member-1', household_id: 'hh-1' },
      error: null,
    });
    const db = makeDb();
    const restore = makeRestoreService({ id: 'hh-1', name: 'House', paydayDay: 25 });

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restore as any, {
      code: 'abc123',
      userId: 'u2',
    });
    await uc.execute();

    expect(supabase.rpc).toHaveBeenCalledWith('join_household_via_invite', {
      p_invite_code: 'ABC123',
    });
  });

  it('returns INVITE_NOT_FOUND when code does not exist', async () => {
    const supabase = makeSupabase({ data: null, error: { message: 'invite not found' } });
    const db = makeDb();
    const restore = makeRestoreService();

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restore as any, {
      code: 'BADCODE',
      userId: 'u2',
    });
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_NOT_FOUND');
  });

  it('returns INVITE_EXPIRED when invite is past expiry', async () => {
    const supabase = makeSupabase({ data: null, error: { message: 'invite expired' } });
    const db = makeDb();
    const restore = makeRestoreService();

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restore as any, {
      code: 'EXPIRED',
      userId: 'u2',
    });
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_EXPIRED');
  });

  it('returns INVITE_ALREADY_USED when used_by is set', async () => {
    const supabase = makeSupabase({ data: null, error: { message: 'invite already used' } });
    const db = makeDb();
    const restore = makeRestoreService();

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restore as any, {
      code: 'USED01',
      userId: 'u2',
    });
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_ALREADY_USED');
  });

  // M10 (exhaustive audit, 2026-07-05): when both RestoreService attempts
  // fail, the use case no longer fabricates paydayDay: 25 / name:
  // 'My Household' — it falls back to a direct household fetch (persisting
  // a local `households` row) or fails cleanly. This replaces the old
  // "returns fallback summary when restore fails" test, which asserted the
  // fabricated values.
  it('falls back to a direct household fetch (real data, never fabricated) when restore fails twice', async () => {
    jest.useRealTimers();
    const supabase = {
      rpc: jest.fn().mockImplementation((name: string) => {
        if (name === 'join_household_via_invite') {
          return Promise.resolve({
            data: { member_id: 'member-1', household_id: 'hh-1' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'households') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'hh-1',
                    name: 'The Real House',
                    payday_day: 12,
                    user_level: 1,
                    created_at: '2026-01-01T00:00:00.000Z',
                    updated_at: '2026-01-01T00:00:00.000Z',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };
    const db = makeDb();
    const restore = {
      restoreHousehold: jest.fn().mockRejectedValue(new Error('network')),
    };

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restore as any, {
      code: 'VALID1',
      userId: 'u2',
    });
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('hh-1');
      // The REAL fetched values — never the old fabricated 'My Household' / 25.
      expect(result.data.name).toBe('The Real House');
      expect(result.data.paydayDay).toBe(12);
    }
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-19T10:00:00.000Z'));
  }, 15000);

  it('returns a clean failure (never fabricated data) when restore fails twice AND the direct household fetch also fails', async () => {
    jest.useRealTimers();
    const supabase = {
      rpc: jest.fn().mockImplementation((name: string) => {
        if (name === 'join_household_via_invite') {
          return Promise.resolve({
            data: { member_id: 'member-1', household_id: 'hh-1' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'households') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'network error' },
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };
    const db = makeDb();
    const restore = {
      restoreHousehold: jest.fn().mockRejectedValue(new Error('network')),
    };

    const uc = new AcceptInviteUseCase(supabase as any, db as any, restore as any, {
      code: 'VALID1',
      userId: 'u2',
    });
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('HOUSEHOLD_RESTORE_FAILED');
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-19T10:00:00.000Z'));
  }, 15000);
});

// ---------------------------------------------------------------------------
// CreateInviteUseCase
// ---------------------------------------------------------------------------

describe('CreateInviteUseCase', () => {
  it('returns success with code and expiresAt on happy path', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { id: 'inv-1', code: 'ABC123', expires_at: '2026-06-21T10:00:00.000Z' },
      error: null,
    });
    const supabase = { rpc };

    const uc = new CreateInviteUseCase(supabase as any, {
      householdId: 'hh-1',
      createdByUserId: 'u1',
    });
    const result = await uc.execute();

    expect(rpc).toHaveBeenCalledWith('create_invitation', { p_household_id: 'hh-1' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('ABC123');
      expect(result.data.expiresAt).toBeTruthy();
    }
  });

  it('returns INVITE_CREATE_FAILED on supabase error', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'db error' } });
    const supabase = { rpc };

    const uc = new CreateInviteUseCase(supabase as any, {
      householdId: 'hh-1',
      createdByUserId: 'u1',
    });
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_CREATE_FAILED');
  });

  it('returns INVITE_CREATE_FAILED when data is null without error', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { rpc };

    const uc = new CreateInviteUseCase(supabase as any, {
      householdId: 'hh-1',
      createdByUserId: 'u1',
    });
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_CREATE_FAILED');
  });
});

// ---------------------------------------------------------------------------
// EnsureHouseholdUseCase
// ---------------------------------------------------------------------------

describe('EnsureHouseholdUseCase', () => {
  function makeDbWithMembership(household: Record<string, unknown> | null) {
    const memberRow = household
      ? { id: 'm1', householdId: household.id, userId: 'u1', role: 'owner' }
      : null;

    const limitFn = jest.fn();
    if (memberRow && household) {
      limitFn.mockResolvedValueOnce([memberRow]).mockResolvedValueOnce([household]);
    } else {
      limitFn.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    }

    const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });

    return { select: selectFn, _limitFn: limitFn };
  }

  function makeDbWithLegacy(legacyHousehold: Record<string, unknown>) {
    const limitFn = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([legacyHousehold]);

    const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });

    // Captures every raw SQL run inside the unit-of-work transaction — L1
    // (exhaustive audit) made the households catch-up op + owner
    // household_members insert commit atomically in ONE db.transaction()
    // call, so this test asserts against `txRun` rather than the
    // deps-injected synced-repo fake (which the legacy branch no longer
    // uses for the membership write).
    const txRun = jest.fn(() => ({ changes: 1 }));
    return {
      select: selectFn,
      transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({ run: txRun })),
      _txRun: txRun,
    };
  }

  it('returns existing household when membership exists', async () => {
    const hh = { id: 'hh-1', name: 'Existing', paydayDay: 20, userLevel: 2 };
    const db = makeDbWithMembership(hh);
    const uc = new EnsureHouseholdUseCase(db as any, 'u1');
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('hh-1');
      expect(result.data.name).toBe('Existing');
      expect(result.data.paydayDay).toBe(20);
      expect(result.data.userLevel).toBe(2);
    }
  });

  it('adopts legacy household when id=userId', async () => {
    const legacy = { id: 'u1', name: 'Legacy House', paydayDay: 25, userLevel: 1 };
    const db = makeDbWithLegacy(legacy);
    const repo = makeFakeRepo();
    const uc = new EnsureHouseholdUseCase(db as any, 'u1', { repo });
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('u1');
      expect(result.data.name).toBe('Legacy House');
    }

    // L1 (exhaustive audit): the households catch-up op and the owner
    // household_members insert now commit atomically in ONE
    // db.transaction() call (previously two separate transactions, member
    // op first — the reverse of the required bootstrap order).
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // Inside that one transaction: households oplog insert (1 run) + the
    // owner household_members raw INSERT + its oplog insert (2 runs) = 3.
    expect(db._txRun).toHaveBeenCalledTimes(3);
  });

  it('returns no_household when neither membership nor legacy exists', async () => {
    const db = makeDbWithMembership(null);
    const uc = new EnsureHouseholdUseCase(db as any, 'u-new');
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('no_household');
  });
});

// ---------------------------------------------------------------------------
// UpdateHouseholdPaydayDayUseCase
// ---------------------------------------------------------------------------

describe('UpdateHouseholdPaydayDayUseCase', () => {
  function makeDb() {
    return {
      transaction: jest.fn((fn: (tx: unknown) => unknown) =>
        fn({ run: jest.fn(() => ({ changes: 1 })) }),
      ),
    };
  }

  it('returns success for valid payday (1)', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, 'hh-1', 1);
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('returns success for valid payday (28)', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, 'hh-1', 28);
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('returns INVALID_PAYDAY for 0', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, 'hh-1', 0);
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('returns INVALID_PAYDAY for 29', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, 'hh-1', 29);
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('writes via one db.transaction (oplog, not pending_sync)', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, 'hh-1', 15);
    await uc.execute();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
