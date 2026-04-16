import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { spacing } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import type { SlipExtractionItem } from '../../../../domain/slipScanning/types';
import type { EnvelopeOption } from './EnvelopePickerSheet';

export type LineItemRowProps = {
  item: SlipExtractionItem;
  index: number;
  selectedEnvelope: EnvelopeOption | null;
  transactionDate: string;
  onSelectEnvelope: (idx: number) => void;
};

function formatCents(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`;
}

export function LineItemRow({
  item,
  index,
  selectedEnvelope,
  onSelectEnvelope,
}: LineItemRowProps): React.JSX.Element {
  const { colors } = useAppTheme();

  function getConfidenceBorderColor(
    lineItem: SlipExtractionItem,
    selEnvelope: EnvelopeOption | null,
  ): string {
    if (!selEnvelope) return colors.error;
    if (lineItem.confidence < 0.7) return colors.warning;
    return colors.outlineVariant;
  }

  const borderColor = getConfidenceBorderColor(item, selectedEnvelope);
  const confidenceLabel = !selectedEnvelope
    ? 'no envelope assigned'
    : item.confidence < 0.7
      ? 'low confidence'
      : 'confident';

  return (
    <View
      style={[
        styles.container,
        {
          borderLeftColor: borderColor,
          borderLeftWidth: 3,
          borderBottomColor: colors.outlineVariant,
        },
      ]}
      testID={`line-item-${index}`}
      accessibilityLabel={`Line item ${index + 1}: ${item.description}, ${formatCents(item.amountCents)}, ${confidenceLabel}`}
    >
      <View style={styles.descRow}>
        <Text
          variant="bodyMedium"
          style={[styles.desc, { color: colors.onSurface }]}
          numberOfLines={2}
        >
          {item.description}
        </Text>
        <Text variant="bodyMedium" style={[styles.amount, { color: colors.onSurface }]}>
          {formatCents(item.amountCents)}
        </Text>
      </View>
      <TouchableRipple
        onPress={() => onSelectEnvelope(index)}
        style={styles.envelopeButton}
        testID={`line-item-envelope-picker-${index}`}
        accessibilityRole="button"
        accessibilityLabel={
          selectedEnvelope
            ? `Envelope: ${selectedEnvelope.name}. Double-tap to change.`
            : 'Assign envelope. Double-tap to select.'
        }
      >
        <Text
          variant="bodySmall"
          style={
            selectedEnvelope
              ? [styles.envelopeSelected, { color: colors.primary }]
              : [styles.envelopePlaceholder, { color: colors.onSurfaceVariant }]
          }
        >
          {selectedEnvelope ? selectedEnvelope.name : 'Assign envelope…'}
        </Text>
      </TouchableRipple>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  descRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  desc: { flex: 1, marginRight: spacing.sm },
  amount: { fontWeight: '600' },
  envelopeButton: { paddingVertical: 4 },
  envelopeSelected: {},
  envelopePlaceholder: {},
});
