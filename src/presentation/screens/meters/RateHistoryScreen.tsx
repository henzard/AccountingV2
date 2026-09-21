import React, { useCallback } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface, ActivityIndicator, IconButton } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { format, parseISO } from 'date-fns';
import { db } from '../../../data/local/db';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { UnitRateCalculator } from '../../../domain/meterReadings/UnitRateCalculator';
import { DeleteMeterReadingUseCase } from '../../../domain/meterReadings/DeleteMeterReadingUseCase';
import {
  getMeterTypeLabel,
  getMeterUnitLabel,
} from '../../../domain/meterReadings/MeterReadingEntity';
import { useMeterReadings } from '../../hooks/useMeterReadings';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { confirm } from '../../components/shared/ConfirmDialogHost';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { formatCurrency } from '../../utils/currency';
import { EmptyState } from '../../components/shared/EmptyState';
import type { MeterReadingEntity } from '../../../domain/meterReadings/MeterReadingEntity';
import type { RateHistoryScreenProps } from '../../navigation/types';

const calculator = new UnitRateCalculator();
const audit = new AuditLogger(db);

// Render 24 rows, but fetch one extra (the boundary row) so the 24th row's
// consumption can be computed against its real previous reading instead of
// being mislabelled "First reading" purely because the fetch window cut it
// off. The extra row itself is never rendered.
const VISIBLE_LIMIT = 24;
const FETCH_LIMIT = VISIBLE_LIMIT + 1;

export const RateHistoryScreen: React.FC<RateHistoryScreenProps> = ({ route }) => {
  const { colors } = useAppTheme();
  const { meterType } = route.params;
  const householdId = useAppStore((s) => s.householdId)!;
  const { readings, loading, error, reload } = useMeterReadings(
    householdId,
    meterType,
    FETCH_LIMIT,
  );
  const visibleReadings = readings.slice(0, VISIBLE_LIMIT);
  const enqueue = useToastStore((s) => s.enqueue);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const unit = getMeterUnitLabel(meterType);

  const handleDelete = useCallback(
    async (reading: MeterReadingEntity): Promise<void> => {
      const confirmed = await confirm({
        title: 'Delete reading?',
        message: `${format(parseISO(reading.readingDate), 'd MMM yyyy')} — ${reading.readingValue.toLocaleString('en-ZA')} ${unit}`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!confirmed) return;

      try {
        const uc = new DeleteMeterReadingUseCase(db, audit, reading);
        const result = await uc.execute();
        if (!result.success) {
          enqueue('Failed to delete reading', 'error');
          return;
        }
        enqueue('Reading deleted', 'success');
        void reload();
      } catch {
        enqueue('Failed to delete reading', 'error');
      }
    },
    [unit, enqueue, reload],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: MeterReadingEntity; index: number }) => {
      const previous = readings[index + 1] ?? null;
      const rateResult = previous ? calculator.calculate(item, previous) : null;

      return (
        <Surface style={[styles.row, { backgroundColor: colors.surface }]} elevation={1}>
          <View style={styles.rowLeft}>
            <Text variant="bodyLarge" style={[styles.reading, { color: colors.onSurface }]}>
              {item.readingValue.toLocaleString('en-ZA')} {unit}
            </Text>
            <Text variant="bodySmall" style={[styles.date, { color: colors.onSurfaceVariant }]}>
              {format(parseISO(item.readingDate), 'd MMM yyyy')}
            </Text>
          </View>
          <View style={styles.rowRight}>
            {rateResult?.success ? (
              <>
                <Text
                  variant="bodyMedium"
                  style={[styles.consumption, { color: colors.onSurface }]}
                >
                  {rateResult.data.consumptionUnits.toFixed(1)} {unit}
                </Text>
                {rateResult.data.unitRateCents > 0 ? (
                  <Text variant="bodySmall" style={[styles.rate, { color: colors.primary }]}>
                    {`${formatCurrency(rateResult.data.unitRateCents)}/${unit}`}
                  </Text>
                ) : null}
              </>
            ) : previous ? (
              // A previous reading exists but the calculator rejected the
              // pair (consumption <= 0) — most commonly a replaced/new meter
              // whose reading legitimately dropped below the old meter's
              // last value. That is not "no history", so it must not be
              // labelled "First reading"; it also must not render a crash or
              // a negative figure.
              <Text
                variant="bodySmall"
                style={[styles.firstReading, { color: colors.onSurfaceVariant }]}
              >
                Meter replaced / no usage for this period
              </Text>
            ) : (
              <Text
                variant="bodySmall"
                style={[styles.firstReading, { color: colors.onSurfaceVariant }]}
              >
                First reading
              </Text>
            )}
          </View>
          <IconButton
            icon="delete-outline"
            iconColor={colors.error}
            size={20}
            onPress={() => void handleDelete(item)}
            testID={`delete-reading-${item.id}`}
            accessibilityLabel={`Delete ${format(parseISO(item.readingDate), 'd MMM yyyy')} reading of ${item.readingValue.toLocaleString('en-ZA')} ${unit}`}
          />
        </Surface>
      );
    },
    [readings, unit, colors, handleDelete],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator animating color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Surface style={[styles.subHeader, { backgroundColor: colors.surfaceVariant }]} elevation={0}>
        <Text
          variant="bodySmall"
          style={[styles.subHeaderText, { color: colors.onSurfaceVariant }]}
        >
          {getMeterTypeLabel(meterType)} · rate per {unit} over time
        </Text>
      </Surface>
      {error ? (
        <View style={styles.center}>
          <EmptyState
            title="Couldn't load rate history"
            body={error.message || 'Something went wrong'}
            testID="rate-history-error-state"
          />
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => void reload()}
            testID="rate-history-retry-button"
            accessibilityRole="button"
          >
            <Text style={{ color: colors.primary }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : readings.length === 0 ? (
        <View style={styles.center}>
          <Text variant="titleMedium" style={[styles.empty, { color: colors.onSurface }]}>
            No readings yet
          </Text>
          <Text variant="bodyMedium" style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
            Go back and log your first reading
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleReadings}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  subHeader: {
    padding: spacing.base,
  },
  subHeaderText: {},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
  },
  rowLeft: { flex: 1 },
  rowRight: { alignItems: 'flex-end' },
  reading: { fontFamily: 'PlusJakartaSans_600SemiBold' },
  date: { marginTop: 2 },
  consumption: {},
  rate: { marginTop: 2 },
  firstReading: {},
  empty: {},
  emptySub: { marginTop: spacing.xs },
  retryButton: { padding: spacing.sm },
  list: { paddingVertical: spacing.sm, paddingBottom: spacing.xl },
});
