import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, List, Switch } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { randomUUID } from 'expo-crypto';
import { format } from 'date-fns';
import { db } from '../../../../data/local/db';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../../../../domain/shared/syncWrite';
// Routing this screen through LogMeterReadingUseCase is NOT a drop-in swap:
// that use case rejects `readingValue <= 0`, but this screen seeds an
// intentional zero-value "Opening baseline" reading, so switching would
// break onboarding. It writes through the same slice-3/5 oplog-backed
// synced repo LogMeterReadingUseCase itself uses, just inlined here for the
// zero-value case (see task-1-report.md, "meter readings" section).
import { useAppStore } from '../../../stores/appStore';
import { radius, spacing } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import type { OnboardingStackParamList } from './OnboardingNavigator';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'MeterSetup'>;

type MeterType = 'electricity' | 'water' | 'odometer';

export function MeterSetupStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();
  const householdId = useAppStore((s) => s.householdId)!;

  const [electricity, setElectricity] = useState(false);
  const [water, setWater] = useState(false);
  const [odometer, setOdometer] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleNext = async (): Promise<void> => {
    setLoading(true);
    try {
      const repo = resolveSyncedRepo(db, 'meter_readings', {});
      const ctx = resolveSyncedRepoCtx({});
      const today = format(new Date(), 'yyyy-MM-dd');
      const now = new Date().toISOString();

      const enabledTypes: MeterType[] = [];
      if (electricity) enabledTypes.push('electricity');
      if (water) enabledTypes.push('water');
      if (odometer) enabledTypes.push('odometer');

      for (const meterType of enabledTypes) {
        const id = randomUUID();
        repo.insert(
          {
            id,
            household_id: householdId,
            meter_type: meterType,
            reading_value: 0,
            reading_date: today,
            cost_cents: null,
            vehicle_id: null,
            notes: 'Opening baseline',
            created_at: now,
            updated_at: now,
          },
          ctx,
        );
      }
    } finally {
      setLoading(false);
    }

    navigation.navigate('ScoreIntro');
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <Text variant="headlineMedium" style={[styles.title, { color: colors.primary }]}>
        Track your meters?
      </Text>
      <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
        Enable meter tracking to log electricity, water, or vehicle usage. You can change this
        later.
      </Text>

      <View style={[styles.switchList, { backgroundColor: colors.surface }]}>
        <List.Item
          title="Electricity"
          description="Track kWh usage"
          left={(props) => <List.Icon {...props} icon="lightning-bolt" />}
          right={() => (
            <Switch
              value={electricity}
              onValueChange={setElectricity}
              testID="switch-electricity"
            />
          )}
        />
        <List.Item
          title="Water"
          description="Track kL usage"
          left={(props) => <List.Icon {...props} icon="water" />}
          right={() => <Switch value={water} onValueChange={setWater} testID="switch-water" />}
        />
        <List.Item
          title="Odometer"
          description="Track vehicle km"
          left={(props) => <List.Icon {...props} icon="car" />}
          right={() => (
            <Switch value={odometer} onValueChange={setOdometer} testID="switch-odometer" />
          )}
        />
      </View>

      <Button
        mode="contained"
        onPress={handleNext}
        loading={loading}
        disabled={loading}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        {electricity || water || odometer ? 'Next' : 'Skip'}
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
  switchList: {
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
});
