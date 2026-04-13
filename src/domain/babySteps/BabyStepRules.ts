/**
 * BabyStepRules — single source of truth for all per-step copy and evaluation metadata.
 *
 * This file is referenced by:
 *  - BabyStepEvaluator (evaluation logic)
 *  - LocalNotificationScheduler (notification title/body)
 *  - toastStore (regression toast copy)
 *  - CelebrationModal (completion message)
 */

export interface BabyStepRule {
  stepNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  shortTitle: string;
  description: string;
  completionMessage: string;
  /** null for manual steps (4/5/7) — they have no automatic regression path */
  regressionToast: string | null;
  progressTemplate: string | null;
  notificationTitle: string;
  notificationBody: string;
  /** true for steps 4, 5, 7 — toggled by user */
  isManual: boolean;
}

export const BABY_STEP_RULES: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, BabyStepRule> = {
  1: {
    stepNumber: 1,
    shortTitle: 'Starter Fund',
    description: 'Save R1,000 as your first emergency buffer.',
    completionMessage: 'You saved your first R1,000. The foundation is laid.',
    regressionToast:
      'Your Starter Fund dropped below R1,000 — Step 1 is paused until the balance recovers.',
    progressTemplate: 'R{current} of R{target}',
    notificationTitle: 'Step 1 Complete — Starter Fund',
    notificationBody: 'You saved your first R1,000. The foundation is laid.',
    isManual: false,
  },
  2: {
    stepNumber: 2,
    shortTitle: 'Debt Free',
    description: 'Pay off every debt except the house.',
    completionMessage: 'Every debt, gone. You owe no one but the bond.',
    regressionToast: 'A non-bond debt is back on the books — Step 2 is paused.',
    progressTemplate: '{current} of {target} debts cleared',
    notificationTitle: 'Step 2 Complete — Debt Free',
    notificationBody: 'Every debt, gone. You owe no one but the bond.',
    isManual: false,
  },
  3: {
    stepNumber: 3,
    shortTitle: 'Full Emergency Fund',
    description: 'Save 3 to 6 months of expenses.',
    completionMessage: 'Three months of expenses, saved. You\'re protected.',
    regressionToast:
      'Your emergency fund fell below 3 months of expenses — Step 3 is paused.',
    progressTemplate: 'R{current} of R{target}',
    notificationTitle: 'Step 3 Complete — Full Emergency Fund',
    notificationBody: 'Three months of expenses, saved. You\'re protected.',
    isManual: false,
  },
  4: {
    stepNumber: 4,
    shortTitle: 'Invest 15%',
    description: 'Put 15% of income into retirement.',
    completionMessage: 'You\'re investing in the long game now.',
    regressionToast: null,
    progressTemplate: null,
    notificationTitle: 'Step 4 Complete — Invest 15%',
    notificationBody: 'You\'re investing in the long game now.',
    isManual: true,
  },
  5: {
    stepNumber: 5,
    shortTitle: 'College Fund',
    description: "Save for your children's education.",
    completionMessage: 'One of the hardest steps — and you did it.',
    regressionToast: null,
    progressTemplate: null,
    notificationTitle: 'Step 5 Complete — College Fund',
    notificationBody: 'One of the hardest steps — and you did it.',
    isManual: true,
  },
  6: {
    stepNumber: 6,
    shortTitle: 'House Free',
    description: 'Pay off the bond.',
    completionMessage: 'No debt. No bond. The house is yours.',
    regressionToast: 'The bond is back — Step 6 is paused.',
    progressTemplate: 'R{current} of R{target}',
    notificationTitle: 'Step 6 Complete — House Free',
    notificationBody: 'No debt. No bond. The house is yours.',
    isManual: false,
  },
  7: {
    stepNumber: 7,
    shortTitle: 'Build & Give',
    description: 'Build wealth. Give generously.',
    completionMessage: 'You have enough — and you\'re giving.',
    regressionToast: null,
    progressTemplate: null,
    notificationTitle: 'Step 7 Complete — Build & Give',
    notificationBody: 'You have enough — and you\'re giving.',
    isManual: true,
  },
};

/** Convenience accessor for notification copy, keyed by step number. */
export const NOTIFICATION_COPY: Record<
  1 | 2 | 3 | 4 | 5 | 6 | 7,
  { title: string; body: string }
> = Object.fromEntries(
  (Object.values(BABY_STEP_RULES) as BabyStepRule[]).map((r) => [
    r.stepNumber,
    { title: r.notificationTitle, body: r.notificationBody },
  ]),
) as Record<1 | 2 | 3 | 4 | 5 | 6 | 7, { title: string; body: string }>;

/** The set of manual step numbers. */
export const MANUAL_STEP_NUMBERS = new Set<number>([4, 5, 7]);
