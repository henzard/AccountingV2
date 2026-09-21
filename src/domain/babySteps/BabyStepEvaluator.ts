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
 *
 * Steps 2 and 6 — the "N/A" case (zero applicable debts):
 * Ramsey's rule is that a step which does not apply is SKIPPED, not that a
 * household with no debts on file is automatically "debt free". A brand-new
 * household that simply has not entered its debts yet must not be told it
 * has finished Step 2/6.
 *
 * IMPORTANT — `isCompleted` for this vacuous case is ALWAYS `false`, exactly
 * as on master, and MUST STAY that way: `baby_steps` is a SYNCED table with
 * older app builds in the field. If this evaluator reported `isCompleted:
 * true` for a skip, `ReconcileBabyStepsUseCase` would persist that to the
 * synced row — an older build (running the pre-skip evaluator) would then
 * read the same household, evaluate the same step as `false`, and write a
 * regression; the newer build would flip it back; repeat forever. So the
 * "skipped" fact is carried ONLY on `isSkipped` (see `EvaluatedStep`), a
 * field `ReconcileBabyStepsUseCase` does not read or forward into its
 * persisted row OR into the `BabyStepStatus[]` it returns — it is consumed
 * exclusively by `evaluate()`'s own caller-side logic here (to gate Step 6's
 * skip eligibility) and by this module's `inferBabyStepSkips`, which
 * re-derives the same fact PURELY from already-returned `BabyStepStatus`
 * data (never from anything new persisted) for the presentation layer. See
 * `inferBabyStepSkips` below and its use in BabyStepsScreen.tsx / useBabySteps.ts.
 *
 * `progress` stays `null` for this vacuous case (as it already is for the
 * "no debts at all" case) regardless of skip eligibility — non-null the
 * instant there is at least one applicable debt (paid or not) — which is
 * exactly the signal `inferBabyStepSkips` relies on. Adding a first debt
 * later drops `nonBondDebts.length` back above zero, which falls through to
 * the normal paid/unpaid check — that un-completes (and un-skips) the step
 * exactly like any other regression.
 *
 * "balance_cents" of the EMF is its SAVED balance, supplied by the caller via
 * `savedCentsByEnvelopeId` — NOT `allocatedCents - spentCents`. The EMF is a
 * persistent envelope whose `allocatedCents` is the MONTHLY contribution the
 * household budgets, so the old subtraction made Step 1 complete the instant
 * someone typed R1,000 into the allocation field, and made budgeting
 * R500/month never complete it at all. Real savings accumulate one
 * contribution per rolled-over period (see `PersistentContributions` /
 * `getPersistentEnvelopeSavedCents`).
 */

import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';
import { getEnvelopeScope } from '../envelopes/EnvelopeEntity';
import type { DebtEntity } from '../debtSnowball/DebtEntity';
import type { BabyStepStatus } from './types';
import { BABY_STEP_RULES } from './BabyStepRules';

