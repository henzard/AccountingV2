import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Chip, Button, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { spacing } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import type { OnboardingStackParamList } from './OnboardingNavigator';

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
  const { colors } = useAppTheme();
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
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <Text variant="headlineMedium" style={[styles.title, { color: colors.primary }]}>
        What do you spend money on?
      </Text>
      <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
        Select categories to create your spending envelopes. You can adjust amounts later.
      </Text>

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

      <Button
        mode="contained"
        onPress={handleNext}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        Next
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.xl },
  title: {
    fontFamily: 'PlusJakartaSans_700Bold',
    marginBottom: spacing.sm,
  },
  subtitle: { marginBottom: spacing.lg },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { marginBottom: spacing.xs },
  button: { marginTop: spacing.xl },
  buttonContent: { paddingVertical: spacing.xs },
});
