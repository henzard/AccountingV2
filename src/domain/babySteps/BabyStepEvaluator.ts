/**
 * BabyStepEvaluator — pure function, no repository access, no clock reads.
 *
 * Spec §The 7 Baby Steps — completion rules:
 *
 * EMF = first envelope with type='emergency_fund' AND !archived, ordered by created_at ASC
 * INCOME_TOTAL = sum(allocatedCents WHERE type='income' AND !archived)
 * monthlyExpenseBaseline = INCOME_TOTAL / 100 (ZAR)
 *
 * Step 1: EMF != null AND EMF.balance_cents >= 100_000
 * Step 2: count(non-bond, !archived debts) > 0 AND all such debts paid off
 * Step 3: EMF != null AND INCOME_TOTAL > 0 AND EMF.balance_cents >= 3 * monthlyExpenseBaseline * 100
 * Step 4: manualFlags[4] === true
 * Step 5: manualFlags[5] === true
 * Step 6: count(bond, !archived debts) > 0 AND all such debts paid off
 * Step 7: manualFlags[7] === true
 */

import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';
import type { DebtEntity } from '../debtSnowball/DebtEntity';
import type { BabyStepStatus } from './types';

export interface EvaluatorInput {
  /** Current-period envelopes (caller pre-filters to current period) */
  envelopes: EnvelopeEntity[];
  /** All non-archived debts for the household */
  debts: DebtEntity[];
  /**
   * monthlyExpenseBaseline = INCOME_TOTAL / 100.
   * Passed pre-computed so the evaluator stays pure (no re-derivation from envelopes
   * is needed — caller passes it via ReconcileBabyStepsUseCase which computes it
   * using BudgetBalanceCalculator).
   */
  monthlyExpenseBaseline: number;
  /**
   * Current persisted manual completion flags for steps 4, 5, 7.
   * These come from the baby_steps DB rows.
   */
  manualFlags: {
    4: boolean;
    5: boolean;
    7: boolean;
  };
}

/** Returns balance_cents for an envelope: allocated - spent */
function balanceCents(e: EnvelopeEntity): number {
  return e.allocatedCents - e.spentCents;
}

/** Finds the Emergency Fund envelope: oldest non-archived emergency_fund by createdAt */
function findEMF(envelopes: EnvelopeEntity[]): EnvelopeEntity | null {
  const candidates = envelopes
    .filter((e) => e.envelopeType === 'emergency_fund' && !e.isArchived)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return candidates[0] ?? null;
}

/** Computes INCOME_TOTAL from the passed envelope list */
function computeIncomeTotal(envelopes: EnvelopeEntity[]): number {
  return envelopes
    .filter((e) => e.envelopeType === 'income' && !e.isArchived)
    .reduce((sum, e) => sum + e.allocatedCents, 0);
}

function evaluateStep1(envelopes: EnvelopeEntity[]): Pick<BabyStepStatus, 'isCompleted' | 'progress'> {
  const emf = findEMF(envelopes);
  if (!emf) {
    return { isCompleted: false, progress: null };
  }
  const balance = balanceCents(emf);
  const target = 100_000; // R1,000 in cents
  return {
    isCompleted: balance >= target,
    progress: { current: balance, target, unit: 'cents' },
  };
}

function evaluateStep2(debts: DebtEntity[]): Pick<BabyStepStatus, 'isCompleted' | 'progress'> {
  const nonBondDebts = debts.filter(
    (d) => d.debtType !== 'bond' && !('isArchived' in d && (d as Record<string, unknown>).isArchived),
  );
  if (nonBondDebts.length === 0) {
    return { isCompleted: false, progress: null };
  }
  const paidCount = nonBondDebts.filter(
    (d) => d.isPaidOff || d.outstandingBalanceCents === 0,
  ).length;
  const allPaid = paidCount === nonBondDebts.length;
  return {
    isCompleted: allPaid,
    progress: { current: paidCount, target: nonBondDebts.length, unit: 'count' },
  };
}

function evaluateStep3(
  envelopes: EnvelopeEntity[],
  monthlyExpenseBaseline: number,
): Pick<BabyStepStatus, 'isCompleted' | 'progress'> {
  const emf = findEMF(envelopes);
  if (!emf) {
    return { isCompleted: false, progress: null };
  }
  const incomeTotal = computeIncomeTotal(envelopes);
  if (incomeTotal === 0) {
    // Blocked: INCOME_TOTAL = 0 → never auto-completes from zero-divided-by-zero
    return { isCompleted: false, progress: null };
  }
  // monthlyExpenseBaseline is in ZAR; target is 3 months in cents
  const targetCents = Math.floor(3 * monthlyExpenseBaseline * 100);
  const balance = balanceCents(emf);
  return {
    isCompleted: balance >= targetCents,
    progress: { current: balance, target: targetCents, unit: 'cents' },
  };
}

function evaluateStep6(debts: DebtEntity[]): Pick<BabyStepStatus, 'isCompleted' | 'progress'> {
  const bondDebts = debts.filter(
    (d) => d.debtType === 'bond' && !('isArchived' in d && (d as Record<string, unknown>).isArchived),
  );
  if (bondDebts.length === 0) {
    return { isCompleted: false, progress: null };
  }
  const allPaid = bondDebts.every(
    (d) => d.isPaidOff || d.outstandingBalanceCents === 0,
  );
  return {
    isCompleted: allPaid,
    // For Step 6, current = sum of outstanding paid, target = total bond count is not how spec shows it.
    // Spec progress: 'R{current} of R{target}' — use remaining balance (outstanding) as current progress
    // Actually spec says progress template for 6 is R{current} of R{target}, so we use cents like step 1/3.
    // We'll report paid vs total bond count in cents: outstanding vs initial
    progress: {
      current: bondDebts.reduce((s, d) => s + (d.initialBalanceCents - d.outstandingBalanceCents), 0),
      target: bondDebts.reduce((s, d) => s + d.initialBalanceCents, 0),
      unit: 'cents',
    },
  };
}

/**
 * Pure evaluator. Returns a status for all 7 steps based on current data.
 *
 * Does NOT read timestamps — `completedAt` and `celebratedAt` come from persisted rows
 * and are threaded through by ReconcileBabyStepsUseCase.
 */
export function evaluate(input: EvaluatorInput): Omit<BabyStepStatus, 'completedAt' | 'celebratedAt'>[] {
  const { envelopes, debts, monthlyExpenseBaseline, manualFlags } = input;

  const step1 = evaluateStep1(envelopes);
  const step2 = evaluateStep2(debts);
  const step3 = evaluateStep3(envelopes, monthlyExpenseBaseline);
  const step6 = evaluateStep6(debts);

  return [
    { stepNumber: 1, isManual: false, ...step1 },
    { stepNumber: 2, isManual: false, ...step2 },
    { stepNumber: 3, isManual: false, ...step3 },
    { stepNumber: 4, isManual: true, isCompleted: manualFlags[4], progress: null },
    { stepNumber: 5, isManual: true, isCompleted: manualFlags[5], progress: null },
    { stepNumber: 6, isManual: false, ...step6 },
    { stepNumber: 7, isManual: true, isCompleted: manualFlags[7], progress: null },
  ];
}
