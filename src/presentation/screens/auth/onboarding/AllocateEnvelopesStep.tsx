import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput, HelperText } from 'react-native-paper';
import { and, eq, isNull } from 'drizzle-orm';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { db } from '../../../../data/local/db';
import { envelopes } from '../../../../data/local/schema';
import { AuditLogger } from '../../../../data/audit/AuditLogger';
import { CreateEnvelopeUseCase } from '../../../../domain/envelopes/CreateEnvelopeUseCase';
import type { EnvelopeType } from '../../../../domain/envelopes/EnvelopeEntity';
import {
  BudgetPeriodEngine,
  formatPeriodDateKey,
} from '../../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../../stores/appStore';
import { useToastStore } from '../../../stores/toastStore';
import { useAppTheme } from '../../../theme/useAppTheme';
import { spacing } from '../../../theme/tokens';
import { formatCurrency } from '../../../utils/currency';
import type { OnboardingStackParamList } from './OnboardingNavigator';
import { ONBOARDING_TOTAL_STEPS, onboardingStepNumber } from './onboardingSteps';
import { OnboardingStepLayout } from './OnboardingStepLayout';
import { parseMoneyInput } from '../../../utils/parseMoneyInput';
import type { ParseMoneyResult } from '../../../utils/parseMoneyInput';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'AllocateEnvelopes'>;
type Route = RouteProp<OnboardingStackParamList, 'AllocateEnvelopes'>;

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

const INCOME_ENVELOPE_NAME = 'Monthly Income';

/** Plain 'x.yy' rand string for pre-filling an input — user-facing text uses `formatCurrency`. */
function toInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

interface PlannedEnvelope {
  name: string;
  allocatedCents: number;
  envelopeType: EnvelopeType;
}

/** The identity that makes two envelopes "the same envelope" for the skip-if-exists check. */
function envelopeIdentity(name: string, envelopeType: string): string {
  return JSON.stringify([name, envelopeType]);
}

/**
 * Names already taken by a non-deleted envelope of the same type in
 * `periodStart`. This is what makes pressing Next twice — or going Back and
 * Next again — create each envelope ONCE: `CreateEnvelopeUseCase` generates a
 * random id per call and has no natural key, so without this check a second
 * pass silently produced a duplicate "Groceries" and a duplicate
 * "Monthly Income", doubling the household's recorded income.
 */
