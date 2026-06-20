import { CreateHouseholdUseCase } from '../CreateHouseholdUseCase';
import { AcceptInviteUseCase } from '../AcceptInviteUseCase';
import { CreateInviteUseCase } from '../CreateInviteUseCase';
import { EnsureHouseholdUseCase } from '../EnsureHouseholdUseCase';
import { UpdateHouseholdPaydayDayUseCase } from '../UpdateHouseholdPaydayDayUseCase';
import type { ISyncEnqueuer } from '../../ports/ISyncEnqueuer';

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

function makeEnqueuer(): ISyncEnqueuer & { enqueue: jest.Mock } {
  return { enqueue: jest.fn().mockResolvedValue(undefined) };
}

// ---------------------------------------------------------------------------
// CreateHouseholdUseCase
// ---------------------------------------------------------------------------

describe('CreateHouseholdUseCase', () => {
  function makeDb() {
    const valuesFn = jest.fn().mockResolvedValue(undefined);
    const insertFn = jest.fn().mockReturnValue({ values: valuesFn });
    return { insert: insertFn, _values: valuesFn };
  }

  function makeRepo() {
    return { insert: jest.fn().mockResolvedValue(undefined) };
  }

  function makeAudit() {
    return { log: jest.fn().mockResolvedValue(undefined) };
  }

  it('succeeds with valid name and payday', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const repo = makeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'My House', paydayDay: 25 },
      enqueuer,
      repo as any,
    );
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My House');
      expect(result.data.paydayDay).toBe(25);
      expect(result.data.userLevel).toBe(1);
    }
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(enqueuer.enqueue).toHaveBeenCalledTimes(2);
  });

  it('trims whitespace from name', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const repo = makeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: '  Trimmed  ', paydayDay: 15 },
      enqueuer,
      repo as any,
    );
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Trimmed');
  });

  it('returns INVALID_NAME when name is empty', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const repo = makeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: '', paydayDay: 15 },
      enqueuer,
      repo as any,
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('returns INVALID_NAME when name is only whitespace', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const repo = makeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: '   ', paydayDay: 15 },
      enqueuer,
      repo as any,
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
  });

  it('returns INVALID_PAYDAY when payday is 0', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const repo = makeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'House', paydayDay: 0 },
      enqueuer,
      repo as any,
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('returns INVALID_PAYDAY when payday is 29', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const repo = makeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'House', paydayDay: 29 },
      enqueuer,
      repo as any,
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('accepts payday boundary value 1', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const repo = makeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'House', paydayDay: 1 },
      enqueuer,
      repo as any,
    );
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.paydayDay).toBe(1);
  });

  it('accepts payday boundary value 28', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const repo = makeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'House', paydayDay: 28 },
      enqueuer,
      repo as any,
    );
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.paydayDay).toBe(28);
  });

  it('enqueues both household and member inserts', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const repo = makeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      audit as any,
      { userId: 'u1', name: 'House', paydayDay: 15 },
      enqueuer,
      repo as any,
    );
    await uc.execute();

    expect(enqueuer.enqueue).toHaveBeenCalledWith('households', expect.any(String), 'INSERT');
    expect(enqueuer.enqueue).toHaveBeenCalledWith(
      'household_members',
      expect.any(String),
      'INSERT',
    );
  });
});

// ---------------------------------------------------------------------------
// AcceptInviteUseCase
// ---------------------------------------------------------------------------

