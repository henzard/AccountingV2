/**
 * BabyStepEvaluator — 35-scenario table-driven test matrix.
 *
 * From spec §Testing / Explicit step × state matrix:
 * | Step | Pre-threshold | At threshold − 1 cent | At threshold exactly | At threshold + 1 cent | Regression | No source data |
 *
 * Fixed date: 2026-04-12.
 */

import { evaluate } from '../BabyStepEvaluator';
import type { EvaluatorInput } from '../BabyStepEvaluator';
import type { EnvelopeEntity } from '../../envelopes/EnvelopeEntity';
import type { DebtEntity } from '../../debtSnowball/DebtEntity';

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-04-12'));
});

afterAll(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnvelope(
  overrides: Partial<EnvelopeEntity> & { envelopeType: EnvelopeEntity['envelopeType'] },
): EnvelopeEntity {
  return {
    id: 'e-' + Math.random().toString(36).slice(2),
    householdId: 'h1',
    name: 'Test',
    allocatedCents: 0,
    spentCents: 0,
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDebt(overrides: Partial<DebtEntity>): DebtEntity {
  return {
    id: 'd-' + Math.random().toString(36).slice(2),
    householdId: 'h1',
    creditorName: 'FNB',
    debtType: 'credit_card',
    outstandingBalanceCents: 100000,
    initialBalanceCents: 100000,
    interestRatePercent: 20,
    minimumPaymentCents: 1000,
    sortOrder: 0,
    isPaidOff: false,
    totalPaidCents: 0,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    isSynced: true,
    ...overrides,
  };
}

const DEFAULT_MANUAL_FLAGS: EvaluatorInput['manualFlags'] = { 4: false, 5: false, 7: false };

const NO_DEBTS: DebtEntity[] = [];
const STEP1_TARGET = 100_000; // R1,000 in cents
const INCOME_CENTS = 1_000_000; // R10,000 / month income
// monthlyExpenseBaseline = INCOME_CENTS / 100 = 10000 (ZAR)
// Step 3 target = 3 * 10000 * 100 = 3_000_000 cents = R30,000
const MONTHLY_BASELINE = INCOME_CENTS / 100; // 10000 ZAR
const STEP3_TARGET = 3 * MONTHLY_BASELINE * 100; // 3_000_000 cents

// ---------------------------------------------------------------------------
// Step 1 — Starter Fund (auto, threshold = 100_000 cents)
// ---------------------------------------------------------------------------

describe('Step 1 — Starter Fund', () => {
  function makeInput(emfBalance: number, allocated: number): EvaluatorInput {
    const emf = makeEnvelope({
      envelopeType: 'emergency_fund',
      allocatedCents: allocated,
      spentCents: allocated - emfBalance, // balance = allocated - spent
    });
    return {
      envelopes: [emf],
      debts: NO_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };
  }

  it('pre-threshold: balance well below R1,000 → incomplete', () => {
    const result = evaluate(makeInput(50_000, 50_000));
    expect(result[0].isCompleted).toBe(false);
    expect(result[0].progress?.current).toBe(50_000);
    expect(result[0].progress?.target).toBe(STEP1_TARGET);
  });

  it('at threshold − 1 cent: balance = 99,999 → incomplete', () => {
    const result = evaluate(makeInput(99_999, 99_999));
    expect(result[0].isCompleted).toBe(false);
    expect(result[0].progress?.current).toBe(99_999);
  });

  it('at threshold exactly: balance = 100,000 → complete', () => {
    const result = evaluate(makeInput(100_000, 100_000));
    expect(result[0].isCompleted).toBe(true);
    expect(result[0].progress?.current).toBe(100_000);
  });

  it('at threshold + 1 cent: balance = 100,001 → complete', () => {
    const result = evaluate(makeInput(100_001, 100_001));
    expect(result[0].isCompleted).toBe(true);
  });

  it('regression: was complete, balance drops to 99,999 → incomplete', () => {
    // Simulates a withdrawal that reduces EMF below threshold
    const result = evaluate(makeInput(99_999, 100_000));
    expect(result[0].isCompleted).toBe(false);
  });

  it('no EMF envelope → progress = null, incomplete', () => {
    const input: EvaluatorInput = {
      envelopes: [],
      debts: NO_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };
    const result = evaluate(input);
    expect(result[0].isCompleted).toBe(false);
    expect(result[0].progress).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Step 2 — Debt Free (auto, non-bond debts)
// ---------------------------------------------------------------------------

describe('Step 2 — Debt Free', () => {
  function makeInput(debts: DebtEntity[]): EvaluatorInput {
    return { envelopes: [], debts, monthlyExpenseBaseline: 0, manualFlags: DEFAULT_MANUAL_FLAGS };
  }

  it('pre-threshold: some debts paid, others outstanding → incomplete', () => {
    const debts = [
      makeDebt({ debtType: 'credit_card', isPaidOff: true, outstandingBalanceCents: 0 }),
      makeDebt({ debtType: 'personal_loan', isPaidOff: false, outstandingBalanceCents: 50000 }),
    ];
    const result = evaluate(makeInput(debts));
    expect(result[1].isCompleted).toBe(false);
    expect(result[1].progress).toEqual({ current: 1, target: 2, unit: 'count' });
  });

  it('at threshold − 1: all but one debt paid → incomplete', () => {
    const debts = [
      makeDebt({ debtType: 'credit_card', isPaidOff: true, outstandingBalanceCents: 0 }),
      makeDebt({ debtType: 'personal_loan', isPaidOff: true, outstandingBalanceCents: 0 }),
      makeDebt({ debtType: 'store_account', isPaidOff: false, outstandingBalanceCents: 100 }),
    ];
    const result = evaluate(makeInput(debts));
    expect(result[1].isCompleted).toBe(false);
    expect(result[1].progress).toEqual({ current: 2, target: 3, unit: 'count' });
  });

  it('at threshold: all non-bond debts paid + at least one existed → complete', () => {
    const debts = [
      makeDebt({ debtType: 'credit_card', isPaidOff: true, outstandingBalanceCents: 0 }),
      makeDebt({ debtType: 'personal_loan', isPaidOff: false, outstandingBalanceCents: 0 }),
    ];
    const result = evaluate(makeInput(debts));
    // Second debt has outstandingBalanceCents=0 so it counts as paid
    expect(result[1].isCompleted).toBe(true);
    expect(result[1].progress).toEqual({ current: 2, target: 2, unit: 'count' });
  });

  it('at threshold + 1: all non-bond debts clearly paid → complete', () => {
    const debts = [
      makeDebt({ debtType: 'credit_card', isPaidOff: true, outstandingBalanceCents: 0 }),
    ];
    const result = evaluate(makeInput(debts));
    expect(result[1].isCompleted).toBe(true);
  });

  it('regression: a previously paid debt becomes outstanding again → incomplete', () => {
    const debts = [
      makeDebt({ debtType: 'credit_card', isPaidOff: false, outstandingBalanceCents: 5000 }),
    ];
    const result = evaluate(makeInput(debts));
    expect(result[1].isCompleted).toBe(false);
    expect(result[1].progress).toEqual({ current: 0, target: 1, unit: 'count' });
  });

  it('no non-bond debts → progress = null, incomplete', () => {
    const debts = [
      makeDebt({ debtType: 'bond', isPaidOff: false, outstandingBalanceCents: 500000 }),
    ];
    const result = evaluate(makeInput(debts));
    expect(result[1].isCompleted).toBe(false);
    expect(result[1].progress).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Step 3 — Full Emergency Fund (auto, threshold = 3 × monthly baseline)
// ---------------------------------------------------------------------------

describe('Step 3 — Full Emergency Fund', () => {
  function makeInput(
    emfBalance: number,
    incomeAllocated: number,
    baseline: number,
  ): EvaluatorInput {
    const emf = makeEnvelope({
      envelopeType: 'emergency_fund',
      allocatedCents: emfBalance,
      spentCents: 0,
    });
    const income = makeEnvelope({
      envelopeType: 'income',
      allocatedCents: incomeAllocated,
      spentCents: 0,
    });
    return {
      envelopes: [emf, income],
      debts: NO_DEBTS,
      monthlyExpenseBaseline: baseline,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };
  }

  it('pre-threshold: EMF balance well below 3 months → incomplete', () => {
    const result = evaluate(makeInput(1_000_000, INCOME_CENTS, MONTHLY_BASELINE));
    expect(result[2].isCompleted).toBe(false);
    expect(result[2].progress?.current).toBe(1_000_000);
    expect(result[2].progress?.target).toBe(STEP3_TARGET);
  });

  it('at threshold − 1 cent: EMF balance = 3_000_000 - 1 → incomplete', () => {
    const result = evaluate(makeInput(STEP3_TARGET - 1, INCOME_CENTS, MONTHLY_BASELINE));
    expect(result[2].isCompleted).toBe(false);
    expect(result[2].progress?.current).toBe(STEP3_TARGET - 1);
  });

  it('at threshold exactly: EMF balance = 3_000_000 → complete', () => {
    const result = evaluate(makeInput(STEP3_TARGET, INCOME_CENTS, MONTHLY_BASELINE));
    expect(result[2].isCompleted).toBe(true);
    expect(result[2].progress?.current).toBe(STEP3_TARGET);
  });

  it('at threshold + 1 cent: EMF balance = 3_000_001 → complete', () => {
    const result = evaluate(makeInput(STEP3_TARGET + 1, INCOME_CENTS, MONTHLY_BASELINE));
    expect(result[2].isCompleted).toBe(true);
  });

  it('regression: EMF falls below 3 months baseline → incomplete', () => {
    // Start above, then drop below
    const result = evaluate(makeInput(STEP3_TARGET - 1, INCOME_CENTS, MONTHLY_BASELINE));
    expect(result[2].isCompleted).toBe(false);
  });

  it('INCOME_TOTAL = 0 → progress = null, never auto-completes', () => {
    const emf = makeEnvelope({
      envelopeType: 'emergency_fund',
      allocatedCents: 9_999_999,
      spentCents: 0,
    });
    const input: EvaluatorInput = {
      envelopes: [emf],
      debts: NO_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };
    const result = evaluate(input);
    expect(result[2].isCompleted).toBe(false);
    expect(result[2].progress).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Steps 4, 5, 7 — Manual steps
// ---------------------------------------------------------------------------

describe('Step 4 — Invest 15% (manual)', () => {
  const input: EvaluatorInput = {
    envelopes: [],
    debts: NO_DEBTS,
    monthlyExpenseBaseline: 0,
    manualFlags: { 4: false, 5: false, 7: false },
  };

  it('off (manualFlag=false) → incomplete', () => {
    const result = evaluate(input);
    expect(result[3].isCompleted).toBe(false);
    expect(result[3].isManual).toBe(true);
    expect(result[3].progress).toBeNull();
  });

  it('toggled on (manualFlag=true) → complete', () => {
    const toggled = { ...input, manualFlags: { 4: true, 5: false, 7: false } };
    const result = evaluate(toggled);
    expect(result[3].isCompleted).toBe(true);
  });

  it('toggled off again → incomplete (regression)', () => {
    const regressed = { ...input, manualFlags: { 4: false, 5: false, 7: false } };
    const result = evaluate(regressed);
    expect(result[3].isCompleted).toBe(false);
  });
});

describe('Step 5 — College Fund (manual)', () => {
  it('off → incomplete', () => {
    const input: EvaluatorInput = {
      envelopes: [],
      debts: NO_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: false, 7: false },
    };
    const result = evaluate(input);
    expect(result[4].isCompleted).toBe(false);
    expect(result[4].isManual).toBe(true);
  });

  it('toggled on → complete', () => {
    const input: EvaluatorInput = {
      envelopes: [],
      debts: NO_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: true, 7: false },
    };
    const result = evaluate(input);
    expect(result[4].isCompleted).toBe(true);
  });

  it('toggled off → incomplete (regression)', () => {
    const input: EvaluatorInput = {
      envelopes: [],
      debts: NO_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: false, 7: false },
    };
    const result = evaluate(input);
    expect(result[4].isCompleted).toBe(false);
  });
});

describe('Step 7 — Build & Give (manual)', () => {
  it('off → incomplete', () => {
    const input: EvaluatorInput = {
      envelopes: [],
      debts: NO_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: false, 7: false },
    };
    const result = evaluate(input);
    expect(result[6].isCompleted).toBe(false);
    expect(result[6].isManual).toBe(true);
  });

  it('toggled on → complete', () => {
    const input: EvaluatorInput = {
      envelopes: [],
      debts: NO_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: false, 7: true },
    };
    const result = evaluate(input);
    expect(result[6].isCompleted).toBe(true);
  });

  it('toggled off → incomplete (regression)', () => {
    const input: EvaluatorInput = {
      envelopes: [],
      debts: NO_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: false, 7: false },
    };
    const result = evaluate(input);
    expect(result[6].isCompleted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Step 6 — House Free (auto, bond debts)
// ---------------------------------------------------------------------------

describe('Step 6 — House Free', () => {
  function makeInput(bonds: DebtEntity[]): EvaluatorInput {
    return {
      envelopes: [],
      debts: bonds,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };
  }

  it('pre-threshold: bond outstanding → incomplete', () => {
    const bonds = [
      makeDebt({
        debtType: 'bond',
        isPaidOff: false,
        outstandingBalanceCents: 1_000_000,
        initialBalanceCents: 2_000_000,
      }),
    ];
    const result = evaluate(makeInput(bonds));
    expect(result[5].isCompleted).toBe(false);
    // Progress shows paid amount vs total
    expect(result[5].progress?.unit).toBe('cents');
  });

  it('at threshold − 1 cent: one bond, outstanding_balance_cents = 1, is_paid_off = false → incomplete; progress shows 99,999 of 100,000 cents paid', () => {
    const bonds = [
      makeDebt({
        debtType: 'bond',
        isPaidOff: false,
        outstandingBalanceCents: 1,
        initialBalanceCents: 100_000,
      }),
    ];
    const result = evaluate(makeInput(bonds));
    expect(result[5].isCompleted).toBe(false);
    expect(result[5].progress?.current).toBe(99_999);
    expect(result[5].progress?.target).toBe(100_000);
    expect(result[5].progress?.unit).toBe('cents');
  });

  it('at threshold: all bonds paid off (both isPaidOff=true and outstandingBalance=0 paths) → complete', () => {
    const bonds = [
      makeDebt({
        debtType: 'bond',
        isPaidOff: true,
        outstandingBalanceCents: 0,
        initialBalanceCents: 2_000_000,
      }),
      makeDebt({
        debtType: 'bond',
        isPaidOff: false,
        outstandingBalanceCents: 0,
        initialBalanceCents: 500_000,
      }),
    ];
    const result = evaluate(makeInput(bonds));
    expect(result[5].isCompleted).toBe(true);
  });

  it('at threshold + 1 cent: one bond, outstanding_balance_cents = 0, is_paid_off = true → complete; transition past zero behavior', () => {
    const bonds = [
      makeDebt({
        debtType: 'bond',
        isPaidOff: true,
        outstandingBalanceCents: 0,
        initialBalanceCents: 100_000,
      }),
    ];
    const result = evaluate(makeInput(bonds));
    expect(result[5].isCompleted).toBe(true);
    expect(result[5].progress?.current).toBe(100_000);
    expect(result[5].progress?.target).toBe(100_000);
    expect(result[5].progress?.unit).toBe('cents');
  });

  it('regression: re-mortgaged → bond back on books → incomplete', () => {
    const bonds = [
      makeDebt({
        debtType: 'bond',
        isPaidOff: false,
        outstandingBalanceCents: 2_000_000,
        initialBalanceCents: 2_000_000,
      }),
    ];
    const result = evaluate(makeInput(bonds));
    expect(result[5].isCompleted).toBe(false);
  });

  it('no bond debts → progress = null, incomplete', () => {
    const debts = [
      makeDebt({ debtType: 'credit_card', isPaidOff: false, outstandingBalanceCents: 50000 }),
    ];
    const result = evaluate(makeInput(debts));
    expect(result[5].isCompleted).toBe(false);
    expect(result[5].progress).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multiple EMF envelopes — oldest wins
// ---------------------------------------------------------------------------

describe('Multiple EMF envelopes — oldest wins', () => {
  it('when two EMF envelopes exist, oldest by createdAt determines balance', () => {
    const older = makeEnvelope({
      envelopeType: 'emergency_fund',
      allocatedCents: 100_000,
      spentCents: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const newer = makeEnvelope({
      envelopeType: 'emergency_fund',
      allocatedCents: 200_000,
      spentCents: 0,
      createdAt: '2025-06-01T00:00:00.000Z',
    });

    const input: EvaluatorInput = {
      envelopes: [newer, older], // intentionally out of order
      debts: NO_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };
    const result = evaluate(input);
    // Step 1: older's balance=100_000, should be complete
    expect(result[0].isCompleted).toBe(true);
    expect(result[0].progress?.current).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// Output structure — all 7 step numbers present
// ---------------------------------------------------------------------------

describe('output structure', () => {
  it('returns exactly 7 statuses in step order 1-7', () => {
    const input: EvaluatorInput = {
      envelopes: [],
      debts: NO_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };
    const result = evaluate(input);
    expect(result).toHaveLength(7);
    expect(result.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
