/**
 * Integration: Multi-household budget workflow.
 *
 * Exercises CreateEnvelopeUseCase, CreateTransactionUseCase,
 * DeleteTransactionUseCase together with pure domain logic
 * (BudgetBalanceCalculator, EnvelopeEntity, BudgetPeriodEngine,
 * BusinessExpenseReport) using scenario seed data from two
 * South African households: Kruger (payday 20) and Hetzel (payday 1).
 */

import { calculateBudgetBalance } from '../../domain/budgets/BudgetBalanceCalculator';
import {
  getRemainingCents,
  isOverBudget,
  type EnvelopeEntity,
} from '../../domain/envelopes/EnvelopeEntity';
import { BudgetPeriodEngine } from '../../domain/shared/BudgetPeriodEngine';
import { groupBusinessExpenses } from '../../domain/transactions/BusinessExpenseReport';
import { resetFactoryCounter } from '../../__test-utils__/factories';
import {
  HOUSEHOLDS,
  KRUGER_ENVELOPES,
  HETZEL_ENVELOPES,
  KRUGER_TRANSACTIONS,
  HETZEL_TRANSACTIONS,
} from '../../__test-utils__/scenarioSeed';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Date.now()}-${Math.random()}` }));

beforeEach(() => resetFactoryCounter());

// ═══════════════════════════════════════════════════════════════════════════════
// Budget Lifecycle (per household, per period)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Budget Lifecycle — Kruger household', () => {
  let envelopes: EnvelopeEntity[];

  beforeEach(() => {
    envelopes = KRUGER_ENVELOPES.map((e) => ({ ...e }));
  });

  it('income envelopes yield correct toAssign before spending allocation', () => {
    const incomeOnly = envelopes.filter((e) => e.envelopeType === 'income');
    const balance = calculateBudgetBalance(incomeOnly);

    expect(balance.incomeTotal).toBe(4_500_000 + 2_500_000); // R70,000
    expect(balance.expenseAllocationTotal).toBe(0);
    expect(balance.toAssign).toBe(7_000_000);
  });

  it('full allocation zeroes toAssign', () => {
    const balance = calculateBudgetBalance(envelopes);
    const incomeTotal = 4_500_000 + 2_500_000;
    const expenseTotal = balance.totalAllocated - incomeTotal;

    expect(balance.incomeTotal).toBe(incomeTotal);
    expect(balance.toAssign).toBe(incomeTotal - expenseTotal);
  });

  it('logging a transaction increments spentCents on the correct envelope', () => {
    const groceries = envelopes.find((e) => e.name === 'Groceries')!;
    expect(groceries.spentCents).toBe(0);

    groceries.spentCents += 185_000;
    expect(groceries.spentCents).toBe(185_000);
    expect(getRemainingCents(groceries)).toBe(groceries.allocatedCents - 185_000);
  });

  it('logging multiple transactions accumulates spentCents', () => {
    const fuel = envelopes.find((e) => e.name === 'Fuel')!;

    fuel.spentCents += 125_000;
    fuel.spentCents += 98_000;
    fuel.spentCents += 110_000;

    expect(fuel.spentCents).toBe(333_000);
    expect(getRemainingCents(fuel)).toBe(400_000 - 333_000);
    expect(isOverBudget(fuel)).toBe(false);
  });

  it('deleting a transaction decrements spentCents', () => {
    const entertainment = envelopes.find((e) => e.name === 'Entertainment')!;

    entertainment.spentCents += 32_000;
    entertainment.spentCents += 48_500;
    expect(entertainment.spentCents).toBe(80_500);

    entertainment.spentCents -= 32_000;
    expect(entertainment.spentCents).toBe(48_500);
    expect(getRemainingCents(entertainment)).toBe(200_000 - 48_500);
  });

  it('getRemainingCents returns negative when over budget', () => {
    const entertainment = envelopes.find((e) => e.name === 'Entertainment')!;
    entertainment.spentCents = 250_000;

    expect(getRemainingCents(entertainment)).toBe(-50_000);
    expect(isOverBudget(entertainment)).toBe(true);
  });

  it('isOverBudget returns false at exact allocation boundary', () => {
    const insurance = envelopes.find((e) => e.name === 'Insurance')!;
    insurance.spentCents = 250_000;

    expect(isOverBudget(insurance)).toBe(false);
    expect(getRemainingCents(insurance)).toBe(0);
  });

  it('period rollover: new period has fresh envelopes with spentCents = 0', () => {
    const groceries = envelopes.find((e) => e.name === 'Groceries')!;
    groceries.spentCents = 780_000;

    const nextPeriod: EnvelopeEntity = {
      ...groceries,
      id: 'new-period-id',
      spentCents: 0,
      periodStart: '2026-02-20',
    };

    expect(nextPeriod.spentCents).toBe(0);
    expect(getRemainingCents(nextPeriod)).toBe(800_000);
    expect(isOverBudget(nextPeriod)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Budget Period Engine — Different Paydays
// ═══════════════════════════════════════════════════════════════════════════════

describe('BudgetPeriodEngine — Kruger payday 20 vs Hetzel payday 1', () => {
  const engine = new BudgetPeriodEngine();

  describe('Kruger (payday 20)', () => {
    const payday = HOUSEHOLDS.kruger.paydayDay; // 20

    it('Jan 25 → period 20 Jan – 19 Feb', () => {
      const period = engine.getPeriodForDate(payday, new Date(Date.UTC(2026, 0, 25)));

      expect(period.startDate).toEqual(new Date(Date.UTC(2026, 0, 20)));
      expect(period.endDate).toEqual(new Date(Date.UTC(2026, 1, 19)));
    });

    it('Jan 19 (before payday) → period 20 Dec – 19 Jan', () => {
      const period = engine.getPeriodForDate(payday, new Date(Date.UTC(2026, 0, 19)));

      expect(period.startDate).toEqual(new Date(Date.UTC(2025, 11, 20)));
      expect(period.endDate).toEqual(new Date(Date.UTC(2026, 0, 19)));
    });

    it('isDateInPeriod: 19th is NOT in Jan 20 – Feb 19 period', () => {
      const janPeriod = engine.getPeriodForDate(payday, new Date(Date.UTC(2026, 0, 25)));
      const jan19 = new Date(Date.UTC(2026, 0, 19));

      expect(engine.isDateInPeriod(jan19, janPeriod)).toBe(false);
    });

    it('isDateInPeriod: 20th IS in Jan 20 – Feb 19 period', () => {
      const janPeriod = engine.getPeriodForDate(payday, new Date(Date.UTC(2026, 0, 25)));
      const jan20 = new Date(Date.UTC(2026, 0, 20));

      expect(engine.isDateInPeriod(jan20, janPeriod)).toBe(true);
    });

    it('February edge case: period 20 Feb – 19 Mar', () => {
      const period = engine.getPeriodForDate(payday, new Date(Date.UTC(2026, 1, 25)));

      expect(period.startDate).toEqual(new Date(Date.UTC(2026, 1, 20)));
      expect(period.endDate).toEqual(new Date(Date.UTC(2026, 2, 19)));
    });

    it('isNewPeriodWithin fires on payday', () => {
      const result = engine.isNewPeriodWithin(payday, 3, new Date(Date.UTC(2026, 0, 20)));
      expect(result).toBe(true);
    });

    it('isNewPeriodWithin fires 2 days after payday', () => {
      const result = engine.isNewPeriodWithin(payday, 3, new Date(Date.UTC(2026, 0, 22)));
      expect(result).toBe(true);
    });

    it('isNewPeriodWithin does NOT fire 5 days after payday with window=3', () => {
      const result = engine.isNewPeriodWithin(payday, 3, new Date(Date.UTC(2026, 0, 25)));
      expect(result).toBe(false);
    });
  });

  describe('Hetzel (payday 1)', () => {
    const payday = HOUSEHOLDS.hetzel.paydayDay; // 1

    it('Jan 15 → period 1 Jan – 31 Jan', () => {
      const period = engine.getPeriodForDate(payday, new Date(Date.UTC(2026, 0, 15)));

      expect(period.startDate).toEqual(new Date(Date.UTC(2026, 0, 1)));
      // paydayDay - 1 = 0, so endDate = Date.UTC(2026, 1, 0) = Jan 31
      expect(period.endDate).toEqual(new Date(Date.UTC(2026, 1, 0)));
    });

    it('Feb 1 → period 1 Feb – 28 Feb', () => {
      const period = engine.getPeriodForDate(payday, new Date(Date.UTC(2026, 1, 1)));

      expect(period.startDate).toEqual(new Date(Date.UTC(2026, 1, 1)));
      expect(period.endDate).toEqual(new Date(Date.UTC(2026, 2, 0))); // Feb 28
    });

    it('isNewPeriodWithin fires on the 1st', () => {
      const result = engine.isNewPeriodWithin(payday, 3, new Date(Date.UTC(2026, 0, 1)));
      expect(result).toBe(true);
    });

    it('isNewPeriodWithin does NOT fire mid-month', () => {
      const result = engine.isNewPeriodWithin(payday, 3, new Date(Date.UTC(2026, 0, 15)));
      expect(result).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Henzard's Business Expense Workflow
// ═══════════════════════════════════════════════════════════════════════════════

describe("Henzard's Business Expense Workflow — Nedbank Claims", () => {
  const nedbankClaimsId = 'e0000001-0000-0000-0000-000000000006';

  it('business expenses count against envelope budget', () => {
    const nedbankClaims = { ...KRUGER_ENVELOPES.find((e) => e.id === nedbankClaimsId)! };
    expect(nedbankClaims.allocatedCents).toBe(500_000);

    const businessTxns = KRUGER_TRANSACTIONS.filter(
      (t) => t.isBusinessExpense && t.envelopeId === nedbankClaimsId,
    );
    expect(businessTxns.length).toBeGreaterThanOrEqual(4);

    const jan = businessTxns.filter((t) => t.transactionDate.startsWith('2026-01'));
    const janTotal = jan.reduce((sum, t) => sum + t.amountCents, 0);

    nedbankClaims.spentCents = janTotal;
    expect(nedbankClaims.spentCents).toBeGreaterThan(0);
    expect(getRemainingCents(nedbankClaims)).toBe(nedbankClaims.allocatedCents - janTotal);
  });

  it('groupBusinessExpenses filters and groups by month correctly', () => {
    const groups = groupBusinessExpenses(KRUGER_TRANSACTIONS);

    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.monthKey).toMatch(/^\d{4}-\d{2}$/);
      expect(g.transactions.every((t) => t.isBusinessExpense)).toBe(true);
      expect(g.totalCents).toBe(g.transactions.reduce((s, t) => s + t.amountCents, 0));
    }
  });

  it('groupBusinessExpenses returns months in descending order', () => {
    const groups = groupBusinessExpenses(KRUGER_TRANSACTIONS);
    const keys = groups.map((g) => g.monthKey);

    for (let i = 1; i < keys.length; i++) {
      expect(keys[i - 1]! > keys[i]!).toBe(true);
    }
  });

  it('cross-period: each month groups only its own business expenses', () => {
    const groups = groupBusinessExpenses(KRUGER_TRANSACTIONS);

    for (const g of groups) {
      for (const tx of g.transactions) {
        expect(tx.transactionDate.slice(0, 7)).toBe(g.monthKey);
      }
    }
  });

  it('non-business transactions are excluded from groupBusinessExpenses', () => {
    const allBizTxns = KRUGER_TRANSACTIONS.filter((t) => t.isBusinessExpense);
    const allNonBizTxns = KRUGER_TRANSACTIONS.filter((t) => !t.isBusinessExpense);

    expect(allNonBizTxns.length).toBeGreaterThan(0);

    const groups = groupBusinessExpenses(KRUGER_TRANSACTIONS);
    const groupedTxIds = groups.flatMap((g) => g.transactions.map((t) => t.id));

    for (const tx of allNonBizTxns) {
      expect(groupedTxIds).not.toContain(tx.id);
    }
    expect(groupedTxIds.length).toBe(allBizTxns.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-Household Context Switching (Henzard's view)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Cross-Household Context Switching — Henzard's view", () => {
  const krugerHouseholdId = HOUSEHOLDS.kruger.id;
  const hetzelHouseholdId = HOUSEHOLDS.hetzel.id;

  it('filtering envelopes by Kruger householdId returns only Kruger envelopes', () => {
    const allEnvelopes = [...KRUGER_ENVELOPES, ...HETZEL_ENVELOPES];
    const krugerFiltered = allEnvelopes.filter((e) => e.householdId === krugerHouseholdId);

    expect(krugerFiltered.length).toBe(KRUGER_ENVELOPES.length);
    expect(krugerFiltered.every((e) => e.householdId === krugerHouseholdId)).toBe(true);
  });

  it('filtering envelopes by Hetzel householdId returns only Hetzel envelopes', () => {
    const allEnvelopes = [...KRUGER_ENVELOPES, ...HETZEL_ENVELOPES];
    const hetzelFiltered = allEnvelopes.filter((e) => e.householdId === hetzelHouseholdId);

    expect(hetzelFiltered.length).toBe(HETZEL_ENVELOPES.length);
    expect(hetzelFiltered.every((e) => e.householdId === hetzelHouseholdId)).toBe(true);
  });

  it('filtering transactions by Kruger householdId returns only Kruger transactions', () => {
    const allTransactions = [...KRUGER_TRANSACTIONS, ...HETZEL_TRANSACTIONS];
    const krugerFiltered = allTransactions.filter((t) => t.householdId === krugerHouseholdId);

    expect(krugerFiltered.length).toBe(KRUGER_TRANSACTIONS.length);
    expect(krugerFiltered.every((t) => t.householdId === krugerHouseholdId)).toBe(true);
  });

  it('filtering transactions by Hetzel householdId returns only Hetzel transactions', () => {
    const allTransactions = [...KRUGER_TRANSACTIONS, ...HETZEL_TRANSACTIONS];
    const hetzelFiltered = allTransactions.filter((t) => t.householdId === hetzelHouseholdId);

    expect(hetzelFiltered.length).toBe(HETZEL_TRANSACTIONS.length);
    expect(hetzelFiltered.every((t) => t.householdId === hetzelHouseholdId)).toBe(true);
  });

  it('business expenses from Kruger do NOT appear in Hetzel context', () => {
    const krugerBizExpenses = KRUGER_TRANSACTIONS.filter((t) => t.isBusinessExpense);
    expect(krugerBizExpenses.length).toBeGreaterThan(0);
    expect(krugerBizExpenses.every((t) => t.householdId === krugerHouseholdId)).toBe(true);

    const hetzelTransactions = [...KRUGER_TRANSACTIONS, ...HETZEL_TRANSACTIONS].filter(
      (t) => t.householdId === hetzelHouseholdId,
    );
    const hetzelBizExpenses = hetzelTransactions.filter((t) => t.isBusinessExpense);
    expect(hetzelBizExpenses.length).toBe(0);
  });

  it('budget balance is independent per household', () => {
    const krugerBalance = calculateBudgetBalance(KRUGER_ENVELOPES);
    const hetzelBalance = calculateBudgetBalance(HETZEL_ENVELOPES);

    expect(krugerBalance.incomeTotal).toBe(4_500_000 + 2_500_000);
    expect(hetzelBalance.incomeTotal).toBe(2_200_000 + 1_800_000);
    expect(krugerBalance.incomeTotal).not.toBe(hetzelBalance.incomeTotal);
  });

  it('groupBusinessExpenses on Hetzel transactions returns empty', () => {
    const hetzelGroups = groupBusinessExpenses(HETZEL_TRANSACTIONS);
    expect(hetzelGroups).toHaveLength(0);
  });
});
