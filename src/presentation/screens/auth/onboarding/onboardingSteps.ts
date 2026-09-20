/**
 * The onboarding wizard's step order — the single source of truth for both
 * `OnboardingNavigator`'s route list and every step's progress dots.
 *
 * It lives in this leaf module rather than in the navigator so that a step
 * asking "which number am I?" does not transitively import every OTHER step
 * (and, through `FinishStep`, AsyncStorage) just to read a constant.
 *
 * Deriving the numbers instead of hard-coding `step={5} totalSteps={8}` per
 * screen is what stops the dots lying after a step is added or removed — they
 * already did: the wizard advertised 8 steps while rendering a `MeterSetup`
 * screen that has since been deleted for doing nothing (UX-15).
 */
export const ONBOARDING_STEP_ORDER = [
  'Welcome',
  'Income',
  'Payday',
  'ExpenseCategories',
  'AllocateEnvelopes',
  'ScoreIntro',
  'Finish',
] as const;

export type OnboardingStepName = (typeof ONBOARDING_STEP_ORDER)[number];

export const ONBOARDING_TOTAL_STEPS = ONBOARDING_STEP_ORDER.length;

/** 1-based position of `name` in the wizard, for `OnboardingStepLayout`'s `step` prop. */
export function onboardingStepNumber(name: OnboardingStepName): number {
  return ONBOARDING_STEP_ORDER.indexOf(name) + 1;
}
