import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Chip, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { spacing } from '../../../theme/tokens';
import type { OnboardingStackParamList } from './OnboardingNavigator';
import { OnboardingStepLayout } from './OnboardingStepLayout';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'ExpenseCategories'>;

const DEFAULT_CATEGORIES = [
  'Groceries',
  'Transport',
  'Rent',
  'Utilities',
  'Airtime',
  'Savings',
  'Clothing',
  'Entertainment',
  'Medical',
  'Education',
];

export function ExpenseCategoriesStep(): React.JSX.Element {
  const navigation = useNavigation<Nav>();

  const [selected, setSelected] = useState<Set<string>>(
    new Set(['Groceries', 'Transport', 'Rent', 'Utilities']),
  );
  const [error, setError] = useState<string | null>(null);

  const toggleCategory = (cat: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const handleNext = (): void => {
    setError(null);
    if (selected.size === 0) {
      setError('Select at least one spending category');
      return;
    }
    navigation.navigate('AllocateEnvelopes', { categories: Array.from(selected) });
  };

  return (
    <OnboardingStepLayout
      title="What do you spend money on?"
      subtitle="Select categories to create your spending envelopes. You can adjust amounts later."
      avoidKeyboard={false}
      onCta={handleNext}
    >
      <View style={styles.chipWrap}>
        {DEFAULT_CATEGORIES.map((cat) => (
          <Chip
            key={cat}
            selected={selected.has(cat)}
            onPress={() => toggleCategory(cat)}
            style={styles.chip}
            testID={`category-${cat}`}
          >
            {cat}
          </Chip>
        ))}
      </View>
      {error !== null && (
        <HelperText type="error" visible>
          {error}
        </HelperText>
      )}
    </OnboardingStepLayout>
  );
}

const styles = StyleSheet.create({
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { marginBottom: spacing.xs },
});
