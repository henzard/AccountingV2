import React, { useState } from 'react';
import { TextInput, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppStore } from '../../../stores/appStore';
import { useAppTheme } from '../../../theme/useAppTheme';
import type { OnboardingStackParamList } from './OnboardingNavigator';
import { OnboardingStepLayout } from './OnboardingStepLayout';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Income'>;

function toCents(str: string): number {
  const n = parseFloat(str.replace(',', '.'));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function IncomeStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();

  const [amountStr, setAmountStr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleNext = async (): Promise<void> => {
    setError(null);
    const cents = toCents(amountStr);
    if (cents <= 0) {
      setError('Please enter a valid monthly income amount');
      return;
    }
    useAppStore.getState().setMonthlyIncomeCents(cents);
    navigation.navigate('ExpenseCategories');
  };

  return (
    <OnboardingStepLayout
      title="What's your monthly income?"
      subtitle="This helps us plan your budget envelopes."
      step={2}
      totalSteps={8}
      onCta={handleNext}
    >
      <TextInput
        label="Monthly income (R)"
        value={amountStr}
        onChangeText={setAmountStr}
        mode="outlined"
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
