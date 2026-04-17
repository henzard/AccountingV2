import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { format } from 'date-fns';
import { db } from '../../../../data/local/db';
import { AuditLogger } from '../../../../data/audit/AuditLogger';
import { CreateEnvelopeUseCase } from '../../../../domain/envelopes/CreateEnvelopeUseCase';
import { BudgetPeriodEngine } from '../../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../../stores/appStore';
import { useToastStore } from '../../../stores/toastStore';
import { useAppTheme } from '../../../theme/useAppTheme';
import { spacing } from '../../../theme/tokens';
import type { OnboardingStackParamList } from './OnboardingNavigator';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'AllocateEnvelopes'>;
type Route = RouteProp<OnboardingStackParamList, 'AllocateEnvelopes'>;

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

function toCents(str: string): number {
  const n = parseFloat(String(str).replace(',', '.'));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function AllocateEnvelopesStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const categories = route.params.categories;

  const householdId = useAppStore((s) => s.householdId);
  const paydayDay = useAppStore((s) => s.paydayDay);
  const enqueue = useToastStore((s) => s.enqueue);
  const incomeCents = useAppStore((s) => s.monthlyIncomeCents) ?? 0;

  const initialAllocations = useMemo<Record<string, number>>(() => {
    if (categories.length === 0) return {};
    const base = Math.floor(incomeCents / categories.length);
    const remainder = incomeCents - base * categories.length;
    const out: Record<string, number> = {};
    categories.forEach((c, i) => {
      out[c] = i === 0 ? base + remainder : base;
    });
    return out;
  }, [categories, incomeCents]);

  const [allocStr, setAllocStr] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of categories) out[c] = fromCents(initialAllocations[c] ?? 0);
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const totalAllocatedCents = categories.reduce((s, c) => s + toCents(allocStr[c] ?? '0'), 0);
  const toAssignCents = incomeCents - totalAllocatedCents;

  const handleNext = async (): Promise<void> => {
    setError(null);
    if (toAssignCents !== 0) {
      setError(
        `Your allocations must total exactly R${fromCents(incomeCents)}. Currently off by R${fromCents(Math.abs(toAssignCents))}.`,
      );
      return;
    }
    if (!householdId) {
      setError('Household not ready — please retry in a moment.');
      return;
    }
    setLoading(true);
    try {
      const period = engine.getCurrentPeriod(paydayDay);
      const periodStart = format(period.startDate, 'yyyy-MM-dd');
      for (const category of categories) {
        const cents = toCents(allocStr[category] ?? '0');
        const uc = new CreateEnvelopeUseCase(db, audit, {
          householdId,
          name: category,
          allocatedCents: cents,
          envelopeType: category === 'Savings' ? 'savings' : 'spending',
          periodStart,
        });
        await uc.execute();
      }
      navigation.navigate('Payday');
    } catch {
      enqueue('Failed to save envelopes — please try again', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="headlineMedium" style={[styles.title, { color: colors.onSurface }]}>
          Split your income
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
          Every Rand gets a job. We&apos;ve split your R{fromCents(incomeCents)} equally — nudge
          each envelope until &quot;To assign&quot; is R0.
        </Text>

        <View
          style={[
            styles.toAssign,
            {
              backgroundColor:
                toAssignCents === 0
                  ? colors.successContainer
                  : toAssignCents < 0
                    ? colors.errorContainer
                    : colors.primaryContainer,
            },
          ]}
        >
          <Text variant="labelMedium" style={{ color: colors.onSurface }}>
            TO ASSIGN
          </Text>
          <Text variant="titleLarge" testID="to-assign" style={{ color: colors.onSurface }}>
            {'R' + fromCents(toAssignCents)}
          </Text>
        </View>

        {categories.map((c) => (
          <View key={c} style={styles.row}>
            <Text variant="titleMedium" style={[styles.rowLabel, { color: colors.onSurface }]}>
              {c}
            </Text>
            <TextInput
              mode="outlined"
              value={allocStr[c]}
              onChangeText={(v): void => setAllocStr((prev) => ({ ...prev, [c]: v }))}
              keyboardType="decimal-pad"
              left={<TextInput.Affix text="R" />}
              testID={`alloc-input-${c}`}
              style={styles.rowInput}
            />
          </View>
        ))}

        {error && <HelperText type="error">{error}</HelperText>}

        <Button
          mode="contained"
          onPress={handleNext}
          loading={loading}
          disabled={loading}
          style={styles.cta}
        >
          Next
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: spacing.xl, paddingBottom: spacing.xxl },
  title: { fontFamily: 'Fraunces_700Bold', marginBottom: spacing.xs },
  subtitle: { marginBottom: spacing.lg },
  toAssign: {
    padding: spacing.base,
    borderRadius: 12,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  row: { marginBottom: spacing.md },
  rowLabel: { marginBottom: spacing.xs },
  rowInput: {},
  cta: { marginTop: spacing.lg },
});
