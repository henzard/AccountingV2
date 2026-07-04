/**
 * ReconcileBabyStepsUseCase tests.
 *
 * Uses a simpler call-count-tracking mock: the first select() call is envelopes,
 * second is debts, third is baby_steps rows. Writes go through a fake
 * `SyncedRepo` (injected via deps.repo) rather than a mocked db.update chain,
 * since the use case now writes baby_steps transitions via the oplog synced
 * repo instead of a raw drizzle update.
 *
 * Covers:
 * - complete → incomplete preserves celebrated_at
 * - re-complete after regression: celebrated_at already set (no re-trigger)
 *
 * getEnvelopeSpentCents is mocked out — its correctness is covered by
 * EnvelopeBalanceQuery's own unit/realsql tests. Every envelope fixture here
 * uses spentCents: 0, so an empty Map (spentCents defaults to 0 per envelope)
 * reproduces the same inputs to BudgetBalanceCalculator/BabyStepEvaluator.
 *
 * envelopeScopeCondition is stubbed to a harmless placeholder value (rather
 * than left unmocked/undefined) — this test's `db.select().from().where()`
 * mock ignores whatever condition object is passed to `.where()` entirely
 * (it just returns the fixture rows for that call index), so the real
 * period/persistent-scope SQL predicate is irrelevant here; only the
 * envelope-row-query realsql tests (`tests/realsql/babyStepRolloverRegression.test.ts`)
 * exercise the real predicate against a real SQLite engine.
 */

import { ReconcileBabyStepsUseCase } from '../ReconcileBabyStepsUseCase';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';

jest.mock('../../../data/local/balances/EnvelopeBalanceQuery', () => ({
  getEnvelopeSpentCents: jest.fn().mockResolvedValue(new Map()),
  envelopeScopeCondition: jest.fn(() => 'scope-condition'),
}));

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
    ...overrides,
  };
}

function makeFakeRepo(): SyncedRepo & {
  insert: jest.Mock;
  update: jest.Mock;
  softDelete: jest.Mock;
  increment: jest.Mock;
} {
  return {
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
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

  const mockSelect = jest.fn(() => {
    const results = selectCallResults[selectCallCount++] ?? [];
    return {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(results),
      }),
    };
  });

  return { select: mockSelect };
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
    const repo = makeFakeRepo();

    const uc = new ReconcileBabyStepsUseCase(db as any, { repo });
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
    const repo = makeFakeRepo();

    const uc = new ReconcileBabyStepsUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID, PERIOD_START);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.newlyRegressed).toContain(1);

    // The write should set is_completed=0, completed_at=null but NOT touch celebrated_at
    const step1Update = repo.update.mock.calls.find(
      (call) => call[0] === 'bs-1' && call[2].is_completed === 0 && call[2].completed_at === null,
    );
    expect(step1Update).toBeDefined();
    // celebrated_at key should NOT be in the payload (it is preserved by not writing it)
    expect(step1Update?.[2]).not.toHaveProperty('celebrated_at');

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
    const repo = makeFakeRepo();

    const uc = new ReconcileBabyStepsUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID, PERIOD_START);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.newlyCompleted).toContain(1);

    // Re-completion write should NOT include celebrated_at in the payload
    const step1Update = repo.update.mock.calls.find(
      (call) => call[0] === 'bs-1' && call[2].is_completed === 1,
    );
    expect(step1Update).toBeDefined();
    expect(step1Update?.[2]).not.toHaveProperty('celebrated_at');

    // The returned status preserves the existing celebratedAt
    const step1Status = result.data.statuses.find((s) => s.stepNumber === 1);
    expect(step1Status?.celebratedAt).toBe(celebratedAt);
  });

  it('every write stamps updated_at', async () => {
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
    const repo = makeFakeRepo();

    const uc = new ReconcileBabyStepsUseCase(db as any, { repo });
    await uc.execute(HOUSEHOLD_ID, PERIOD_START);

    expect(repo.update.mock.calls.length).toBeGreaterThan(0);
    for (const call of repo.update.mock.calls) {
      expect(call[2].updated_at).toBeTruthy();
      expect(call[2]).not.toHaveProperty('isSynced');
    }
  });

  it('no transitions when state unchanged → no synced-repo writes', async () => {
    // Step 1 already complete and conditions still met
    const envelopeRow = makeEnvelopeRow({
      envelopeType: 'emergency_fund',
      allocatedCents: 100_000,
      spentCents: 0,
    });
    const bsRows = [1, 2, 3, 4, 5, 6, 7].map((n) => makeBabyStepRow(n, { isCompleted: n === 1 }));

    const db = makeDb({
      envelopeRows: [envelopeRow],
      debtRows: [],
      babyStepRows: bsRows,
    });
    const repo = makeFakeRepo();

    const uc = new ReconcileBabyStepsUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID, PERIOD_START);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.newlyCompleted).toHaveLength(0);
    expect(result.data.newlyRegressed).toHaveLength(0);
    expect(repo.update).not.toHaveBeenCalled();
  });
});