describe('AcceptInviteUseCase', () => {
  function makeSupabase(rpcResult: any, insertResult: any = {}, claimResult: any = {}) {
    return {
      rpc: jest.fn().mockImplementation((name: string) => {
        if (name === 'lookup_invite_by_code') {
          return { single: jest.fn().mockResolvedValue(rpcResult) };
        }
        if (name === 'claim_invite') {
          return Promise.resolve(claimResult);
        }
        return { single: jest.fn().mockResolvedValue({ data: null, error: null }) };
      }),
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue(insertResult),
      }),
    };
  }

  function makeDb() {
    const valuesFn = jest.fn().mockResolvedValue(undefined);
    const insertFn = jest.fn().mockReturnValue({ values: valuesFn });
    return { insert: insertFn };
  }

  function makeRestoreService(result: any = null) {
    return {
      restoreHousehold: jest.fn().mockResolvedValue(result),
    };
  }

  it('succeeds with valid invite code', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const supabase = makeSupabase(
      {
        data: { id: 'inv-1', household_id: 'hh-1', expires_at: futureDate, used_by: null },
        error: null,
      },
      { error: null },
      { error: null },
    );
    const db = makeDb();
    const restore = makeRestoreService({ id: 'hh-1', name: 'Test House', paydayDay: 25 });
    const enqueuer = makeEnqueuer();

    const uc = new AcceptInviteUseCase(
      supabase as any,
      db as any,
      restore as any,
      { code: 'ABC123', userId: 'u2' },
      enqueuer,
    );
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('hh-1');
      expect(result.data.name).toBe('Test House');
    }
  });

  it('uppercases the invite code before lookup', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const supabase = makeSupabase(
      {
        data: { id: 'inv-1', household_id: 'hh-1', expires_at: futureDate, used_by: null },
        error: null,
      },
      { error: null },
      { error: null },
    );
    const db = makeDb();
    const restore = makeRestoreService({ id: 'hh-1', name: 'House', paydayDay: 25 });
    const enqueuer = makeEnqueuer();

    const uc = new AcceptInviteUseCase(
      supabase as any,
      db as any,
      restore as any,
      { code: 'abc123', userId: 'u2' },
      enqueuer,
    );
    await uc.execute();

    expect(supabase.rpc).toHaveBeenCalledWith('lookup_invite_by_code', { invite_code: 'ABC123' });
  });

  it('returns INVITE_NOT_FOUND when code does not exist', async () => {
    const supabase = makeSupabase({ data: null, error: { message: 'not found' } });
    const db = makeDb();
    const restore = makeRestoreService();
    const enqueuer = makeEnqueuer();

    const uc = new AcceptInviteUseCase(
      supabase as any,
      db as any,
      restore as any,
      { code: 'BADCODE', userId: 'u2' },
      enqueuer,
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_NOT_FOUND');
  });

  it('returns INVITE_EXPIRED when invite is past expiry', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const supabase = makeSupabase({
      data: { id: 'inv-1', household_id: 'hh-1', expires_at: pastDate, used_by: null },
      error: null,
    });
    const db = makeDb();
    const restore = makeRestoreService();
    const enqueuer = makeEnqueuer();

    const uc = new AcceptInviteUseCase(
      supabase as any,
      db as any,
      restore as any,
      { code: 'EXPIRED', userId: 'u2' },
      enqueuer,
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_EXPIRED');
  });

  it('returns INVITE_ALREADY_USED when used_by is set', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const supabase = makeSupabase({
      data: { id: 'inv-1', household_id: 'hh-1', expires_at: futureDate, used_by: 'u-other' },
      error: null,
    });
    const db = makeDb();
    const restore = makeRestoreService();
    const enqueuer = makeEnqueuer();

    const uc = new AcceptInviteUseCase(
      supabase as any,
      db as any,
      restore as any,
      { code: 'USED01', userId: 'u2' },
      enqueuer,
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_ALREADY_USED');
  });

  it('returns fallback summary when restore fails', async () => {
    jest.useRealTimers();
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const supabase = makeSupabase(
      {
        data: { id: 'inv-1', household_id: 'hh-1', expires_at: futureDate, used_by: null },
        error: null,
      },
      { error: null },
      { error: null },
    );
    const db = makeDb();
    const restore = {
      restoreHousehold: jest.fn().mockRejectedValue(new Error('network')),
    };
    const enqueuer = makeEnqueuer();

    const uc = new AcceptInviteUseCase(
      supabase as any,
      db as any,
      restore as any,
      { code: 'VALID1', userId: 'u2' },
      enqueuer,
    );
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('hh-1');
      expect(result.data.name).toBe('My Household');
      expect(result.data.paydayDay).toBe(25);
    }
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-19T10:00:00.000Z'));
  }, 15000);
});

