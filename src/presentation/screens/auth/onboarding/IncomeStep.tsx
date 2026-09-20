import React, { useState } from 'react';
import { TextInput, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppStore } from '../../../stores/appStore';
import { useAppTheme } from '../../../theme/useAppTheme';
import type { OnboardingStackParamList } from './OnboardingNavigator';
import { ONBOARDING_TOTAL_STEPS, onboardingStepNumber } from './onboardingSteps';
import { OnboardingStepLayout } from './OnboardingStepLayout';
import { parseMoneyInput } from '../../../utils/parseMoneyInput';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Income'>;

export function IncomeStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();

  const [amountStr, setAmountStr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleNext = async (): Promise<void> => {
    setError(null);
    const parsed = parseMoneyInput(amountStr);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const cents = parsed.cents;
    if (cents <= 0) {
      setError('Please enter a valid monthly income amount');
      return;
    }
    useAppStore.getState().setMonthlyIncomeCents(cents);
    navigation.navigate('Payday');
  };

  return (
    <OnboardingStepLayout
      title="What's your monthly income?"
      subtitle="This helps us plan your budget envelopes."
      step={onboardingStepNumber('Income')}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      onCta={handleNext}
      onBack={() => navigation.goBack()}
    >
      <TextInput
        label="Monthly income (R)"
        value={amountStr}
        onChangeText={setAmountStr}
        mode="outlined"
        testID="income-amount-input"
        style={{ backgroundColor: colors.surface }}
        keyboardType="decimal-pad"
        placeholder="0.00"
        left={<TextInput.Affix text="R" />}
      />
      {error !== null && (
        <HelperText type="error" visible>
          {error}
        </HelperText>
      )}
    </OnboardingStepLayout>
  );
}
