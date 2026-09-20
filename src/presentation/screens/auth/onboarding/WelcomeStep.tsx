import React from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './OnboardingNavigator';
import { ONBOARDING_TOTAL_STEPS, onboardingStepNumber } from './onboardingSteps';
import { OnboardingStepLayout } from './OnboardingStepLayout';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Welcome'>;

/** The only step with no back control — there is nowhere behind it to go. */
export function WelcomeStep(): React.JSX.Element {
  const navigation = useNavigation<Nav>();

  return (
    <OnboardingStepLayout
      title="Welcome."
      subtitle="Let's set up your money. One question at a time. Takes about 3 minutes."
      step={onboardingStepNumber('Welcome')}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      avoidKeyboard={false}
      ctaLabel="Let's begin"
      onCta={() => navigation.navigate('Income')}
    />
  );
}