export interface EvaluatorInput {
  /** Current-period envelopes (caller pre-filters to current period) */
  envelopes: EnvelopeEntity[];
  /**
   * Derived saved balance per PERSISTENT envelope id (see
   * `getPersistentEnvelopeSavedCents`). An id missing from the map has never
   * been funded and evaluates as 0 — it never falls back to `allocatedCents`,
   * which would re-introduce the "complete Step 1 by typing R1,000" bug.
   */
  savedCentsByEnvelopeId: ReadonlyMap<string, number>;
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

/**
 * One step's evaluation. `isIndeterminate` means the step's rule could not be
 * decided from the data available — its inputs are UNKNOWN, not unmet — so
 * `isCompleted` carries no information and the caller must keep whatever is
 * already persisted rather than treat the step as incomplete. Only Step 3
 * can currently be indeterminate (income not yet captured for the period).
 */
export interface EvaluatedStep extends Omit<BabyStepStatus, 'completedAt' | 'celebratedAt'> {
  isIndeterminate: boolean;
  /**
   * IN-MEMORY ONLY — never persisted, never forwarded by
   * `ReconcileBabyStepsUseCase` into its DB write or into the
   * `BabyStepStatus[]` it returns. `true` only for Step 2/6 when there are
   * zero applicable debts AND every step before it is already done (or
   * itself skipped) — see the "Steps 2 and 6" note above. Absent/`false`
   * everywhere else.
   */
  isSkipped: boolean;
}

/**
 * Returns balance_cents for an envelope.
 *
 * PERSISTENT envelopes (the EMF included) read their derived saved balance
 * from `savedCents`; only PERIOD-scoped envelopes, whose `allocatedCents` is
 * genuinely this period's budget, use `allocated - spent`.
 */
function balanceCents(e: EnvelopeEntity, savedCents: ReadonlyMap<string, number>): number {
  if (getEnvelopeScope(e) === 'persistent') {
    return savedCents.get(e.id) ?? 0;
  }
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

function evaluateStep1(
  envelopes: EnvelopeEntity[],
  savedCents: ReadonlyMap<string, number>,
): Pick<BabyStepStatus, 'isCompleted' | 'progress'> {
  const emf = findEMF(envelopes);
  if (!emf) {
    return { isCompleted: false, progress: null };
  }
  const balance = balanceCents(emf, savedCents);
  const target = 100_000; // R1,000 in cents
  return {
    isCompleted: balance >= target,
    progress: { current: balance, target, unit: 'cents' },
  };
}

function evaluateStep2(
  debts: DebtEntity[],
  step1Completed: boolean,
): Pick<BabyStepStatus, 'isCompleted' | 'progress'> & { isSkipped: boolean } {
  const nonBondDebts = debts.filter((d) => d.debtType !== 'bond');
  if (nonBondDebts.length === 0) {
    // No non-bond debts to pay off. `isCompleted` STAYS false (matches
    // master exactly — see the SYNCED-table note at the top of this file);
    // `isSkipped` carries the "this step doesn't apply" fact, gated on Step 1
    // already being done so a brand-new household isn't told it skipped
    // ahead of Step 1 before ever entering a debt.
    return { isCompleted: false, progress: null, isSkipped: step1Completed };
  }
  const paidCount = nonBondDebts.filter(
    (d) => d.isPaidOff || d.outstandingBalanceCents === 0,
  ).length;
  const allPaid = paidCount === nonBondDebts.length;
  return {
    isCompleted: allPaid,
    progress: { current: paidCount, target: nonBondDebts.length, unit: 'count' },
    isSkipped: false,
  };
}

function evaluateStep3(
  envelopes: EnvelopeEntity[],
  monthlyExpenseBaseline: number,
  savedCents: ReadonlyMap<string, number>,
): Pick<EvaluatedStep, 'isCompleted' | 'progress' | 'isIndeterminate'> {
  const emf = findEMF(envelopes);
  if (!emf) {
    return { isCompleted: false, progress: null, isIndeterminate: false };
  }
  const incomeTotal = computeIncomeTotal(envelopes);
  if (incomeTotal === 0) {
    // INCOME_TOTAL = 0 means the target (3 x monthly expenses) is UNKNOWN,
    // not that it is unmet — and it is 0 in a perfectly normal situation: a
    // period that has just been rolled into before its income envelopes have
    // been filled in. Reporting `isCompleted: false` there made Step 3
    // "regress" every single month, clearing completed_at and firing a
    // regression toast, only to re-complete once income was entered. So the
    // step is reported as INDETERMINATE and the caller
    // (`ReconcileBabyStepsUseCase`) keeps the persisted state untouched —
    // no write, no toast.
    return { isCompleted: false, progress: null, isIndeterminate: true };
  }
  // monthlyExpenseBaseline is in ZAR; target is 3 months in cents
  const targetCents = Math.floor(3 * monthlyExpenseBaseline * 100);
  const balance = balanceCents(emf, savedCents);
  return {
    isCompleted: balance >= targetCents,
    progress: { current: balance, target: targetCents, unit: 'cents' },
    isIndeterminate: false,
  };
}

function evaluateStep6(
  debts: DebtEntity[],
  earlierStepsCompleted: boolean,
): Pick<BabyStepStatus, 'isCompleted' | 'progress'> & { isSkipped: boolean } {
  const bondDebts = debts.filter((d) => d.debtType === 'bond');
  if (bondDebts.length === 0) {
    // No bond. `isCompleted` STAYS false — see the SYNCED-table note at the
    // top of this file. `isSkipped` is gated on Steps 1-5 already being done
    // (a skipped Step 2 counts as "done" for this gate — see `evaluate()`).
    return { isCompleted: false, progress: null, isSkipped: earlierStepsCompleted };
  }
  const allPaid = bondDebts.every((d) => d.isPaidOff || d.outstandingBalanceCents === 0);
  return {
    isCompleted: allPaid,
    // For Step 6, current = sum of outstanding paid, target = total bond count is not how spec shows it.
    // Spec progress: 'R{current} of R{target}' — use remaining balance (outstanding) as current progress
    // Actually spec says progress template for 6 is R{current} of R{target}, so we use cents like step 1/3.
    // We'll report paid vs total bond count in cents: outstanding vs initial
    progress: {
      current: bondDebts.reduce(
        (s, d) => s + (d.initialBalanceCents - d.outstandingBalanceCents),
        0,
      ),
      target: bondDebts.reduce((s, d) => s + d.initialBalanceCents, 0),
      unit: 'cents',
    },
    isSkipped: false,
  };
}

/**
 * Pure evaluator. Returns a status for all 7 steps based on current data.
 *
 * Does NOT read timestamps — `completedAt` and `celebratedAt` come from persisted rows
 * and are threaded through by ReconcileBabyStepsUseCase.
 */
export function evaluate(input: EvaluatorInput): EvaluatedStep[] {
  const { envelopes, debts, monthlyExpenseBaseline, manualFlags, savedCentsByEnvelopeId } = input;

  const step1 = evaluateStep1(envelopes, savedCentsByEnvelopeId);
  const step2 = evaluateStep2(debts, step1.isCompleted);
  const step3 = evaluateStep3(envelopes, monthlyExpenseBaseline, savedCentsByEnvelopeId);
  // Step 6 is only eligible to be skipped once every step before it is
  // effectively done — a SKIPPED Step 2 counts as done for this gate (a
  // household with neither non-bond nor bond debts must be able to skip
  // straight from Step 1 to Step 3, not get stuck because Step 2 is
  // "incomplete"). Step 3's `isCompleted` is `false` both when it is
  // genuinely unmet and when it is indeterminate (income not yet entered
  // this period) — either way "unknown/unmet" is the safe default for
  // gating a later step's skip, so no separate indeterminate check is
  // needed here.
  const step2EffectivelyDone = step2.isCompleted || step2.isSkipped;
  const earlierStepsCompletedForStep6 =
    step1.isCompleted &&
    step2EffectivelyDone &&
    step3.isCompleted &&
    manualFlags[4] &&
    manualFlags[5];
  const step6 = evaluateStep6(debts, earlierStepsCompletedForStep6);

  return [
    {
      stepNumber: 1,
      isManual: BABY_STEP_RULES[1].isManual,
      isIndeterminate: false,
      isSkipped: false,
      ...step1,
    },
    { stepNumber: 2, isManual: BABY_STEP_RULES[2].isManual, isIndeterminate: false, ...step2 },
    { stepNumber: 3, isManual: BABY_STEP_RULES[3].isManual, isSkipped: false, ...step3 },
    {
      stepNumber: 4,
      isManual: BABY_STEP_RULES[4].isManual,
      isCompleted: manualFlags[4],
      progress: null,
      isIndeterminate: false,
      isSkipped: false,
    },
    {
      stepNumber: 5,
      isManual: BABY_STEP_RULES[5].isManual,
      isCompleted: manualFlags[5],
      progress: null,
      isIndeterminate: false,
      isSkipped: false,
    },
    { stepNumber: 6, isManual: BABY_STEP_RULES[6].isManual, isIndeterminate: false, ...step6 },
    {
      stepNumber: 7,
      isManual: BABY_STEP_RULES[7].isManual,
      isCompleted: manualFlags[7],
      progress: null,
      isIndeterminate: false,
      isSkipped: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Presentation-layer helper — re-derives skips from ALREADY-RETURNED statuses
// ---------------------------------------------------------------------------

/**
 * Result of re-deriving Step 2/6 "no applicable debts" skips from a
 * `BabyStepStatus[]` — i.e. from what `ReconcileBabyStepsUseCase` actually
 * returns to the UI, NOT from `evaluate()`'s own `isSkipped` (which never
 * leaves this module's caller — see the "Steps 2 and 6" note above).
 */
export interface BabyStepSkipInference {
  /** Step numbers (only ever 2 and/or 6) inferred as a vacuous skip. */
  skippedStepNumbers: ReadonlySet<number>;
  /** True once a step is done for PROGRESSION purposes — genuinely completed OR skipped. */
  isEffectivelyDone: (stepNumber: number) => boolean;
}

/**
 * Presentation-layer only. `ReconcileBabyStepsUseCase` persists (and
 * returns) `isCompleted: false` for a Step 2/6 vacuous skip — deliberately,
 * so nothing new is ever written to the SYNCED `baby_steps` table (see the
 * "Steps 2 and 6" note above). That means the UI must re-derive "this step
 * doesn't apply, don't block progress on it" PURELY from the
 * already-returned `BabyStepStatus[]`, using exactly the same signal the
 * evaluator uses internally: `progress` is `null` on Step 2/6 ONLY when
 * there are zero applicable debts on file (non-null the instant there is at
 * least one, paid or not), and a step is only skip-eligible once every step
 * before it is itself done or skipped.
 *
 * Used by BabyStepsScreen.tsx (current step / future steps / "skipped"
 * notice) and SevenDotPath.tsx (dashboard progress bar) — never by anything
 * that writes to the DB.
 */
export function inferBabyStepSkips(statuses: readonly BabyStepStatus[]): BabyStepSkipInference {
  const byStep = new Map(statuses.map((s) => [s.stepNumber, s]));
  const skippedStepNumbers = new Set<number>();
  const doneByStep = new Map<number, boolean>();

  let allEarlierDone = true; // vacuously true "before" Step 1
  for (let n = 1; n <= 7; n += 1) {
    const status = byStep.get(n as BabyStepStatus['stepNumber']);
    if (!status) {
      // No data for this step — cannot be considered done, and nothing
      // after it can be considered gated-open either.
      allEarlierDone = false;
      continue;
    }

    const isSkip: boolean =
      (n === 2 || n === 6) && !status.isCompleted && status.progress === null && allEarlierDone;
    if (isSkip) skippedStepNumbers.add(n);

    const done: boolean = status.isCompleted || isSkip;
    doneByStep.set(n, done);
    allEarlierDone = allEarlierDone && done;
  }

  return {
    skippedStepNumbers,
    isEffectivelyDone: (stepNumber: number): boolean => doneByStep.get(stepNumber) ?? false,
  };
}
