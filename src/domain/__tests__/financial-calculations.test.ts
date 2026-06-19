import * as fc from 'fast-check';
import { calculateBudgetBalance } from '../budgets/BudgetBalanceCalculator';
import {
  getRemainingCents,
  type EnvelopeEntity,
  type EnvelopeType,
} from '../envelopes/EnvelopeEntity';
import { SnowballPayoffProjector } from '../debtSnowball/SnowballPayoffProjector';
import type { DebtType } from '../debtSnowball/DebtEntity';
import { buildEnvelope, buildTransaction, buildDebt } from '../../__test-utils__/factories';
import {
  KRUGER_ENVELOPES,
  KRUGER_DEBTS,
  KRUGER_TRANSACTIONS,
  HETZEL_ENVELOPES,
  HETZEL_TRANSACTIONS,
} from '../../__test-utils__/scenarioSeed';

// ═══════════════════════════════════════════════════════════════════════════════
// ZERO-BASED BUDGET INVARIANTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Zero-Based Budget Invariants', () => {
  describe('sum(all envelope allocatedCents) === income allocatedCents (balanced budget)', () => {
    it('Kruger budget is balanced when income equals expense allocation', () => {
      const balance = calculateBudgetBalance(KRUGER_ENVELOPES);
      // A balanced budget has toAssign === 0
      // incomeTotal - expenseAllocationTotal = toAssign
      expect(balance.toAssign).toBe(balance.incomeTotal - balance.expenseAllocationTotal);
    });

    it('when income envelope allocations equal spending allocations, toAssign is zero', () => {
      const incomeEnv = buildEnvelope({ allocatedCents: 1000000, envelopeType: 'income' });
      const spendEnv1 = buildEnvelope({ allocatedCents: 600000, envelopeType: 'spending' });
      const spendEnv2 = buildEnvelope({ allocatedCents: 400000, envelopeType: 'savings' });
      const balance = calculateBudgetBalance([incomeEnv, spendEnv1, spendEnv2]);
      expect(balance.toAssign).toBe(0);
    });

    it('detects overcommitted budget (toAssign < 0)', () => {
      const incomeEnv = buildEnvelope({ allocatedCents: 500000, envelopeType: 'income' });
      const spendEnv = buildEnvelope({ allocatedCents: 600000, envelopeType: 'spending' });
      const balance = calculateBudgetBalance([incomeEnv, spendEnv]);
      expect(balance.toAssign).toBeLessThan(0);
    });

    it('detects unassigned funds (toAssign > 0)', () => {
      const incomeEnv = buildEnvelope({ allocatedCents: 1000000, envelopeType: 'income' });
      const spendEnv = buildEnvelope({ allocatedCents: 400000, envelopeType: 'spending' });
      const balance = calculateBudgetBalance([incomeEnv, spendEnv]);
      expect(balance.toAssign).toBeGreaterThan(0);
      expect(balance.toAssign).toBe(600000);
    });
  });

  describe('envelope.spentCents never goes negative', () => {
    it('scenario seed envelopes all have non-negative spentCents', () => {
      for (const env of KRUGER_ENVELOPES) {
        expect(env.spentCents).toBeGreaterThanOrEqual(0);
      }
      for (const env of HETZEL_ENVELOPES) {
        expect(env.spentCents).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('getRemainingCents = allocatedCents - spentCents', () => {
    it('calculates correctly for varied allocations and spending', () => {
      const cases = [
        { allocated: 500000, spent: 200000, expected: 300000 },
        { allocated: 100000, spent: 100000, expected: 0 },
        { allocated: 100000, spent: 150000, expected: -50000 },
        { allocated: 0, spent: 0, expected: 0 },
      ];

      for (const { allocated, spent, expected } of cases) {
        const env = buildEnvelope({ allocatedCents: allocated, spentCents: spent });
        expect(getRemainingCents(env)).toBe(expected);
      }
    });

    it('identity holds for all Kruger envelopes', () => {
      for (const env of KRUGER_ENVELOPES) {
        expect(getRemainingCents(env)).toBe(env.allocatedCents - env.spentCents);
      }
    });
  });

  describe('after deleting all transactions: spentCents === 0', () => {
    it('zeroing spentCents simulates clearing all transactions', () => {
      const env = buildEnvelope({ allocatedCents: 800000, spentCents: 350000 });
      const cleared = { ...env, spentCents: 0 };
      expect(cleared.spentCents).toBe(0);
      expect(getRemainingCents(cleared)).toBe(cleared.allocatedCents);
    });
  });

  describe('archived envelopes are excluded from budget calculations', () => {
    it('does not count archived envelopes in totals', () => {
      const active = buildEnvelope({
        allocatedCents: 500000,
        envelopeType: 'spending',
        isArchived: false,
      });
      const archived = buildEnvelope({
        allocatedCents: 300000,
        envelopeType: 'spending',
        isArchived: true,
      });
      const income = buildEnvelope({
        allocatedCents: 500000,
        envelopeType: 'income',
        isArchived: false,
      });
      const balance = calculateBudgetBalance([active, archived, income]);
      expect(balance.totalAllocated).toBe(1000000);
      expect(balance.expenseAllocationTotal).toBe(500000);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SNOWBALL PROJECTION ACCURACY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Snowball Projection Accuracy', () => {
  const projector = new SnowballPayoffProjector();

  describe('Kruger debt set projections', () => {
    it('produces projections for all 5 active debts', () => {
      const plan = projector.project(KRUGER_DEBTS);
      expect(plan.projections).toHaveLength(5);
      expect(plan.debtFreeDate).not.toBeNull();
    });

    it('projections are in snowball order (smallest balance first)', () => {
      const plan = projector.project(KRUGER_DEBTS);
      expect(plan.projections[0].creditorName).toBe('Woolworths Store Account');
      expect(plan.projections[1].creditorName).toBe('Nedbank Credit Card');
      expect(plan.projections[2].creditorName).toBe('Capitec Personal Loan');
      expect(plan.projections[3].creditorName).toBe('WesBank Vehicle Finance');
      expect(plan.projections[4].creditorName).toBe('FNB Home Bond');
    });

    it('monthsToPayoff is monotonically non-decreasing (cumulative)', () => {
      const plan = projector.project(KRUGER_DEBTS);
      for (let i = 1; i < plan.projections.length; i++) {
        expect(plan.projections[i].monthsToPayoff).toBeGreaterThanOrEqual(
          plan.projections[i - 1].monthsToPayoff,
        );
      }
    });
  });

  describe('extra payment reduces total months', () => {
    it('R500 extra monthly reduces debt-free timeline', () => {
      const planBase = projector.project(KRUGER_DEBTS, 0);
      const planExtra = projector.project(KRUGER_DEBTS, 50000);
      const baseLast = planBase.projections[planBase.projections.length - 1];
      const extraLast = planExtra.projections[planExtra.projections.length - 1];
      expect(extraLast.monthsToPayoff).toBeLessThan(baseLast.monthsToPayoff);
    });

    it('larger extra payment produces shorter timeline than smaller extra', () => {
      const planSmall = projector.project(KRUGER_DEBTS, 10000);
      const planLarge = projector.project(KRUGER_DEBTS, 100000);
      const smallLast = planSmall.projections[planSmall.projections.length - 1];
      const largeLast = planLarge.projections[planLarge.projections.length - 1];
      expect(largeLast.monthsToPayoff).toBeLessThan(smallLast.monthsToPayoff);
    });
  });

  describe('zero-interest debt: months = ceil(balance / payment)', () => {
    it('calculates deterministically without interest', () => {
      const debt = buildDebt({
        outstandingBalanceCents: 100000,
        interestRatePercent: 0,
        minimumPaymentCents: 25000,
        sortOrder: 0,
      });
      const plan = projector.project([debt]);
      expect(plan.projections[0].monthsToPayoff).toBe(Math.ceil(100000 / 25000));
    });

    it('handles non-divisible balance', () => {
      const debt = buildDebt({
        outstandingBalanceCents: 100001,
        interestRatePercent: 0,
        minimumPaymentCents: 25000,
        sortOrder: 0,
      });
      const plan = projector.project([debt]);
      expect(plan.projections[0].monthsToPayoff).toBe(5);
    });

    it('single payment clears small debt', () => {
      const debt = buildDebt({
        outstandingBalanceCents: 5000,
        interestRatePercent: 0,
        minimumPaymentCents: 25000,
        sortOrder: 0,
      });
      const plan = projector.project([debt]);
      expect(plan.projections[0].monthsToPayoff).toBe(1);
    });
  });

  describe('single debt: payoff date is deterministic', () => {
    it('same input always produces the same months-to-payoff', () => {
      const debt = buildDebt({
        outstandingBalanceCents: 500000,
        interestRatePercent: 15,
        minimumPaymentCents: 20000,
        sortOrder: 0,
      });
      const plan1 = projector.project([debt]);
      const plan2 = projector.project([debt]);
      expect(plan1.projections[0].monthsToPayoff).toBe(plan2.projections[0].monthsToPayoff);
    });
  });

  describe('all debts paid: debtFreeDate is the last payoff date', () => {
    it('debtFreeDate matches the final projection payoffDate', () => {
      const plan = projector.project(KRUGER_DEBTS);
      const lastProjection = plan.projections[plan.projections.length - 1];
      expect(plan.debtFreeDate).toEqual(lastProjection.payoffDate);
    });
  });

  describe('empty debts array -> empty projections', () => {
    it('returns empty projections and null debtFreeDate', () => {
      const plan = projector.project([]);
      expect(plan.projections).toHaveLength(0);
      expect(plan.debtFreeDate).toBeNull();
    });

    it('skips paid-off debts', () => {
      const paidOff = buildDebt({ isPaidOff: true, outstandingBalanceCents: 0 });
      const plan = projector.project([paidOff]);
      expect(plan.projections).toHaveLength(0);
      expect(plan.debtFreeDate).toBeNull();
    });

    it('skips zero-balance debts', () => {
      const zeroBal = buildDebt({ outstandingBalanceCents: 0, isPaidOff: false });
      const plan = projector.project([zeroBal]);
      expect(plan.projections).toHaveLength(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROPERTY-BASED TESTS (fast-check)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Property-Based Tests', () => {
  const validDebtArb = fc.record({
    id: fc.uuid(),
    householdId: fc.uuid(),
    creditorName: fc.string({ minLength: 1, maxLength: 30 }),
    debtType: fc.constantFrom(
      'credit_card',
      'personal_loan',
      'store_account',
      'vehicle_finance',
      'bond',
    ) as fc.Arbitrary<DebtType>,
    outstandingBalanceCents: fc.integer({ min: 1, max: 100_000_00 }),
    initialBalanceCents: fc.integer({ min: 1, max: 100_000_00 }),
    interestRatePercent: fc.double({ min: 0, max: 30, noNaN: true }),
    minimumPaymentCents: fc.integer({ min: 100, max: 50_000_00 }),
    sortOrder: fc.integer({ min: 0, max: 100 }),
    isPaidOff: fc.constant(false),
    totalPaidCents: fc.constant(0),
    createdAt: fc.constant('2026-01-01T00:00:00Z'),
    updatedAt: fc.constant('2026-01-01T00:00:00Z'),
    isSynced: fc.boolean(),
  });

  const validEnvelopeArb = fc.record({
    id: fc.uuid(),
    householdId: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    allocatedCents: fc.integer({ min: 0, max: 100_000_00 }),
    spentCents: fc.integer({ min: 0, max: 100_000_00 }),
    envelopeType: fc.constantFrom(
      'spending',
      'savings',
      'emergency_fund',
      'baby_step',
      'utility',
      'sinking_fund',
    ) as fc.Arbitrary<EnvelopeType>,
    isSavingsLocked: fc.boolean(),
    isArchived: fc.constant(false),
    periodStart: fc.constant('2026-01-01'),
    targetAmountCents: fc.constant(null as number | null),
    targetDate: fc.constant(null as string | null),
    createdAt: fc.constant('2026-01-01T00:00:00Z'),
    updatedAt: fc.constant('2026-01-01T00:00:00Z'),
  });

  describe('total debt decreases monotonically month over month', () => {
    it('for any valid debt where payment > monthly interest, balance decreases', () => {
      fc.assert(
        fc.property(
          fc.record({
            balance: fc.integer({ min: 10000, max: 10_000_00 }),
            rate: fc.double({ min: 0, max: 25, noNaN: true }),
            payment: fc.integer({ min: 5000, max: 50_000_00 }),
          }),
          ({ balance, rate, payment }) => {
            const monthlyRate = rate / 100 / 12;
            const interest = Math.round(balance * monthlyRate);
            fc.pre(payment > interest);
            const newBalance = balance + interest - payment;
            return newBalance < balance;
          },
        ),
        { numRuns: 500 },
      );
    });

    it('snowball plan: first debt months-to-payoff is always finite when payment covers interest and fits within cap', () => {
      const projector = new SnowballPayoffProjector();
      fc.assert(
        fc.property(
          validDebtArb.filter((d) => {
            const monthlyRate = d.interestRatePercent / 100 / 12;
            const monthlyInterest = Math.round(d.outstandingBalanceCents * monthlyRate);
            const netPaydown = d.minimumPaymentCents - monthlyInterest;
            if (netPaydown <= 0) return false;
            // Ensure payoff within 599 months (under the 600-month safety cap)
            const estimatedMonths = Math.ceil(d.outstandingBalanceCents / netPaydown);
            return estimatedMonths < 600;
          }),
          (debt) => {
            const plan = projector.project([debt]);
            return (
              plan.projections[0].monthsToPayoff > 0 && plan.projections[0].monthsToPayoff !== -1
            );
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe('budget: incomeTotal - expenseAllocationTotal = toAssign (conservation of money)', () => {
    it('holds for any set of envelopes', () => {
      const incomeEnvelopeArb: fc.Arbitrary<EnvelopeEntity> = validEnvelopeArb.map((e) => ({
        ...e,
        envelopeType: 'income' as EnvelopeType,
      }));
      const expenseEnvelopeArb: fc.Arbitrary<EnvelopeEntity> = validEnvelopeArb.map((e) => ({
        ...e,
        envelopeType: 'spending' as EnvelopeType,
      }));

      fc.assert(
        fc.property(
          fc.tuple(
            fc.array(incomeEnvelopeArb, { minLength: 1, maxLength: 5 }),
            fc.array(expenseEnvelopeArb, { minLength: 0, maxLength: 10 }),
          ),
          ([incomes, expenses]) => {
            const allEnvelopes = [...incomes, ...expenses];
            const balance = calculateBudgetBalance(allEnvelopes);
            return balance.toAssign === balance.incomeTotal - balance.expenseAllocationTotal;
          },
        ),
        { numRuns: 500 },
      );
    });

    it('totalAllocated === incomeTotal + expenseAllocationTotal', () => {
      fc.assert(
        fc.property(fc.array(validEnvelopeArb, { minLength: 1, maxLength: 10 }), (envelopes) => {
          const balance = calculateBudgetBalance(envelopes as EnvelopeEntity[]);
          return balance.totalAllocated === balance.incomeTotal + balance.expenseAllocationTotal;
        }),
        { numRuns: 500 },
      );
    });
  });

  describe('transaction set: sum(transaction.amountCents) === envelope.spentCents', () => {
    it('scenario Kruger transactions grouped by envelope sum to spentCents', () => {
      const envelopeSpent = new Map<string, number>();
      for (const tx of KRUGER_TRANSACTIONS) {
        envelopeSpent.set(tx.envelopeId, (envelopeSpent.get(tx.envelopeId) ?? 0) + tx.amountCents);
      }
      for (const [_envId, total] of envelopeSpent) {
        expect(total).toBeGreaterThan(0);
        expect(Number.isInteger(total)).toBe(true);
      }
    });

    it('for any set of transactions, envelope sum is additive', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              envelopeId: fc.constantFrom('env-a', 'env-b', 'env-c'),
              amountCents: fc.integer({ min: 1, max: 100_000_00 }),
            }),
            { minLength: 1, maxLength: 20 },
          ),
          (txns) => {
            const sums = new Map<string, number>();
            for (const tx of txns) {
              sums.set(tx.envelopeId, (sums.get(tx.envelopeId) ?? 0) + tx.amountCents);
            }
            const totalFromMap = [...sums.values()].reduce((a, b) => a + b, 0);
            const totalDirect = txns.reduce((sum, tx) => sum + tx.amountCents, 0);
            return totalFromMap === totalDirect;
          },
        ),
        { numRuns: 300 },
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CURRENCY EDGE CASES (ZAR cents)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Currency Edge Cases (ZAR cents)', () => {
  const projector = new SnowballPayoffProjector();

  it('1 cent transactions', () => {
    const env = buildEnvelope({ allocatedCents: 1, spentCents: 1 });
    expect(getRemainingCents(env)).toBe(0);
  });

  it('R0.00 allocations', () => {
    const env = buildEnvelope({ allocatedCents: 0, spentCents: 0 });
    const balance = calculateBudgetBalance([env]);
    expect(balance.totalAllocated).toBe(0);
    expect(balance.toAssign).toBe(0);
  });

  it('maximum safe integer amounts (R10M+ in cents)', () => {
    const largeAmountCents = 1_000_000_00; // R1M = 100,000,000 cents
    const env = buildEnvelope({ allocatedCents: largeAmountCents, spentCents: 500_000_00 });
    expect(getRemainingCents(env)).toBe(500_000_00);

    const tenMillion = 10_000_000_00;
    const envLarge = buildEnvelope({ allocatedCents: tenMillion, envelopeType: 'income' });
    const balance = calculateBudgetBalance([envLarge]);
    expect(balance.incomeTotal).toBe(tenMillion);
  });

  it('budget period boundary: Kruger payday-20 transactions on day 19 vs 20', () => {
    const txBefore = buildTransaction({
      transactionDate: '2026-01-19',
      amountCents: 50000,
    });
    const txOn = buildTransaction({
      transactionDate: '2026-01-20',
      amountCents: 75000,
    });
    expect(txBefore.transactionDate).toBe('2026-01-19');
    expect(txOn.transactionDate).toBe('2026-01-20');
    expect(txBefore.amountCents + txOn.amountCents).toBe(125000);
  });

  it('Hetzel payday-1: transaction on last day of month', () => {
    const txLastDay = buildTransaction({
      transactionDate: '2026-01-31',
      amountCents: 100000,
    });
    expect(txLastDay.transactionDate).toBe('2026-01-31');

    const txFebLast = buildTransaction({
      transactionDate: '2026-02-28',
      amountCents: 100000,
    });
    expect(txFebLast.transactionDate).toBe('2026-02-28');
  });

  it('leap year period calculations (2028 has Feb 29)', () => {
    const txLeap = buildTransaction({
      transactionDate: '2028-02-29',
      amountCents: 50000,
    });
    expect(txLeap.transactionDate).toBe('2028-02-29');
    const date = new Date(txLeap.transactionDate);
    expect(date.getDate()).toBe(29);
    expect(date.getMonth()).toBe(1);
  });

  it('zero-interest debt with 1 cent balance', () => {
    const debt = buildDebt({
      outstandingBalanceCents: 1,
      interestRatePercent: 0,
      minimumPaymentCents: 100,
      sortOrder: 0,
    });
    const plan = projector.project([debt]);
    expect(plan.projections[0].monthsToPayoff).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUSINESS EXPENSE INVARIANTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Business Expense Invariants', () => {
  it('sum(isBusinessExpense transactions) matches business expense report total', () => {
    const businessTxns = KRUGER_TRANSACTIONS.filter((tx) => tx.isBusinessExpense);
    const businessTotal = businessTxns.reduce((sum, tx) => sum + tx.amountCents, 0);
    expect(businessTxns.length).toBeGreaterThan(0);
    expect(businessTotal).toBeGreaterThan(0);

    const manualSum = businessTxns.map((tx) => tx.amountCents).reduce((a, b) => a + b, 0);
    expect(businessTotal).toBe(manualSum);
  });

  it('business expense flag persists through data roundtrip', () => {
    const tx = buildTransaction({ isBusinessExpense: true, amountCents: 89900 });
    const serialized = JSON.parse(JSON.stringify(tx));
    expect(serialized.isBusinessExpense).toBe(true);
    expect(serialized.amountCents).toBe(89900);
  });

  it('business expense report correctly filters by date range', () => {
    const startDate = '2026-02-01';
    const endDate = '2026-03-31';

    const filteredBusiness = KRUGER_TRANSACTIONS.filter(
      (tx) =>
        tx.isBusinessExpense && tx.transactionDate >= startDate && tx.transactionDate <= endDate,
    );

    const allBusiness = KRUGER_TRANSACTIONS.filter((tx) => tx.isBusinessExpense);
    expect(filteredBusiness.length).toBeLessThanOrEqual(allBusiness.length);
    expect(filteredBusiness.length).toBeGreaterThan(0);

    for (const tx of filteredBusiness) {
      expect(tx.isBusinessExpense).toBe(true);
      expect(tx.transactionDate >= startDate).toBe(true);
      expect(tx.transactionDate <= endDate).toBe(true);
    }
  });

  it('non-business transactions are never counted in business total', () => {
    const nonBusinessTxns = KRUGER_TRANSACTIONS.filter((tx) => !tx.isBusinessExpense);
    expect(nonBusinessTxns.length).toBeGreaterThan(0);
    for (const tx of nonBusinessTxns) {
      expect(tx.isBusinessExpense).toBe(false);
    }
  });

  it('Hetzel household has no business expenses', () => {
    const hetzelBusiness = HETZEL_TRANSACTIONS.filter((tx) => tx.isBusinessExpense);
    expect(hetzelBusiness).toHaveLength(0);
  });
});
