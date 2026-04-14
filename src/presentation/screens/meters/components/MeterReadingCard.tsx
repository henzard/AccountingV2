import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Surface, Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { spacing, radius } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import type {
  MeterReadingEntity,
  MeterType,
} from '../../../../domain/meterReadings/MeterReadingEntity';
import {
  getMeterTypeLabel,
  getMeterUnitLabel,
  getMeterIcon,
  getReadingDisplayDate,
} from '../../../../domain/meterReadings/MeterReadingEntity';
import { UnitRateCalculator } from '../../../../domain/meterReadings/UnitRateCalculator';

interface MeterReadingCardProps {
  meterType: MeterType;
  latestReading: MeterReadingEntity | null;
  previousReading: MeterReadingEntity | null;
  onPress: () => void;
  onRateHistoryPress: () => void;
}

const calculator = new UnitRateCalculator();

export function MeterReadingCard({
  meterType,
  latestReading,
  previousReading,
  onPress,
  onRateHistoryPress,
}: MeterReadingCardProps): React.JSX.Element {
  const { colors } = useAppTheme();
  let consumptionText = '—';
  let rateText = '—';

  if (latestReading && previousReading) {
    const result = calculator.calculate(latestReading, previousReading);
    if (result.success) {
      const unit = getMeterUnitLabel(meterType);
      consumptionText = `${result.data.consumptionUnits.toFixed(1)} ${unit}`;
      if (result.data.unitRateCents > 0) {
        rateText = `R${(result.data.unitRateCents / 100).toFixed(2)}/${unit}`;
      }
    }
  }

  return (
    <Surface style={[styles.card, { backgroundColor: colors.surface }]} elevation={1}>
      <TouchableRipple onPress={onPress} rippleColor={colors.primaryContainer} style={styles.main}>
        <View style={styles.row}>
          <View style={[styles.iconContainer, { backgroundColor: colors.primaryContainer }]}>
            <MaterialCommunityIcons
              name={getMeterIcon(meterType)}
              size={24}
              color={colors.primary}
            />
          </View>
          <View style={styles.content}>
            <Text variant="titleMedium" style={[styles.title, { color: colors.onSurface }]}>
              {getMeterTypeLabel(meterType)}
            </Text>
            {latestReading ? (
              <>
                <Text variant="bodyMedium" style={[styles.reading, { color: colors.onSurface }]}>
                  {latestReading.readingValue.toLocaleString()} {getMeterUnitLabel(meterType)}
                </Text>
                <Text variant="bodySmall" style={[styles.meta, { color: colors.onSurfaceVariant }]}>
                  {getReadingDisplayDate(latestReading)} · {consumptionText} · {rateText}
                </Text>
              </>
            ) : (
              <Text
                variant="bodyMedium"
                style={[styles.noReading, { color: colors.onSurfaceVariant }]}
              >
                No readings yet — tap to add
              </Text>
            )}
          </View>
          <MaterialCommunityIcons name="plus-circle-outline" size={22} color={colors.primary} />
        </View>
      </TouchableRipple>
      {latestReading && (
        <TouchableRipple
          onPress={onRateHistoryPress}
          rippleColor={colors.surfaceVariant}
          style={[styles.historyRow, { borderTopColor: colors.outlineVariant }]}
        >
          <Text variant="labelSmall" style={[styles.historyLink, { color: colors.primary }]}>
            View rate history →
          </Text>
        </TouchableRipple>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  main: { borderRadius: radius.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  content: { flex: 1 },
  title: { fontFamily: 'PlusJakartaSans_600SemiBold' },
  reading: { marginTop: 2 },
  meta: { marginTop: 2 },
  noReading: { marginTop: 2 },
  historyRow: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
  },
  historyLink: { letterSpacing: 0.5 },
});