async function findExistingNames(householdId: string, periodStart: string): Promise<Set<string>> {
  const rows = await db
    .select({ name: envelopes.name, envelopeType: envelopes.envelopeType })
    .from(envelopes)
    .where(
      and(
        eq(envelopes.householdId, householdId),
        eq(envelopes.periodStart, periodStart),
        isNull(envelopes.deletedAt),
      ),
    );
  return new Set(rows.map((row) => envelopeIdentity(row.name, row.envelopeType)));
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
    for (const c of categories) out[c] = toInputValue(initialAllocations[c] ?? 0);
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const allocResults = useMemo<Record<string, ParseMoneyResult>>(() => {
    const out: Record<string, ParseMoneyResult> = {};
    for (const c of categories) out[c] = parseMoneyInput(allocStr[c] ?? '0');
    return out;
  }, [categories, allocStr]);

  const totalAllocatedCents = categories.reduce((s, c) => {
    const result = allocResults[c];
    return s + (result.ok ? result.cents : 0);
  }, 0);
  const toAssignCents = incomeCents - totalAllocatedCents;

  const handleNext = async (): Promise<void> => {
    setError(null);
    const invalidCategory = categories.find((c) => !allocResults[c].ok);
    if (invalidCategory !== undefined) {
      const result = allocResults[invalidCategory];
      setError(`${invalidCategory}: ${result.ok ? '' : result.error}`);
      return;
    }
    // Over-allocation is still a hard stop — committing more than you earn is
    // a real error. Money LEFT OVER is not: it is a perfectly normal state of
    // a budget, and blocking Next on it trapped users who simply had not
    // decided where the last R200 should go. They can finish assigning it on
    // the Budget screen any time.
    if (toAssignCents < 0) {
      setError(
        `That's ${formatCurrency(Math.abs(toAssignCents))} more than your income of ${formatCurrency(incomeCents)}. Reduce an envelope to continue.`,
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
      const periodStart = formatPeriodDateKey(period.startDate);

      const planned: PlannedEnvelope[] = [];
      // Persist the entered income as a period-scoped 'income' envelope so it
      // becomes a real, editable value (shown on the Budget screen and carried
      // forward each period) rather than a one-off number discarded after the
      // split. Without this the budget has no income envelope at all, so the
      // zero-based balance reads as fully overcommitted and there is nowhere to
      // update income month to month.
      if (incomeCents > 0) {
        planned.push({
          name: INCOME_ENVELOPE_NAME,
          allocatedCents: incomeCents,
          envelopeType: 'income',
        });
      }
      for (const category of categories) {
        const result = allocResults[category];
        planned.push({
          name: category,
          allocatedCents: result.ok ? result.cents : 0,
          envelopeType: category === 'Savings' ? 'savings' : 'spending',
        });
      }

      const existingNames = await findExistingNames(householdId, periodStart);

      // `CreateEnvelopeUseCase` REJECTS an allocation of zero or less
      // (INVALID_AMOUNT). Those categories used to be pushed at it anyway and
      // their failed Result dropped on the floor, so a category the user left
      // at R0 simply never appeared and nothing said why. Skip them up front
      // and name them in a notice instead.
      const skippedZero: string[] = [];
      const failed: string[] = [];

      for (const envelope of planned) {
        if (envelope.allocatedCents <= 0) {
          skippedZero.push(envelope.name);
          continue;
        }
        if (existingNames.has(envelopeIdentity(envelope.name, envelope.envelopeType))) {
          continue;
        }
        const result = await new CreateEnvelopeUseCase(db, audit, {
          householdId,
          name: envelope.name,
          allocatedCents: envelope.allocatedCents,
          envelopeType: envelope.envelopeType,
          periodStart,
        }).execute();
        if (!result.success) {
          failed.push(envelope.name);
        }
      }

      if (failed.length > 0) {
        // Surfaced, not swallowed: the user is told exactly which envelopes
        // did not save, and is NOT advanced past the screen that can retry
        // them. Anything already created is skipped on the retry.
        setError(
          `Couldn't save ${failed.join(', ')}. Everything else was saved — press Next to try again.`,
        );
        return;
      }
      if (skippedZero.length > 0) {
        enqueue(
          `${skippedZero.join(', ')} had no money assigned, so ${skippedZero.length === 1 ? 'it was' : 'they were'} skipped. You can add ${skippedZero.length === 1 ? 'it' : 'them'} from the Budget screen.`,
          'info',
        );
      }
      navigation.navigate('ScoreIntro');
    } catch {
      enqueue('Failed to save envelopes — please try again', 'error');
    } finally {
      setLoading(false);
    }
  };

  const toAssignBackground =
    toAssignCents === 0
      ? colors.successContainer
      : toAssignCents < 0
        ? colors.errorContainer
        : colors.primaryContainer;

  return (
    <OnboardingStepLayout
      title="Split your income"
      subtitle={`Every Rand gets a job. We've split your ${formatCurrency(incomeCents)} equally — nudge each envelope until it looks right.`}
      step={onboardingStepNumber('AllocateEnvelopes')}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      onCta={handleNext}
      ctaLoading={loading}
      ctaDisabled={loading}
      onBack={() => navigation.goBack()}
    >
      <View style={[styles.toAssign, { backgroundColor: toAssignBackground }]}>
        <Text variant="labelMedium" style={{ color: colors.onSurface }}>
          TO ASSIGN
        </Text>
        <Text variant="titleLarge" testID="to-assign" style={{ color: colors.onSurface }}>
          {formatCurrency(toAssignCents)}
        </Text>
        {toAssignCents > 0 && (
          <Text
            variant="bodySmall"
            testID="to-assign-hint"
            style={[styles.toAssignHint, { color: colors.onSurface }]}
          >
            {formatCurrency(toAssignCents)} left to assign — you can finish this later.
          </Text>
        )}
      </View>

      {categories.map((c) => {
        const result = allocResults[c];
        return (
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
            />
            {!result.ok && (
              <HelperText type="error" visible testID={`alloc-error-${c}`}>
                {result.error}
              </HelperText>
            )}
          </View>
        );
      })}

      {error !== null && (
        <HelperText type="error" visible>
          {error}
        </HelperText>
      )}
    </OnboardingStepLayout>
  );
}

const styles = StyleSheet.create({
  toAssign: {
    padding: spacing.base,
    borderRadius: 12,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  toAssignHint: { marginTop: spacing.xs, textAlign: 'center' },
  row: { marginBottom: spacing.md },
  rowLabel: { marginBottom: spacing.xs },
});
