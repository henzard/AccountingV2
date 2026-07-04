import { SeedBabyStepsUseCase } from '../SeedBabyStepsUseCase';
import { isUniqueConstraintError } from '../../../data/uow/createSyncedRepo';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn().mockImplementation(() => 'uuid-' + Math.random().toString(36).slice(2)),
}));

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-04-12T00:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Test DB: only the existence-check `select` is real; writes go through a
// fake SyncedRepo (injected via deps.repo) that tracks inserted rows keyed
// by (household_id, step_number), rejecting a duplicate with the same
// UNIQUE-constraint-shaped error `createSyncedRepo` raises — so the
// use case's own race-safety catch is exercised for real.
// ---------------------------------------------------------------------------

function makeDb(existingRows: { householdId: string; stepNumber: number }[] = []) {
  const whereFn = jest
    .fn()
    .mockResolvedValue(existingRows.map((r) => ({ stepNumber: r.stepNumber })));
  const fromFn = jest.fn().mockReturnValue({ where: whereFn });
  const selectFn = jest.fn().mockReturnValue({ from: fromFn });
  return { select: selectFn };
}

function makeFakeRepo(existingRows: { householdId: string; stepNumber: number }[] = []) {
  const rows = [...existingRows];
  const conflicting = new Set(existingRows.map((r) => `${r.householdId}:${r.stepNumber}`));
  const inserted: any[] = [];

  const insert = jest.fn().mockImplementation((row: any) => {
    const key = `${row.household_id}:${row.step_number}`;
    if (conflicting.has(key)) {
      throw new Error('UNIQUE constraint failed: baby_steps.household_id, baby_steps.step_number');
    }
    conflicting.add(key);
    rows.push({ householdId: row.household_id, stepNumber: row.step_number });
    inserted.push(row);
  });

  return {
    insert,
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
    _rows: rows,
    _inserted: inserted,
  };
}

describe('SeedBabyStepsUseCase', () => {
  const HOUSEHOLD_ID = 'h-test';

  it('empty DB → inserts all 7 rows via the synced repo', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new SeedBabyStepsUseCase(db as any, { repo: repo as any });
    await uc.execute(HOUSEHOLD_ID);

    expect(repo._rows).toHaveLength(7);
    const stepNumbers = repo._inserted.map((r) => r.step_number).sort();
    expect(stepNumbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('sets is_manual=1 only for steps 4, 5, 7', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new SeedBabyStepsUseCase(db as any, { repo: repo as any });
    await uc.execute(HOUSEHOLD_ID);

    const byStep = Object.fromEntries(repo._inserted.map((r) => [r.step_number, r]));
    expect(byStep[1].is_manual).toBe(0);
    expect(byStep[2].is_manual).toBe(0);
    expect(byStep[3].is_manual).toBe(0);
    expect(byStep[4].is_manual).toBe(1);
    expect(byStep[5].is_manual).toBe(1);
    expect(byStep[6].is_manual).toBe(0);
    expect(byStep[7].is_manual).toBe(1);
  });

  it('all inserted rows have the expected household and creation timestamps', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new SeedBabyStepsUseCase(db as any, { repo: repo as any });
    await uc.execute(HOUSEHOLD_ID);

    for (const row of repo._inserted) {
      expect(row.household_id).toBe(HOUSEHOLD_ID);
      expect(row.created_at).toBeTruthy();
    }
  });

  it('6 rows existing (step 5 missing) → only step 5 inserted', async () => {
    const existing = [1, 2, 3, 4, 6, 7].map((n) => ({ householdId: HOUSEHOLD_ID, stepNumber: n }));
    const db = makeDb(existing);
    const repo = makeFakeRepo(existing);
    const uc = new SeedBabyStepsUseCase(db as any, { repo: repo as any });
    await uc.execute(HOUSEHOLD_ID);

    expect(repo._rows).toHaveLength(7);
    expect(repo._inserted).toHaveLength(1);
    expect(repo._inserted[0].step_number).toBe(5);
  });

  it('all 7 rows already exist → no-op (no new rows inserted)', async () => {
    const existing = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      householdId: HOUSEHOLD_ID,
      stepNumber: n,
    }));
    const db = makeDb(existing);
    const repo = makeFakeRepo(existing);
    const uc = new SeedBabyStepsUseCase(db as any, { repo: repo as any });
    await uc.execute(HOUSEHOLD_ID);

    expect(repo._rows).toHaveLength(7);
    expect(repo._inserted).toHaveLength(0);
  });

  it('a same-device race (duplicate insert) is swallowed as idempotent, not an error', async () => {
    // Simulates a step already present by the time the insert actually runs
    // (even though the existence pre-check said it was missing) — the
    // use case must catch the UNIQUE violation and continue, not fail.
    const db = makeDb();
    const repo = makeFakeRepo([{ householdId: HOUSEHOLD_ID, stepNumber: 1 }]);
    const uc = new SeedBabyStepsUseCase(db as any, { repo: repo as any });

    const result = await uc.execute(HOUSEHOLD_ID);
    expect(result.success).toBe(true);
    // Step 1 was "already there" per the repo fake, so only 6 new inserts happen.
    expect(repo._inserted).toHaveLength(6);
  });

  it('isUniqueConstraintError recognizes the message the fake repo throws', () => {
    expect(
      isUniqueConstraintError(
        new Error('UNIQUE constraint failed: baby_steps.household_id, baby_steps.step_number'),
      ),
    ).toBe(true);
  });
});
