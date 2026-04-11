import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, ActivityIndicator, Surface } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { meterReadings as meterReadingsTable } from '../../../data/local/schema';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { colours, spacing } from '../../theme/tokens';
import { MeterReadingCard } from './components/MeterReadingCard';
import type { MeterReadingEntity, MeterType } from '../../../domain/meterReadings/MeterReadingEntity';
import type { MeterDashboardScreenProps } from '../../navigation/types';

const METER_TYPES: MeterType[] = ['electricity', 'water', 'odometer'];
const engine = new BudgetPeriodEngine();

type LatestPairByType = Record<MeterType, [MeterReadingEntity | null, MeterReadingEntity | null]>;

export const MeterDashboardScreen: React.FC<MeterDashboardScreenProps> = ({ navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);
  const period = engine.getCurrentPeriod(paydayDay);

  const [readingPairs, setReadingPairs] = useState<LatestPairByType>({
    electricity: [null, null],
    water: [null, null],
    odometer: [null, null],
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result: LatestPairByType = {
        electricity: [null, null],
        water: [null, null],
        odometer: [null, null],
      };
      for (const meterType of METER_TYPES) {
        const rows = await db
          .select()
          .from(meterReadingsTable)
          .where(
            and(
              eq(meterReadingsTable.householdId, householdId),
              eq(meterReadingsTable.meterType, meterType),
            ),
          )
          .orderBy(desc(meterReadingsTable.readingDate))
          .limit(2);
        result[meterType] = [
          (rows[0] as MeterReadingEntity) ?? null,
          (rows[1] as MeterReadingEntity) ?? null,
        ];
      }
      setReadingPairs(result);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator animating color={colours.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Surface style={styles.header} elevation={0}>
        <Text variant="labelMedium" style={styles.headerLabel}>METER READINGS</Text>
        <Text variant="headlineSmall" style={styles.headerTitle}>{period.label}</Text>
      </Surface>
      <ScrollView contentContainerStyle={styles.list}>
        {METER_TYPES.map((meterType) => {
          const [latest, previous] = readingPairs[meterType];
          return (
            <MeterReadingCard
              key={meterType}
              meterType={meterType}
              latestReading={latest}
              previousReading={previous}
              onPress={() => navigation.navigate('AddReading', { meterType })}
              onRateHistoryPress={() => navigation.navigate('RateHistory', { meterType })}
            />
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
    backgroundColor: colours.surface,
  },
  headerLabel: { color: colours.onSurfaceVariant, letterSpacing: 1.5, marginBottom: spacing.xs },
  headerTitle: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  list: { paddingVertical: spacing.sm, paddingBottom: spacing.xl },
});
