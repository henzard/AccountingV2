import React, { useState } from 'react';
import { View, StyleSheet, Switch } from 'react-native';
import { Text, TextInput, TouchableRipple, IconButton } from 'react-native-paper';
import { spacing } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import { formatCurrency } from '../../../utils/currency';
import { parseMoneyInput } from '../../../utils/parseMoneyInput';
import type { SlipExtractionItem } from '../../../../domain/slipScanning/types';
import type { EnvelopeOption } from './EnvelopePickerSheet';

export type LineItemRowProps = {
  item: SlipExtractionItem;
  index: number;
  selectedEnvelope: EnvelopeOption | null;
  transactionDate: string;
  onSelectEnvelope: (idx: number) => void;
  /**
   * UX-14: description/amount are editable and the line is removable
   * (unless `readOnly`). Omitting these callbacks (or passing `readOnly`)
   * renders the row as static text — used for an already-confirmed slip
   * (see SlipQueueScreen), which must never look editable.
   */
  onDescriptionChange?: (idx: number, description: string) => void;
  /**
   * REF-SLIP: `amountCents` is SIGNED — negative means a discount / voucher /
   * returned item, which `ConfirmSlipUseCase` writes as a negative
   * transaction that the envelope's derived `SUM(amount_cents)` nets out.
   * The amount FIELD always holds a positive number; the "Discount / refund"
   * switch below it is what decides the sign (the same split
   * AddTransactionScreen's Refund toggle uses, and the reason the shared
   * `parseMoneyInput` can go on rejecting a typed "-").
   */
  onAmountChange?: (idx: number, amountCents: number) => void;
  onRemove?: (idx: number) => void;
  readOnly?: boolean;
};

