import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WelcomeStep } from './WelcomeStep';
import { IncomeStep } from './IncomeStep';
import { ExpenseCategoriesStep } from './ExpenseCategoriesStep';
import { AllocateEnvelopesStep } from './AllocateEnvelopesStep';
import { PaydayStep } from './PaydayStep';
import { MeterSetupStep } from './MeterSetupStep';
import { ScoreIntroStep } from './ScoreIntroStep';
import { FinishStep } from './FinishStep';
import type { OnboardingStackParamList } from '../../../navigation/types';

export type { OnboardingStackParamList };

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Welcome" component={WelcomeStep} />
      <Stack.Screen name="Income" component={IncomeStep} />
      <Stack.Screen name="ExpenseCategories" component={ExpenseCategoriesStep} />
      <Stack.Screen name="AllocateEnvelopes" component={AllocateEnvelopesStep} />
      <Stack.Screen name="Payday" component={PaydayStep} />
      <Stack.Screen name="MeterSetup" component={MeterSetupStep} />
      <Stack.Screen name="ScoreIntro" component={ScoreIntroStep} />
      <Stack.Screen name="Finish" component={FinishStep} />
    </Stack.Navigator>
  );
}
