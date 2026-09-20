import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WelcomeStep } from './WelcomeStep';
import { IncomeStep } from './IncomeStep';
import { PaydayStep } from './PaydayStep';
import { ExpenseCategoriesStep } from './ExpenseCategoriesStep';
import { AllocateEnvelopesStep } from './AllocateEnvelopesStep';
import { ScoreIntroStep } from './ScoreIntroStep';
import { FinishStep } from './FinishStep';
import type { OnboardingStackParamList } from '../../../navigation/types';

export type { OnboardingStackParamList };

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/**
 * Step order matters for correctness, not just flow.
 *
 * `Payday` runs BEFORE `AllocateEnvelopes` (UX-5/DOM-6). It used to run after
 * it, so `AllocateEnvelopesStep` stamped every new envelope with a
 * `period_start` derived from the payday the household was created with, and
 * `PaydayStep` then changed the payday one screen later — moving the current
 * period key and orphaning the entire budget the user had just built.
 * Confirming payday first means the envelopes are stamped with the key the
 * dashboard will actually query. (`UpdateHouseholdPaydayDayUseCase` now also
 * re-keys the current period's rows, so a LATER payday change from Settings
 * is safe too; the ordering is what stops the problem arising during
 * onboarding at all.)
 *
 * Payday sits ahead of `ExpenseCategories` rather than between it and
 * `AllocateEnvelopes` so that `ExpenseCategories -> AllocateEnvelopes` stays a
 * DIRECT hop: the selected categories travel as that route's own param, and
 * threading them through an intervening screen would mean widening the shared
 * `OnboardingStackParamList` just to carry data Payday has no use for. It
 * also reads better — income, then payday, then what the money is for.
 *
 * `MeterSetup` is gone (UX-15): it was three switches whose state nothing
 * ever read or persisted, so it asked the user a question that had no effect.
 * Meter tracking needs no opt-in — logging a reading is the opt-in.
 */
export function OnboardingNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Welcome" component={WelcomeStep} />
      <Stack.Screen name="Income" component={IncomeStep} />
      <Stack.Screen name="Payday" component={PaydayStep} />
      <Stack.Screen name="ExpenseCategories" component={ExpenseCategoriesStep} />
      <Stack.Screen name="AllocateEnvelopes" component={AllocateEnvelopesStep} />
      <Stack.Screen name="ScoreIntro" component={ScoreIntroStep} />
      <Stack.Screen name="Finish" component={FinishStep} />
    </Stack.Navigator>
  );
}
