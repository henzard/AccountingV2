import React, { useCallback } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text, Surface, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { format, parseISO } from 'date-fns';
import { UnitRateCalculator } from '../../../domain/meterReadings/UnitRateCalculator';
import {
  getMeterTypeLabel,
  getMeterUnitLabel,
} from '../../../domain/meterReadings/MeterReadingEntity';
import { useMeterReadings } from '../../hooks/useMeterReadings';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing, radius } from '../../theme/tokens';
import type { MeterReadingEntity } from '../../../domain/meterReadings/MeterReadingEntity';
import type { RateHistoryScreenProps } from '../../navigation/types';

const calculator = new UnitRateCalculator();

export const RateHistoryScreen: React.FC<RateHistoryScreenProps> = ({ route }) => {
  const { meterType } = route.params;
  const householdId = useAppStore((s) => s.householdId)!;
  const { readings, loading, reload } = useMeterReadings(householdId, meterType, 24);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const unit = getMeterUnitLabel(meterType);

  const renderItem = useCallback(
    ({ item, index }: { item: MeterReadingEntity; index: number }) => {
      const previous = readings[index + 1] ?? null;
      const rateResult = previous ? calculator.calculate(item, previous) : null;

      return (
        <Surface style={styles.row} elevation={1}>
          <View style={styles.rowLeft}>
            <Text variant="bodyLarge" style={styles.reading}>
              {item.readingValue.toLocaleString()} {unit}
            </Text>
            <Text variant="bodySmall" style={styles.date}>
              {format(parseISO(item.readingDate), 'd MMM yyyy')}
            </Text>
          </View>
          <View style={styles.rowRight}>
            {rateResult?.success ? (
              <>
                <Text variant="bodyMedium" style={styles.consumption}>
                  {rateResult.data.consumptionUnits.toFixed(1)} {unit}
                </Text>
                {rateResult.data.unitRateCents > 0 ? (
                  <Text variant="bodySmall" style={styles.rate}>
                    R{(rateResult.data.unitRateCents / 100).toFixed(2)}/{unit}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text variant="bodySmall" style={styles.firstReading}>
                First reading
              </Text>
            )}
          </View>
        </Surface>
      );
    },
    [readings, unit],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator animating color={colours.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Surface style={styles.subHeader} elevation={0}>
        <Text variant="bodySmall" style={styles.subHeaderText}>
          {getMeterTypeLabel(meterType)} · rate per {unit} over time
        </Text>
      </Surface>
      {readings.length === 0 ? (
        <View style={styles.center}>
          <Text variant="titleMedium" style={styles.empty}>
            No readings yet
          </Text>
          <Text variant="bodyMedium" style={styles.emptySub}>
            Go back and log your first reading
          </Text>
        </View>
      ) : (
        <FlatList
          data={readings}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  subHeader: {
    padding: spacing.base,
    backgroundColor: colours.surfaceVariant,
  },
  subHeaderText: { color: colours.onSurfaceVariant },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
    backgroundColor: colours.surface,
  },
  rowLeft: { flex: 1 },
  rowRight: { alignItems: 'flex-end' },
  reading: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  date: { color: colours.onSurfaceVariant, marginTop: 2 },
  consumption: { color: colours.onSurface },
  rate: { color: colours.primary, marginTop: 2 },
  firstReading: { color: colours.onSurfaceVariant },
  empty: { color: colours.onSurface },
  emptySub: { color: colours.onSurfaceVariant, marginTop: spacing.xs },
  list: { paddingVertical: spacing.sm, paddingBottom: spacing.xl },
});
