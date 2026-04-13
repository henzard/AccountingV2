import { SeedBabyStepsUseCase } from '../SeedBabyStepsUseCase';

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
// Test DB that tracks inserted rows by (householdId, stepNumber)
// ---------------------------------------------------------------------------

function makeDb(existingRows: { householdId: string; stepNumber: number }[] = []) {
  const rows = [...existingRows];

  const conflicting = new Set(existingRows.map((r) => `${r.householdId}:${r.stepNumber}`));

  const inserted: unknown[] = [];

  const onConflictDoNothing = jest.fn().mockImplementation(() => {
    // Resolve the most recently staged insert
    const lastRow = staged[staged.length - 1];
    if (lastRow) {
      const key = `${(lastRow as any).householdId}:${(lastRow as any).stepNumber}`;
      if (!conflicting.has(key)) {
        rows.push(lastRow as any);
        inserted.push(lastRow);
        conflicting.add(key);
      }
    }
    return Promise.resolve();
  });

  const staged: unknown[] = [];

  const values = jest.fn().mockImplementation((row: unknown) => {
    staged.push(row);
    return { onConflictDoNothing };
  });

  const insert = jest.fn().mockReturnValue({ values });

  return {
    insert,
    _rows: rows,
    _inserted: inserted,
    _onConflictDoNothing: onConflictDoNothing,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SeedBabyStepsUseCase', () => {
  const HOUSEHOLD_ID = 'h-test';

  it('empty DB → inserts all 7 rows', async () => {
    const db = makeDb();
    const uc = new SeedBabyStepsUseCase(db as any);
    await uc.execute(HOUSEHOLD_ID);

    expect(db._rows).toHaveLength(7);
    // All 7 step numbers present
    const stepNumbers = db._rows.map((r) => (r as any).stepNumber).sort();
    expect(stepNumbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('sets isManual=true only for steps 4, 5, 7', async () => {
    const db = makeDb();
    const uc = new SeedBabyStepsUseCase(db as any);
    await uc.execute(HOUSEHOLD_ID);

    const byStep = Object.fromEntries(
      db._rows.map((r) => [(r as any).stepNumber, r]),
    );
    expect((byStep[1] as any).isManual).toBe(false);
    expect((byStep[2] as any).isManual).toBe(false);
    expect((byStep[3] as any).isManual).toBe(false);
    expect((byStep[4] as any).isManual).toBe(true);
    expect((byStep[5] as any).isManual).toBe(true);
    expect((byStep[6] as any).isManual).toBe(false);
    expect((byStep[7] as any).isManual).toBe(true);
  });

  it('all inserted rows have isSynced=false', async () => {
    const db = makeDb();
    const uc = new SeedBabyStepsUseCase(db as any);
    await uc.execute(HOUSEHOLD_ID);

    for (const row of db._rows) {
      expect((row as any).isSynced).toBe(false);
    }
  });

  it('6 rows existing (step 5 missing) → only step 5 inserted', async () => {
    const existing = [1, 2, 3, 4, 6, 7].map((n) => ({ householdId: HOUSEHOLD_ID, stepNumber: n }));
    const db = makeDb(existing);
    const uc = new SeedBabyStepsUseCase(db as any);
    await uc.execute(HOUSEHOLD_ID);

    expect(db._rows).toHaveLength(7);
    expect(db._inserted).toHaveLength(1);
    expect((db._inserted[0] as any).stepNumber).toBe(5);
  });

  it('all 7 rows already exist → no-op (no new rows inserted)', async () => {
    const existing = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ householdId: HOUSEHOLD_ID, stepNumber: n }));
    const db = makeDb(existing);
    const uc = new SeedBabyStepsUseCase(db as any);
    await uc.execute(HOUSEHOLD_ID);

    expect(db._rows).toHaveLength(7);
    expect(db._inserted).toHaveLength(0);
  });

  it('Promise.all([seed, seed]) → final count = 7, no unhandled rejection', async () => {
    const db = makeDb();
    const uc = new SeedBabyStepsUseCase(db as any);

    await expect(Promise.all([uc.execute(HOUSEHOLD_ID), uc.execute(HOUSEHOLD_ID)])).resolves.not.toThrow();

    // Should have exactly 7 unique step numbers
    const stepNumbers = new Set(db._rows.map((r) => (r as any).stepNumber));
    expect(stepNumbers.size).toBe(7);
  });
});
