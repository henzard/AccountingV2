/**
 * ReconcileBabyStepsUseCase tests.
 *
 * Uses a simpler call-count-tracking mock: the first select() call is envelopes,
 * second is debts, third is baby_steps rows.
 *
 * Covers:
 * - complete → incomplete preserves celebrated_at
 * - re-complete after regression: celebrated_at already set (no re-trigger)
 * - every write has isSynced=false
 */

import { ReconcileBabyStepsUseCase } from '../ReconcileBabyStepsUseCase';

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-04-12T10:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeEnvelopeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    householdId: 'h1',
    name: 'Test',
    allocatedCents: 0,
    spentCents: 0,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBabyStepRow(stepNumber: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `bs-${stepNumber}`,
    householdId: 'h1',
    stepNumber,
    isCompleted: false,
    completedAt: null,
    isManual: [4, 5, 7].includes(stepNumber),
    celebratedAt: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    isSynced: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Simple sequential mock: select calls return envelopes, debts, baby_steps in order
// ---------------------------------------------------------------------------

function makeDb({
  envelopeRows = [] as Record<string, unknown>[],
  debtRows = [] as Record<string, unknown>[],
  babyStepRows = [] as Record<string, unknown>[],
} = {}) {
  const selectCallResults = [envelopeRows, debtRows, babyStepRows];
  let selectCallCount = 0;

  const updates: Array<{ set: Record<string, unknown> }> = [];

  const mockSelect = jest.fn(() => {
    const results = selectCallResults[selectCallCount++] ?? [];
    return {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(results),
      }),
    };
  });

  const mockWhereFnUpdate = jest.fn().mockResolvedValue(undefined);
  const mockSetFn = jest.fn().mockImplementation((setVal: Record<string, unknown>) => {
    updates.push({ set: setVal });
    return { where: mockWhereFnUpdate };
  });
  const mockUpdate = jest.fn().mockReturnValue({ set: mockSetFn });

  return {
    select: mockSelect,
    update: mockUpdate,
    _updates: updates,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReconcileBabyStepsUseCase', () => {
  const HOUSEHOLD_ID = 'h1';
  const PERIOD_START = '2026-04-01';

  it('returns newlyCompleted when a step transitions to complete', async () => {
    const envelopeRow = makeEnvelopeRow({
      envelopeType: 'emergency_fund',
      allocatedCents: 100_000,
      spentCents: 0,
    });
    const bsRows = [1, 2, 3, 4, 5, 6, 7].map((n) => makeBabyStepRow(n, { isCompleted: false }));

    const db = makeDb({
      envelopeRows: [envelopeRow],
      debtRows: [],
      babyStepRows: bsRows,
    });

    const uc = new ReconcileBabyStepsUseCase(db as any);
    const result = await uc.execute(HOUSEHOLD_ID, PERIOD_START);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.newlyCompleted).toContain(1);
    expect(result.data.newlyRegressed).toHaveLength(0);
  });

  it('regression: preserves celebrated_at when step goes from complete to incomplete', async () => {
    const celebratedAt = '2026-04-10T08:00:00.000Z';
    // EMF balance below R1,000 threshold
    const envelopeRow = makeEnvelopeRow({
      envelopeType: 'emergency_fund',
      allocatedCents: 99_999,
      spentCents: 0,
    });
    const bsRows = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      makeBabyStepRow(n, {
        isCompleted: n === 1,
        completedAt: n === 1 ? '2026-04-05T00:00:00.000Z' : null,
        celebratedAt: n === 1 ? celebratedAt : null,
      }),
    );

    const db = makeDb({
      envelopeRows: [envelopeRow],
      debtRows: [],
      babyStepRows: bsRows,
    });

    const uc = new ReconcileBabyStepsUseCase(db as any);
    const result = await uc.execute(HOUSEHOLD_ID, PERIOD_START);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.newlyRegressed).toContain(1);

    // The write should set isCompleted=false, completedAt=null but NOT touch celebratedAt
    const step1Update = db._updates.find(
      (u) => u.set.isCompleted === false && u.set.completedAt === null,
    );
    expect(step1Update).toBeDefined();
    // celebrated_at key should NOT be in the SET clause (it is preserved by not writing it)
    expect(step1Update?.set).not.toHaveProperty('celebratedAt');

    // The returned status should preserve celebratedAt from the persisted row
    const step1Status = result.data.statuses.find((s) => s.stepNumber === 1);
    expect(step1Status?.celebratedAt).toBe(celebratedAt);
  });

  it('re-complete after regression: celebrated_at already set, newlyCompleted includes step', async () => {
    const celebratedAt = '2026-04-10T08:00:00.000Z';
    // EMF above threshold again
    const envelopeRow = makeEnvelopeRow({
      envelopeType: 'emergency_fund',
      allocatedCents: 100_000,
      spentCents: 0,
    });
    // After regression: isCompleted=false but celebratedAt still stamped
    const bsRows = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      makeBabyStepRow(n, {
        isCompleted: false,
        completedAt: null,
        celebratedAt: n === 1 ? celebratedAt : null,
      }),
    );

    const db = makeDb({
      envelopeRows: [envelopeRow],
      debtRows: [],
      babyStepRows: bsRows,
    });

    const uc = new ReconcileBabyStepsUseCase(db as any);
    const result = await uc.execute(HOUSEHOLD_ID, PERIOD_START);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.newlyCompleted).toContain(1);

    // Re-completion write should NOT include celebratedAt in the SET
    const step1Update = db._updates.find((u) => u.set.isCompleted === true);
    expect(step1Update).toBeDefined();
    expect(step1Update?.set).not.toHaveProperty('celebratedAt');

    // The returned status preserves the existing celebratedAt
    const step1Status = result.data.statuses.find((s) => s.stepNumber === 1);
    expect(step1Status?.celebratedAt).toBe(celebratedAt);
  });

  it('every write has isSynced=false', async () => {
    const envelopeRow = makeEnvelopeRow({
      envelopeType: 'emergency_fund',
      allocatedCents: 100_000,
      spentCents: 0,
    });
    const bsRows = [1, 2, 3, 4, 5, 6, 7].map((n) => makeBabyStepRow(n, { isCompleted: false }));

    const db = makeDb({
      envelopeRows: [envelopeRow],
      debtRows: [],
      babyStepRows: bsRows,
    });

    const uc = new ReconcileBabyStepsUseCase(db as any);
    await uc.execute(HOUSEHOLD_ID, PERIOD_START);

    for (const update of db._updates) {
      expect(update.set.isSynced).toBe(false);
    }
  });

  it('no transitions when state unchanged → no DB writes', async () => {
    // Step 1 already complete and conditions still met
    const envelopeRow = makeEnvelopeRow({
      envelopeType: 'emergency_fund',
      allocatedCents: 100_000,
      spentCents: 0,
    });
    const bsRows = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      makeBabyStepRow(n, { isCompleted: n === 1 }),
    );

    const db = makeDb({
      envelopeRows: [envelopeRow],
      debtRows: [],
      babyStepRows: bsRows,
    });

    const uc = new ReconcileBabyStepsUseCase(db as any);
    const result = await uc.execute(HOUSEHOLD_ID, PERIOD_START);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.newlyCompleted).toHaveLength(0);
    expect(result.data.newlyRegressed).toHaveLength(0);
    expect(db._updates).toHaveLength(0);
  });
});