export function LineItemRow({
  item,
  index,
  selectedEnvelope,
  onSelectEnvelope,
  onDescriptionChange,
  onAmountChange,
  onRemove,
  readOnly = false,
}: LineItemRowProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const editable = !readOnly && !!(onDescriptionChange && onAmountChange);

  // Local draft for the amount field — kept as raw text so the user can type
  // "1 500,00" etc. mid-edit without it being reformatted on every keystroke;
  // only propagated to `onAmountChange` once it parses via the app's shared
  // `parseMoneyInput` (same parser as AddTransactionScreen).
  const [amountDraft, setAmountDraft] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);

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

  // REF-SLIP: derived from the (signed) item rather than held as its own
  // state, so the switch can never drift out of sync with the value that
  // actually gets confirmed — including for a line the extractor already
  // returned negative ("DISCOUNT -5,00"), which must render as a discount on
  // first paint with no user interaction.
  const isDiscount = item.amountCents < 0;

  function handleAmountChangeText(text: string): void {
    setAmountDraft(text);
    const parsed = parseMoneyInput(text);
    if (!parsed.ok) {
      setAmountError(parsed.error);
      return;
    }
    setAmountError(null);
    // The typed magnitude, re-signed by the toggle — editing a discount
    // keeps it a discount instead of silently flipping it to a charge.
    onAmountChange?.(index, isDiscount ? -parsed.cents : parsed.cents);
  }

  function handleDiscountToggle(next: boolean): void {
    // `item.amountCents` is authoritative: every valid keystroke has already
    // been pushed up through `onAmountChange`, so its magnitude is current.
    const magnitude = Math.abs(item.amountCents);
    onAmountChange?.(index, next ? -magnitude : magnitude);
  }

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
      accessibilityLabel={`Line item ${index + 1}: ${item.description}, ${formatCurrency(item.amountCents)}${isDiscount ? ', discount or refund — money back' : ''}, ${confidenceLabel}`}
    >
      <View style={styles.descRow}>
        {editable ? (
          <TextInput
            mode="outlined"
            dense
            value={item.description}
            onChangeText={(text) => onDescriptionChange?.(index, text)}
            style={styles.descInput}
            testID={`line-item-description-${index}`}
            accessibilityLabel={`Description for line item ${index + 1}`}
          />
        ) : (
          <Text
            variant="bodyMedium"
            style={[styles.desc, { color: colors.onSurface }]}
            numberOfLines={2}
          >
            {item.description}
          </Text>
        )}
        {editable ? (
          <TextInput
            mode="outlined"
            dense
            keyboardType="decimal-pad"
            value={amountDraft ?? formatCurrency(item.amountCents).replace(/^-?R/, '')}
            onChangeText={handleAmountChangeText}
            style={styles.amountInput}
            // REF-SLIP: the affix carries the sign so a discount reads
            // unmistakably as "-R …" even while being typed, without the
            // field itself ever holding a "-" (which `parseMoneyInput`
            // rejects by design).
            left={<TextInput.Affix text={isDiscount ? '-R' : 'R'} />}
            error={amountError !== null}
            testID={`line-item-amount-${index}`}
            accessibilityLabel={`Amount for line item ${index + 1}`}
          />
        ) : (
          <Text variant="bodyMedium" style={[styles.amount, { color: colors.onSurface }]}>
            {formatCurrency(item.amountCents)}
          </Text>
        )}
      </View>
      {editable && amountError !== null && (
        <Text variant="bodySmall" style={{ color: colors.error, marginBottom: 4 }}>
          {amountError}
        </Text>
      )}
      {/* REF-SLIP: the sign lives here, not in the Amount field — mirroring
          AddTransactionScreen's Refund toggle. A negative line is marked by
          a WORDED label (and the signed amount above), never by colour
          alone, so it survives a colour-blind or greyscale reading. */}
      {editable ? (
        <View style={styles.discountRow}>
          <Text
            variant="bodySmall"
            style={{ color: isDiscount ? colors.success : colors.onSurfaceVariant }}
            testID={`line-item-discount-label-${index}`}
          >
            Discount / refund (money back)
          </Text>
          <Switch
            value={isDiscount}
            onValueChange={handleDiscountToggle}
            testID={`line-item-discount-toggle-${index}`}
            accessibilityLabel={`Discount or refund for line item ${index + 1} — record this line as money coming back, not money spent`}
            trackColor={{ true: colors.success, false: colors.surfaceVariant }}
            thumbColor={colors.onPrimary}
          />
        </View>
      ) : (
        isDiscount && (
          <Text
            variant="bodySmall"
            style={{ color: colors.success, marginBottom: 4 }}
            testID={`line-item-discount-label-${index}`}
          >
            Discount / refund (money back)
          </Text>
        )
      )}
      <View style={styles.footerRow}>
        <TouchableRipple
          onPress={() => onSelectEnvelope(index)}
          style={styles.envelopeButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
        {editable && onRemove && (
          // UX2-19: the old "Remove" text button sat directly beside "Assign
          // envelope…" at ~24dp tall — a fat-finger tap on the destructive
          // action next to a frequently-used one. A trailing icon button
          // gives it its own visually distinct target, a 44dp minimum hit
          // area, and hitSlop so the effective touch target is even larger.
          <IconButton
            icon="close-circle-outline"
            size={20}
            onPress={() => onRemove(index)}
            style={styles.removeButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            iconColor={colors.error}
            testID={`line-item-remove-${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Remove line ${item.description}`}
          />
        )}
      </View>
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
  descInput: { flex: 1, marginRight: spacing.sm },
  amountInput: { width: 120 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // REF-SLIP: its own row rather than a third element in `footerRow`, which
  // already holds the envelope picker and the destructive remove button —
  // crowding a third control in there would shrink both existing targets.
  discountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  // UX2-19: 44dp is the minimum comfortable touch target — the old 24dp
  // paddingVertical:4 row made both the (frequent) envelope picker and the
  // (destructive) remove action easy to mis-tap.
  envelopeButton: { justifyContent: 'center', minHeight: 44, paddingVertical: 4, flex: 1 },
  envelopeSelected: {},
  envelopePlaceholder: {},
  removeButton: { margin: 0, minHeight: 44, minWidth: 44 },
});
