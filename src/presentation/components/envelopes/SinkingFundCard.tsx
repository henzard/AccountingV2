import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { format, parseISO } from 'date-fns';
import { formatCurrency } from '../../utils/currency';
import { SinkingFundProjector } from '../../../domain/envelopes/SinkingFundProjector';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

interface SinkingFundCardProps {
  envelope: EnvelopeEntity;
  onPress?: () => void;
  testID?: string;
}

const projector = new SinkingFundProjector();

export function SinkingFundCard({
  envelope,
  onPress,
  testID,
}: SinkingFundCardProps): React.JSX.Element {
  const { colors } = useAppTheme();

  const projection =
    envelope.targetAmountCents != null && envelope.targetDate != null
      ? projector.project({
          savedCents: envelope.allocatedCents,
          targetAmountCents: envelope.targetAmountCents,
          targetDate: envelope.targetDate,
          currentMonthlyCents: envelope.allocatedCents,
        })
      : null;

  const barColor = projection
    ? projection.isOnTrack
      ? colors.success
      : colors.warning
    : colors.primary;

  return (
    <TouchableOpacity onPress={onPress} disabled={!onPress} testID={testID} activeOpacity={0.8}>
      <Surface style={[styles.card, { backgroundColor: colors.surface }]} elevation={1}>
        <View style={styles.header}>
          <Text variant="titleSmall" style={{ color: colors.onSurface }}>
            {envelope.name}
          </Text>
          {envelope.targetDate != null && (
            <Text style={[styles.dueDate, { color: colors.onSurfaceVariant }]}>
              {format(parseISO(envelope.targetDate), 'MMM yyyy')}
            </Text>
          )}
        </View>

        {projection != null && (
          <>
            <View style={styles.amountRow}>
              <Text variant="headlineSmall" style={{ color: colors.onSurface }}>
                {formatCurrency(envelope.allocatedCents)}
              </Text>
              <Text style={[styles.target, { color: colors.onSurfaceVariant }]}>
                {' of '}
                {formatCurrency(envelope.targetAmountCents!)}
              </Text>
            </View>

            <View style={[styles.track, { backgroundColor: colors.surfaceVariant }]}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${projection.percentComplete}%` as `${number}%`,
                    backgroundColor: barColor,
                  },
                ]}
                testID="sinking-fund-progress-bar"
              />
            </View>

            <View style={styles.footer}>
              <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>
                {projection.monthsRemaining} month{projection.monthsRemaining !== 1 ? 's' : ''} left
              </Text>
              {projection.requiredMonthlyCents > 0 && (
                <Text
                  style={[
                    styles.meta,
                    { color: projection.isOnTrack ? colors.success : colors.warning },
                  ]}
                >
                  {formatCurrency(projection.requiredMonthlyCents)}/mo needed
                </Text>
              )}
            </View>
          </>
        )}
      </Surface>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  dueDate: { fontSize: fontSize.sm },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  target: { fontSize: fontSize.md },
  track: {
    height: 6,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  fill: { height: 6, borderRadius: radius.full },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { fontSize: fontSize.sm },
});
