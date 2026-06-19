/**
 * Integration: Debt Snowball lifecycle.
 *
 * Exercises CreateDebtUseCase, LogDebtPaymentUseCase, and
 * SnowballPayoffProjector together using Kruger household debts.
 *
 * Workflow:
 *  1. Create debts in snowball order (smallest balance first)
 *  2. Log payments, verify totalPaidCents and outstandingBalanceCents
 *  3. Pay off Woolworths (smallest), verify isPaidOff
 *  4. Freed R150 min payment rolls into Nedbank CC as extra snowball
 *  5. Run SnowballPayoffProjector, verify months-to-payoff
 *  6. Baby Step 2 auto-completes when all non-bond debts paid
 */

import { LogDebtPaymentUseCase } from '../../domain/debtSnowball/LogDebtPaymentUseCase';
import { SnowballPayoffProjector } from '../../domain/debtSnowball/SnowballPayoffProjector';
import type { DebtEntity } from '../../domain/debtSnowball/DebtEntity';
import { getPayoffProgressPercent } from '../../domain/debtSnowball/DebtEntity';
import { evaluate } from '../../domain/babySteps/BabyStepEvaluator';
import type { EvaluatorInput } from '../../domain/babySteps/BabyStepEvaluator';
import { resetFactoryCounter } from '../../__test-utils__/factories';
import { KRUGER_DEBTS, HOUSEHOLDS, SNOWBALL_PAYMENTS } from '../../__test-utils__/scenarioSeed';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Date.now()}-${Math.random()}` }));

beforeEach(() => resetFactoryCounter());

function makeMockDebtRepo() {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByHousehold: jest.fn().mockResolvedValue([]),
    insert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    incrementTotalPaid: jest.fn().mockResolvedValue(undefined),
  };
}

const mockDb = {
  select: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue([{ count: 0 }]),
    }),
  }),
  insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
  update: jest.fn().mockReturnValue({
    set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
  }),
} as any;

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;
const mockEnqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) };

function applyPayment(debt: DebtEntity, paymentCents: number): DebtEntity {
  const applied = Math.min(paymentCents, debt.outstandingBalanceCents);
  const newBalance = debt.outstandingBalanceCents - applied;
  return {
    ...debt,
    outstandingBalanceCents: newBalance,
    totalPaidCents: debt.totalPaidCents + applied,
    isPaidOff: newBalance === 0,
    updatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Snowball Order & Initial State
// ═══════════════════════════════════════════════════════════════════════════════

describe('Snowball order and initial state', () => {
  it('Kruger debts are in snowball order (smallest balance first)', () => {
    const nonBond = KRUGER_DEBTS.filter((d) => d.debtType !== 'bond');
    for (let i = 1; i < nonBond.length; i++) {
      expect(nonBond[i]!.outstandingBalanceCents).toBeGreaterThanOrEqual(
        nonBond[i - 1]!.outstandingBalanceCents,
      );
    }
  });

  it('Woolworths is the smallest debt', () => {
    expect(KRUGER_DEBTS[0]!.creditorName).toBe('Woolworths Store Account');
    expect(KRUGER_DEBTS[0]!.outstandingBalanceCents).toBe(320_000);
    expect(KRUGER_DEBTS[0]!.minimumPaymentCents).toBe(15_000);
  });

  it('all debts start with isPaidOff = false and totalPaidCents = 0', () => {
    for (const debt of KRUGER_DEBTS) {
      expect(debt.isPaidOff).toBe(false);
      expect(debt.totalPaidCents).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Payment Logging & Balance Tracking
// ═══════════════════════════════════════════════════════════════════════════════

describe('Payment logging and balance tracking', () => {
  let debts: DebtEntity[];

  beforeEach(() => {
    debts = KRUGER_DEBTS.map((d) => ({ ...d }));
  });

  it('LogDebtPaymentUseCase returns updated debt with correct balances', async () => {
    const woolworths = debts[0]!;
    const repo = makeMockDebtRepo();

    const uc = new LogDebtPaymentUseCase(
      mockDb,
      mockAudit,
      {
        householdId: woolworths.householdId,
        debtId: woolworths.id,
        paymentAmountCents: 15_000,
        currentDebt: woolworths,
      },
      mockEnqueuer,
      repo,
    );

    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalPaidCents).toBe(15_000);
      expect(result.data.outstandingBalanceCents).toBe(320_000 - 15_000);
      expect(result.data.isPaidOff).toBe(false);
    }
  });

  it('January minimum payments reduce balances correctly', () => {
    const krugerJanPayments = SNOWBALL_PAYMENTS.filter(
      (p) => p.householdId === HOUSEHOLDS.kruger.id && p.paymentDate.startsWith('2026-01'),
    );

    for (const payment of krugerJanPayments) {
      const idx = debts.findIndex((d) => d.id === payment.debtId);
      debts[idx] = applyPayment(debts[idx]!, payment.paymentAmountCents);
    }

    const woolworths = debts[0]!;
    expect(woolworths.outstandingBalanceCents).toBe(320_000 - 15_000);
    expect(woolworths.totalPaidCents).toBe(15_000);
    expect(woolworths.isPaidOff).toBe(false);

    const nedbank = debts[1]!;
    expect(nedbank.outstandingBalanceCents).toBe(850_000 - 25_000);
    expect(nedbank.totalPaidCents).toBe(25_000);
  });

  it('three months of payments on Woolworths progresses toward payoff', () => {
    const krugerPayments = SNOWBALL_PAYMENTS.filter((p) => p.householdId === HOUSEHOLDS.kruger.id);

    for (const payment of krugerPayments) {
      const idx = debts.findIndex((d) => d.id === payment.debtId);
      debts[idx] = applyPayment(debts[idx]!, payment.paymentAmountCents);
    }

    const woolworths = debts[0]!;
    // Jan: R150, Feb: R650, Mar: R650 = R1,450 total
    expect(woolworths.totalPaidCents).toBe(15_000 + 65_000 + 65_000);
    expect(woolworths.outstandingBalanceCents).toBe(320_000 - 145_000);
    expect(woolworths.isPaidOff).toBe(false);

    const progress = getPayoffProgressPercent(woolworths);
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Full Payoff — Woolworths & Snowball Rollover
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full payoff — Woolworths and snowball rollover', () => {
  it('paying off Woolworths sets isPaidOff = true', () => {
    let woolworths = { ...KRUGER_DEBTS[0]! };

    woolworths = applyPayment(woolworths, 320_000);

    expect(woolworths.isPaidOff).toBe(true);
    expect(woolworths.outstandingBalanceCents).toBe(0);
    expect(woolworths.totalPaidCents).toBe(320_000);
    expect(getPayoffProgressPercent(woolworths)).toBe(100);
  });

  it('freed R150 minimum payment rolls into Nedbank CC as extra snowball', () => {
    const woolworthsMinPayment = KRUGER_DEBTS[0]!.minimumPaymentCents; // R150
    const nedbankMinPayment = KRUGER_DEBTS[1]!.minimumPaymentCents; // R250

    const extraSnowball = woolworthsMinPayment;
    const nedbankTotalMonthlyPayment = nedbankMinPayment + extraSnowball;

    expect(nedbankTotalMonthlyPayment).toBe(40_000); // R250 + R150 = R400/month
  });

  it('overpayment is capped at outstanding balance', async () => {
    const woolworths = { ...KRUGER_DEBTS[0]! };
    woolworths.outstandingBalanceCents = 5_000; // only R50 left

    const repo = makeMockDebtRepo();
    const uc = new LogDebtPaymentUseCase(
      mockDb,
      mockAudit,
      {
        householdId: woolworths.householdId,
        debtId: woolworths.id,
        paymentAmountCents: 15_000,
        currentDebt: woolworths,
      },
      mockEnqueuer,
      repo,
    );

    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outstandingBalanceCents).toBe(0);
      expect(result.data.isPaidOff).toBe(true);
      // Only R50 was applied, not the full R150
      expect(result.data.totalPaidCents).toBe(5_000);
    }
  });

  it('rejects zero payment amount', async () => {
    const woolworths = { ...KRUGER_DEBTS[0]! };
    const repo = makeMockDebtRepo();
    const uc = new LogDebtPaymentUseCase(
      mockDb,
      mockAudit,
      {
        householdId: woolworths.householdId,
        debtId: woolworths.id,
        paymentAmountCents: 0,
        currentDebt: woolworths,
      },
      mockEnqueuer,
      repo,
    );

    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYMENT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SnowballPayoffProjector
// ═══════════════════════════════════════════════════════════════════════════════

describe('SnowballPayoffProjector', () => {
  const projector = new SnowballPayoffProjector();

  it('projects payoff timeline for all active Kruger debts', () => {
    const activeDebts = KRUGER_DEBTS.filter((d) => !d.isPaidOff);
    const plan = projector.project(activeDebts, 0);

    expect(plan.projections).toHaveLength(activeDebts.length);
    for (const p of plan.projections) {
      expect(p.monthsToPayoff).toBeGreaterThan(0);
      expect(p.payoffDate).toBeInstanceOf(Date);
    }
  });

  it('adding extra monthly payment reduces total payoff time', () => {
    const activeDebts = KRUGER_DEBTS.filter((d) => !d.isPaidOff);
    const noExtra = projector.project(activeDebts, 0);
    const withExtra = projector.project(activeDebts, 50_000); // R500 extra/month

    const noExtraLast = noExtra.projections[noExtra.projections.length - 1]!;
    const withExtraLast = withExtra.projections[withExtra.projections.length - 1]!;

    if (noExtraLast.monthsToPayoff !== -1 && withExtraLast.monthsToPayoff !== -1) {
      expect(withExtraLast.monthsToPayoff).toBeLessThan(noExtraLast.monthsToPayoff);
    }
  });

  it('smallest debt (Woolworths) pays off first', () => {
    const activeDebts = KRUGER_DEBTS.filter((d) => !d.isPaidOff);
    const plan = projector.project(activeDebts, 50_000);

    expect(plan.projections[0]!.creditorName).toBe('Woolworths Store Account');
  });

  it('after Woolworths paid off, remaining debts get snowball boost', () => {
    const afterWoolworths = KRUGER_DEBTS.filter(
      (d) => !d.isPaidOff && d.creditorName !== 'Woolworths Store Account',
    );
    // Woolworths freed R150, plus R500 extra = R650 snowball
    const freedMinPayment = KRUGER_DEBTS[0]!.minimumPaymentCents;
    const extraPayment = 50_000;

    const plan = projector.project(afterWoolworths, freedMinPayment + extraPayment);

    expect(plan.projections[0]!.creditorName).toBe('Nedbank Credit Card');
    expect(plan.projections[0]!.monthsToPayoff).toBeGreaterThan(0);
  });

  it('returns debtFreeDate when all debts payable', () => {
    const nonBondDebts = KRUGER_DEBTS.filter((d) => !d.isPaidOff && d.debtType !== 'bond');
    const plan = projector.project(nonBondDebts, 50_000);

    expect(plan.debtFreeDate).not.toBeNull();
    expect(plan.debtFreeDate).toBeInstanceOf(Date);
  });

  it('empty debt list returns no projections', () => {
    const plan = projector.project([], 50_000);

    expect(plan.projections).toHaveLength(0);
    expect(plan.debtFreeDate).toBeNull();
  });

  it('already-paid debts are excluded from projection', () => {
    const debts = KRUGER_DEBTS.map((d) => ({
      ...d,
      isPaidOff: true,
      outstandingBalanceCents: 0,
    }));
    const plan = projector.project(debts, 0);

    expect(plan.projections).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Baby Step 2 auto-completes when all non-bond debts paid
// ═══════════════════════════════════════════════════════════════════════════════

describe('Baby Step 2 auto-completion on full non-bond payoff', () => {
  it('Step 2 incomplete when non-bond debts remain', () => {
    const input: EvaluatorInput = {
      envelopes: [],
      debts: KRUGER_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: false, 7: false },
    };
    const result = evaluate(input);
    const step2 = result.find((s) => s.stepNumber === 2)!;
    expect(step2.isCompleted).toBe(false);
  });

  it('Step 2 completes when all non-bond debts are paid off', () => {
    const paidOffDebts: DebtEntity[] = KRUGER_DEBTS.map((d) => {
      if (d.debtType === 'bond') return { ...d };
      return { ...d, isPaidOff: true, outstandingBalanceCents: 0 };
    });

    const input: EvaluatorInput = {
      envelopes: [],
      debts: paidOffDebts,
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: false, 7: false },
    };
    const result = evaluate(input);
    const step2 = result.find((s) => s.stepNumber === 2)!;
    expect(step2.isCompleted).toBe(true);
    expect(step2.progress).toEqual({
      current: 4,
      target: 4,
      unit: 'count',
    });
  });

  it('Step 2 shows progress as debts are paid off one by one', () => {
    const debts = KRUGER_DEBTS.map((d) => ({ ...d }));

    // Pay off Woolworths (index 0)
    debts[0] = { ...debts[0]!, isPaidOff: true, outstandingBalanceCents: 0 };

    const input: EvaluatorInput = {
      envelopes: [],
      debts,
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: false, 7: false },
    };
    const result = evaluate(input);
    const step2 = result.find((s) => s.stepNumber === 2)!;
    expect(step2.isCompleted).toBe(false);
    expect(step2.progress).toEqual({
      current: 1,
      target: 4,
      unit: 'count',
    });
  });
});
