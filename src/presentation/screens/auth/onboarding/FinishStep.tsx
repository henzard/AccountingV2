import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { markOnboardingComplete } from '../../../../infrastructure/storage/onboardingFlag';
import { useAppStore } from '../../../stores/appStore';
import type { OnboardingStackParamList } from './OnboardingNavigator';
import { ONBOARDING_TOTAL_STEPS, onboardingStepNumber } from './onboardingSteps';
import { OnboardingStepLayout } from './OnboardingStepLayout';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Finish'>;

export function FinishStep(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const session = useAppStore((s) => s.session);
  const householdId = useAppStore((s) => s.householdId);
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted);
  const [loading, setLoading] = useState(false);

  const handleDone = async (): Promise<void> => {
    setLoading(true);
    try {
      const userId = session?.user?.id;
      if (userId && householdId) {
        // Non-fatal: if AsyncStorage write fails the in-memory flag still lets
        // the user proceed. On the next cold start they'll see the wizard again
        // and the flag will be re-written then.
        await markOnboardingComplete(userId, householdId).catch(() => {});
      }
      // Flip the store flag so RootNavigator swaps OnboardingNavigator for
      // MainTabNavigator. navigation.reset is not usable here — 'Main' is not
      // registered in the current Stack until onboardingCompleted becomes true.
      setOnboardingCompleted(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingStepLayout
      title="Your budget is ready."
      subtitle="You've set up your income, payday, and spending envelopes. Start logging transactions to grow your Habit Score."
      step={onboardingStepNumber('Finish')}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      avoidKeyboard={false}
      ctaLabel="Go to Dashboard"
      onCta={handleDone}
      ctaLoading={loading}
      ctaDisabled={loading}
      onBack={() => navigation.goBack()}
    />
  );
}