// ---------------------------------------------------------------------------
// CreateInviteUseCase
// ---------------------------------------------------------------------------

describe('CreateInviteUseCase', () => {
  it('returns success with code and expiresAt on happy path', async () => {
    const supabase = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { code: 'ABC123', expires_at: '2026-06-21T10:00:00.000Z' },
              error: null,
            }),
          }),
        }),
      }),
    };

    const uc = new CreateInviteUseCase(supabase as any, {
      householdId: 'hh-1',
      createdByUserId: 'u1',
    });
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('ABC123');
      expect(result.data.expiresAt).toBeTruthy();
    }
  });

  it('returns INVITE_CREATE_FAILED on supabase error', async () => {
    const supabase = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'db error' },
            }),
          }),
        }),
      }),
    };

    const uc = new CreateInviteUseCase(supabase as any, {
      householdId: 'hh-1',
      createdByUserId: 'u1',
    });
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_CREATE_FAILED');
  });

  it('returns INVITE_CREATE_FAILED when data is null without error', async () => {
    const supabase = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    };

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

    const valuesFn = jest.fn().mockResolvedValue(undefined);
    const insertFn = jest.fn().mockReturnValue({ values: valuesFn });

    return { select: selectFn, insert: insertFn, _limitFn: limitFn };
  }

  function makeDbWithLegacy(legacyHousehold: Record<string, unknown>) {
    const limitFn = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([legacyHousehold]);

    const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });

    const valuesFn = jest.fn().mockResolvedValue(undefined);
    const insertFn = jest.fn().mockReturnValue({ values: valuesFn });

    return { select: selectFn, insert: insertFn, _valuesFn: valuesFn };
  }

  it('returns existing household when membership exists', async () => {
    const hh = { id: 'hh-1', name: 'Existing', paydayDay: 20, userLevel: 2 };
    const db = makeDbWithMembership(hh);
    const enqueuer = makeEnqueuer();
    const uc = new EnsureHouseholdUseCase(db as any, 'u1', enqueuer);
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
    const enqueuer = makeEnqueuer();
    const uc = new EnsureHouseholdUseCase(db as any, 'u1', enqueuer);
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('u1');
      expect(result.data.name).toBe('Legacy House');
    }
    expect(enqueuer.enqueue).toHaveBeenCalledWith(
      'household_members',
      expect.any(String),
      'INSERT',
    );
    expect(enqueuer.enqueue).toHaveBeenCalledWith('households', 'u1', 'INSERT');
  });

  it('returns no_household when neither membership nor legacy exists', async () => {
    const db = makeDbWithMembership(null);
    const enqueuer = makeEnqueuer();
    const uc = new EnsureHouseholdUseCase(db as any, 'u-new', enqueuer);
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
    const whereFn = jest.fn().mockResolvedValue(undefined);
    const setFn = jest.fn().mockReturnValue({ where: whereFn });
    const updateFn = jest.fn().mockReturnValue({ set: setFn });
    return { update: updateFn, _setFn: setFn };
  }

  it('returns success for valid payday (1)', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, 'hh-1', 1, enqueuer);
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('returns success for valid payday (28)', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, 'hh-1', 28, enqueuer);
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('returns INVALID_PAYDAY for 0', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, 'hh-1', 0, enqueuer);
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('returns INVALID_PAYDAY for 29', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, 'hh-1', 29, enqueuer);
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('enqueues UPDATE after successful write', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, 'hh-1', 15, enqueuer);
    await uc.execute();
    expect(enqueuer.enqueue).toHaveBeenCalledWith('households', 'hh-1', 'UPDATE');
  });
});
