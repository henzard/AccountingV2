import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { colours, spacing } from '../../../theme/tokens';
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

function getConfidenceBorderColor(
  item: SlipExtractionItem,
  selectedEnvelope: EnvelopeOption | null,
): string {
  if (!selectedEnvelope) return colours.error;
  if (item.confidence < 0.7) return colours.warning;
  return colours.outlineVariant;
}

export function LineItemRow({
  item,
  index,
  selectedEnvelope,
  onSelectEnvelope,
}: LineItemRowProps): React.JSX.Element {
  const borderColor = getConfidenceBorderColor(item, selectedEnvelope);
  return (
    <View
      style={[styles.container, { borderLeftColor: borderColor, borderLeftWidth: 3 }]}
      testID={`line-item-${index}`}
    >
      <View style={styles.descRow}>
        <Text variant="bodyMedium" style={styles.desc} numberOfLines={2}>
          {item.description}
        </Text>
        <Text variant="bodyMedium" style={styles.amount}>
          {formatCents(item.amountCents)}
        </Text>
      </View>
      <TouchableRipple
        onPress={() => onSelectEnvelope(index)}
        style={styles.envelopeButton}
        testID={`line-item-envelope-picker-${index}`}
      >
        <Text
          variant="bodySmall"
          style={selectedEnvelope ? styles.envelopeSelected : styles.envelopePlaceholder}
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
    borderBottomColor: colours.outlineVariant,
  },
  descRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  desc: { flex: 1, marginRight: spacing.sm, color: colours.onSurface },
  amount: { color: colours.onSurface, fontWeight: '600' },
  envelopeButton: { paddingVertical: 4 },
  envelopeSelected: { color: colours.primary },
  envelopePlaceholder: { color: colours.onSurfaceVariant },
});
