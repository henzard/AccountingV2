import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, List, Switch } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { randomUUID } from 'expo-crypto';
import { format } from 'date-fns';
import { db } from '../../../../data/local/db';
import { meterReadings } from '../../../../data/local/schema';
// PendingSyncEnqueuer/pending_sync is deleted machinery per the oplog-sync
// spec (docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md
// §2), but meter readings were NOT part of slice 3's UnitOfWork/oplog rewire
// (only envelopes + transactions were, per Task 3) — LogMeterReadingUseCase
// still enqueues onto pending_sync the same way it did before this slice,
// so this call site is unchanged intentionally. Routing this screen through
// LogMeterReadingUseCase instead of the raw insert below is NOT a drop-in
// swap: that use case rejects `readingValue <= 0`, but this screen seeds an
// intentional zero-value "Opening baseline" reading, so switching would
// break onboarding. Deleting PendingSyncEnqueuer/pending_sync entirely is
// slice 6's job, once every domain (not just envelopes/transactions) has an
// oplog-backed use case to replace it with.
import { PendingSyncEnqueuer } from '../../../../data/sync/PendingSyncEnqueuer';
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
      const enqueuer = new PendingSyncEnqueuer(db);
      const today = format(new Date(), 'yyyy-MM-dd');
      const now = new Date().toISOString();

      const enabledTypes: MeterType[] = [];
      if (electricity) enabledTypes.push('electricity');
      if (water) enabledTypes.push('water');
      if (odometer) enabledTypes.push('odometer');

      for (const meterType of enabledTypes) {
        const id = randomUUID();
        await db.insert(meterReadings).values({
          id,
          householdId,
          meterType,
          readingValue: 0,
          readingDate: today,
          costCents: null,
          vehicleId: null,
          notes: 'Opening baseline',
          createdAt: now,
          updatedAt: now,
        });
        await enqueuer.enqueue('meter_readings', id, 'INSERT');
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
