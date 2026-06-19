/**
 * Integration: Baby Steps progression lifecycle.
 *
 * Exercises BabyStepEvaluator and ReconcileBabyStepsUseCase through
 * the full Dave Ramsey 7 Baby Steps progression using Kruger household data.
 *
 * Workflow:
 *  1. Emergency fund at R0 → Step 1 incomplete
 *  2. Add R1,000 → reconcile → Step 1 auto-completes
 *  3. Pay off all non-bond debts → Step 2 auto-completes
 *  4. Toggle manual steps 4, 5
 *  5. Regression: emergency fund drops below R1,000 → Step 1 regresses
 */

import { evaluate } from '../../domain/babySteps/BabyStepEvaluator';
import type { EvaluatorInput } from '../../domain/babySteps/BabyStepEvaluator';
import { ReconcileBabyStepsUseCase } from '../../domain/babySteps/ReconcileBabyStepsUseCase';
import { calculateBudgetBalance } from '../../domain/budgets/BudgetBalanceCalculator';
import type { EnvelopeEntity } from '../../domain/envelopes/EnvelopeEntity';
import type { DebtEntity } from '../../domain/debtSnowball/DebtEntity';
import { buildEnvelope, resetFactoryCounter } from '../../__test-utils__/factories';
import { KRUGER_ENVELOPES, KRUGER_DEBTS, HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Date.now()}-${Math.random()}` }));

beforeEach(() => resetFactoryCounter());

const DEFAULT_MANUAL_FLAGS: EvaluatorInput['manualFlags'] = { 4: false, 5: false, 7: false };

function makeEmf(balanceCents: number): EnvelopeEntity {
  return buildEnvelope({
    id: 'emf-test',
    householdId: HOUSEHOLDS.kruger.id,
    name: 'Emergency Fund',
    envelopeType: 'emergency_fund',
    allocatedCents: balanceCents,
    spentCents: 0,
    isSavingsLocked: true,
    targetAmountCents: 1_000_000,
  });
}

function makeIncomeEnvelopes(): EnvelopeEntity[] {
  return KRUGER_ENVELOPES.filter((e) => e.envelopeType === 'income');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 1: Starter Emergency Fund (R1,000)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 1 — Starter Emergency Fund progression', () => {
  it('emergency fund at R0 → Step 1 incomplete', () => {
    const emf = makeEmf(0);
    const input: EvaluatorInput = {
      envelopes: [emf],
      debts: [],
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };

    const result = evaluate(input);
    const step1 = result[0]!;

    expect(step1.isCompleted).toBe(false);
    expect(step1.progress?.current).toBe(0);
    expect(step1.progress?.target).toBe(100_000);
  });

  it('emergency fund at R500 → Step 1 still incomplete, progress shows R500', () => {
    const emf = makeEmf(50_000);
    const input: EvaluatorInput = {
      envelopes: [emf],
      debts: [],
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };

    const result = evaluate(input);
    const step1 = result[0]!;

    expect(step1.isCompleted).toBe(false);
    expect(step1.progress?.current).toBe(50_000);
  });

  it('add R1,000 to emergency fund → Step 1 auto-completes', () => {
    const emf = makeEmf(100_000);
    const input: EvaluatorInput = {
      envelopes: [emf],
      debts: [],
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };

    const result = evaluate(input);
    const step1 = result[0]!;

    expect(step1.isCompleted).toBe(true);
    expect(step1.progress?.current).toBe(100_000);
    expect(step1.progress?.target).toBe(100_000);
  });

  it('emergency fund above R1,000 still completes Step 1', () => {
    const emf = makeEmf(150_000);
    const input: EvaluatorInput = {
      envelopes: [emf],
      debts: [],
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };

    const result = evaluate(input);
    expect(result[0]!.isCompleted).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Step 2: Pay off all non-bond debts
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 2 — Debt Free progression', () => {
  it('all Kruger non-bond debts outstanding → Step 2 incomplete', () => {
    const input: EvaluatorInput = {
      envelopes: [],
      debts: KRUGER_DEBTS,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };

    const result = evaluate(input);
    const step2 = result[1]!;

    expect(step2.isCompleted).toBe(false);
    expect(step2.progress?.target).toBe(4); // 4 non-bond debts
    expect(step2.progress?.current).toBe(0);
  });

  it('paying off debts one by one shows incremental progress', () => {
    const debts = KRUGER_DEBTS.map((d) => ({ ...d }));

    // Pay off Woolworths
    debts[0] = { ...debts[0]!, isPaidOff: true, outstandingBalanceCents: 0 };
    let result = evaluate({
      envelopes: [],
      debts,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    });
    expect(result[1]!.progress?.current).toBe(1);
    expect(result[1]!.isCompleted).toBe(false);

    // Pay off Nedbank CC
    debts[1] = { ...debts[1]!, isPaidOff: true, outstandingBalanceCents: 0 };
    result = evaluate({
      envelopes: [],
      debts,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    });
    expect(result[1]!.progress?.current).toBe(2);
    expect(result[1]!.isCompleted).toBe(false);

    // Pay off Capitec
    debts[2] = { ...debts[2]!, isPaidOff: true, outstandingBalanceCents: 0 };
    result = evaluate({
      envelopes: [],
      debts,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    });
    expect(result[1]!.progress?.current).toBe(3);
    expect(result[1]!.isCompleted).toBe(false);

    // Pay off WesBank (last non-bond)
    debts[3] = { ...debts[3]!, isPaidOff: true, outstandingBalanceCents: 0 };
    result = evaluate({
      envelopes: [],
      debts,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    });
    expect(result[1]!.progress?.current).toBe(4);
    expect(result[1]!.isCompleted).toBe(true);
  });

  it('FNB Bond is NOT counted toward Step 2 (bond excluded)', () => {
    const debts: DebtEntity[] = KRUGER_DEBTS.map((d) => {
      if (d.debtType === 'bond') return { ...d };
      return { ...d, isPaidOff: true, outstandingBalanceCents: 0 };
    });

    const input: EvaluatorInput = {
      envelopes: [],
      debts,
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };

    const result = evaluate(input);
    const step2 = result[1]!;

    expect(step2.isCompleted).toBe(true);
    // Bond should still be outstanding
    const bond = debts.find((d) => d.debtType === 'bond')!;
    expect(bond.outstandingBalanceCents).toBe(120_000_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Step 3: Full Emergency Fund (3 months expenses)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 3 — Full Emergency Fund', () => {
  it('requires income envelopes to calculate target', () => {
    const incomes = makeIncomeEnvelopes();
    const balance = calculateBudgetBalance(incomes);
    const monthlyBaseline = balance.incomeTotal / 100;
    const targetCents = Math.floor(3 * monthlyBaseline * 100);

    // Kruger income: R70,000 → baseline: R700 → target: R2,100 (210_000 cents)
    expect(balance.incomeTotal).toBe(7_000_000);
    expect(monthlyBaseline).toBe(70_000);
    expect(targetCents).toBe(21_000_000);
  });

  it('EMF below 3-month target → Step 3 incomplete', () => {
    const emf = makeEmf(5_000_000);
    const incomes = makeIncomeEnvelopes();
    const balance = calculateBudgetBalance(incomes);
    const monthlyBaseline = balance.incomeTotal / 100;

    const input: EvaluatorInput = {
      envelopes: [emf, ...incomes],
      debts: [],
      monthlyExpenseBaseline: monthlyBaseline,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };

    const result = evaluate(input);
    expect(result[2]!.isCompleted).toBe(false);
    expect(result[2]!.progress?.target).toBe(21_000_000);
  });

  it('EMF at exactly 3-month target → Step 3 completes', () => {
    const emf = makeEmf(21_000_000);
    const incomes = makeIncomeEnvelopes();
    const balance = calculateBudgetBalance(incomes);
    const monthlyBaseline = balance.incomeTotal / 100;

    const input: EvaluatorInput = {
      envelopes: [emf, ...incomes],
      debts: [],
      monthlyExpenseBaseline: monthlyBaseline,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };

    const result = evaluate(input);
    expect(result[2]!.isCompleted).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Steps 4, 5 — Manual Toggle
// ═══════════════════════════════════════════════════════════════════════════════

describe('Steps 4 & 5 — Manual toggle', () => {
  it('Step 4 starts incomplete', () => {
    const result = evaluate({
      envelopes: [],
      debts: [],
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: false, 7: false },
    });
    expect(result[3]!.isCompleted).toBe(false);
    expect(result[3]!.isManual).toBe(true);
  });

  it('toggling Step 4 on completes it', () => {
    const result = evaluate({
      envelopes: [],
      debts: [],
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: true, 5: false, 7: false },
    });
    expect(result[3]!.isCompleted).toBe(true);
  });

  it('Step 5 starts incomplete', () => {
    const result = evaluate({
      envelopes: [],
      debts: [],
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: false, 7: false },
    });
    expect(result[4]!.isCompleted).toBe(false);
    expect(result[4]!.isManual).toBe(true);
  });

  it('toggling Step 5 on completes it', () => {
    const result = evaluate({
      envelopes: [],
      debts: [],
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: false, 5: true, 7: false },
    });
    expect(result[4]!.isCompleted).toBe(true);
  });

  it('toggling both Step 4 and 5 on completes both', () => {
    const result = evaluate({
      envelopes: [],
      debts: [],
      monthlyExpenseBaseline: 0,
      manualFlags: { 4: true, 5: true, 7: false },
    });
    expect(result[3]!.isCompleted).toBe(true);
    expect(result[4]!.isCompleted).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Regression: Emergency fund drops below R1,000
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression — Emergency fund drops below R1,000', () => {
  it('Step 1 completes at R1,000 then regresses when balance drops', () => {
    const emf = makeEmf(100_000);
    const input: EvaluatorInput = {
      envelopes: [emf],
      debts: [],
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };

    // Verify completed
    const completed = evaluate(input);
    expect(completed[0]!.isCompleted).toBe(true);

    // Simulate withdrawal: balance drops to R999
    const emfDropped: EnvelopeEntity = {
      ...emf,
      allocatedCents: 100_000,
      spentCents: 1, // balance = 100_000 - 1 = 99_999
    };

    const regressed = evaluate({
      ...input,
      envelopes: [emfDropped],
    });
    expect(regressed[0]!.isCompleted).toBe(false);
    expect(regressed[0]!.progress?.current).toBe(99_999);
  });

  it('Step 1 recovers when balance returns to R1,000', () => {
    // Start at R999 (regressed)
    const emfLow: EnvelopeEntity = makeEmf(99_999);
    const regressedInput: EvaluatorInput = {
      envelopes: [emfLow],
      debts: [],
      monthlyExpenseBaseline: 0,
      manualFlags: DEFAULT_MANUAL_FLAGS,
    };
    expect(evaluate(regressedInput)[0]!.isCompleted).toBe(false);

    // Recover to R1,000
    const emfRecovered = makeEmf(100_000);
    const recoveredInput: EvaluatorInput = {
      ...regressedInput,
      envelopes: [emfRecovered],
    };
    expect(evaluate(recoveredInput)[0]!.isCompleted).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Full Progression — Steps 1 through 7
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full Baby Steps progression — 1 through 7', () => {
  it('progresses through all 7 steps with correct completion states', () => {
    const incomes = makeIncomeEnvelopes();
    const balance = calculateBudgetBalance(incomes);
    const monthlyBaseline = balance.incomeTotal / 100;

    // Initial: nothing done
    let result = evaluate({
      envelopes: [makeEmf(0), ...incomes],
      debts: KRUGER_DEBTS,
      monthlyExpenseBaseline: monthlyBaseline,
      manualFlags: { 4: false, 5: false, 7: false },
    });
    expect(result.map((s) => s.isCompleted)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);

    // Step 1: Save R1,000
    result = evaluate({
      envelopes: [makeEmf(100_000), ...incomes],
      debts: KRUGER_DEBTS,
      monthlyExpenseBaseline: monthlyBaseline,
      manualFlags: { 4: false, 5: false, 7: false },
    });
    expect(result[0]!.isCompleted).toBe(true);
    expect(result[1]!.isCompleted).toBe(false);

    // Step 2: Pay off all non-bond debts
    const paidDebts = KRUGER_DEBTS.map((d) =>
      d.debtType !== 'bond' ? { ...d, isPaidOff: true, outstandingBalanceCents: 0 } : { ...d },
    );
    result = evaluate({
      envelopes: [makeEmf(100_000), ...incomes],
      debts: paidDebts,
      monthlyExpenseBaseline: monthlyBaseline,
      manualFlags: { 4: false, 5: false, 7: false },
    });
    expect(result[0]!.isCompleted).toBe(true);
    expect(result[1]!.isCompleted).toBe(true);
    expect(result[2]!.isCompleted).toBe(false);

    // Step 3: Full emergency fund (3 months expenses)
    result = evaluate({
      envelopes: [makeEmf(21_000_000), ...incomes],
      debts: paidDebts,
      monthlyExpenseBaseline: monthlyBaseline,
      manualFlags: { 4: false, 5: false, 7: false },
    });
    expect(result[2]!.isCompleted).toBe(true);

    // Steps 4 & 5: Manual toggles
    result = evaluate({
      envelopes: [makeEmf(21_000_000), ...incomes],
      debts: paidDebts,
      monthlyExpenseBaseline: monthlyBaseline,
      manualFlags: { 4: true, 5: true, 7: false },
    });
    expect(result[3]!.isCompleted).toBe(true);
    expect(result[4]!.isCompleted).toBe(true);

    // Step 6: Pay off bond
    const allPaid = paidDebts.map((d) => ({
      ...d,
      isPaidOff: true,
      outstandingBalanceCents: 0,
    }));
    result = evaluate({
      envelopes: [makeEmf(21_000_000), ...incomes],
      debts: allPaid,
      monthlyExpenseBaseline: monthlyBaseline,
      manualFlags: { 4: true, 5: true, 7: false },
    });
    expect(result[5]!.isCompleted).toBe(true);

    // Step 7: Build & Give
    result = evaluate({
      envelopes: [makeEmf(21_000_000), ...incomes],
      debts: allPaid,
      monthlyExpenseBaseline: monthlyBaseline,
      manualFlags: { 4: true, 5: true, 7: true },
    });
    expect(result.map((s) => s.isCompleted)).toEqual([true, true, true, true, true, true, true]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ReconcileBabyStepsUseCase — integration with mocked DB
// ═══════════════════════════════════════════════════════════════════════════════

describe('ReconcileBabyStepsUseCase — integration with mocked DB', () => {
  it('reconcile detects Step 1 completion when EMF is funded', async () => {
    const emf = makeEmf(100_000);
    const incomes = makeIncomeEnvelopes();

    const envelopeRows = [emf, ...incomes].map((e) => ({
      ...e,
      targetAmountCents: e.targetAmountCents ?? null,
      targetDate: e.targetDate ?? null,
      isSynced: false,
    }));

    const debtRows = KRUGER_DEBTS.map((d) => ({ ...d }));

    let selectCallIdx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => {
            selectCallIdx++;
            if (selectCallIdx === 1) return Promise.resolve(envelopeRows);
            if (selectCallIdx === 2) return Promise.resolve(debtRows);
            return Promise.resolve([]); // baby_steps rows (none persisted yet)
          }),
        })),
      })),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    } as any;

    const uc = new ReconcileBabyStepsUseCase(mockDb);
    const result = await uc.execute(HOUSEHOLDS.kruger.id, '2026-01-01');

    expect(result.success).toBe(true);
    if (result.success) {
      const step1 = result.data.statuses.find((s) => s.stepNumber === 1)!;
      expect(step1.isCompleted).toBe(true);
      expect(result.data.newlyCompleted).toContain(1);
    }
  });

  it('reconcile detects Step 1 regression when EMF drops', async () => {
    const emfLow = makeEmf(50_000);
    const incomes = makeIncomeEnvelopes();
    const envelopeRows = [emfLow, ...incomes].map((e) => ({
      ...e,
      targetAmountCents: e.targetAmountCents ?? null,
      targetDate: e.targetDate ?? null,
      isSynced: false,
    }));

    const persistedStep1 = {
      id: 'bs-1',
      householdId: HOUSEHOLDS.kruger.id,
      stepNumber: 1,
      isCompleted: true,
      isManual: false,
      completedAt: '2026-01-15T00:00:00.000Z',
      celebratedAt: '2026-01-15T01:00:00.000Z',
      updatedAt: '2026-01-15T00:00:00.000Z',
      isSynced: true,
    };

    let selectCallIdx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => {
            selectCallIdx++;
            if (selectCallIdx === 1) return Promise.resolve(envelopeRows);
            if (selectCallIdx === 2) return Promise.resolve([]); // no debts
            return Promise.resolve([persistedStep1]);
          }),
        })),
      })),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    } as any;

    const uc = new ReconcileBabyStepsUseCase(mockDb);
    const result = await uc.execute(HOUSEHOLDS.kruger.id, '2026-01-01');

    expect(result.success).toBe(true);
    if (result.success) {
      const step1 = result.data.statuses.find((s) => s.stepNumber === 1)!;
      expect(step1.isCompleted).toBe(false);
      expect(step1.completedAt).toBeNull();
      // celebrated_at is PRESERVED on regression
      expect(step1.celebratedAt).toBe('2026-01-15T01:00:00.000Z');
      expect(result.data.newlyRegressed).toContain(1);
    }
  });
});
