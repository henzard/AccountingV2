import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Text, Button, Chip, Snackbar } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { randomUUID } from 'expo-crypto';
import { format, isValid, parseISO } from 'date-fns';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { formatCurrency } from '../../utils/currency';
import { useToastStore } from '../../stores/toastStore';
import { LineItemRow } from './components/LineItemRow';
import { EnvelopePickerSheet } from './components/EnvelopePickerSheet';
import type { SlipExtraction, SlipExtractionItem } from '../../../domain/slipScanning/types';
import type { EnvelopeOption } from './components/EnvelopePickerSheet';

export type SlipConfirmScreenProps = {
  envelopes: EnvelopeOption[];
  confirmSlip: (input: {
    slipId: string;
    items: Array<{
      description: string;
      amountCents: number;
      envelopeId: string;
      transactionDate: string;
    }>;
    merchant: string | null;
    totalCents: number | null;
  }) => Promise<{
    success: boolean;
    totalMismatch?: boolean;
    /**
     * REG-12: the underlying `ConfirmSlipUseCase` now runs every item through
     * the shared `transactionValidation` rules and can fail for a specific,
     * actionable reason (an archived/deleted target envelope, an
     * out-of-range date, an invalid amount) — surfaced here so the screen
     * can show `error.message` instead of a generic "try again" string.
     */
    error?: { code: string; message: string };
  }>;
};

// `slipDate` is OCR/LLM-derived (edge function `extract-slip`), so it can be
// absent or unparseable ("N/A", "13/04/2026", "2026-04-31"). `new Date(...)` on
// those yields an Invalid Date, and every `format(...)` below then throws
// `RangeError: Invalid time value`, white-screening the confirm step. Fall back
// to today so the user can correct it with the date picker.
function parseSlipDate(slipDate: string | null | undefined): Date {
  if (!slipDate) return new Date();
  const parsed = parseISO(slipDate);
  return isValid(parsed) ? parsed : new Date();
}

/**
 * UX2-1: `lineId` is assigned ONCE when the extraction is loaded into state
 * and never recomputed — editing `description`/`amountCents` must not change
 * it. The list's `keyExtractor` keys on this instead of
 * `${description}-${amountCents}-${idx}`, which changed on every keystroke
 * (description/amount are exactly what's being typed) and remounted the row,
 * dropping the keyboard and resetting a half-typed amount.
 */
type EditableLineItem = SlipExtractionItem & { lineId: string };

export function SlipConfirmScreen({
  envelopes,
  confirmSlip,
}: SlipConfirmScreenProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const enqueueToast = useToastStore((s) => s.enqueue);
  const navigation = useNavigation<{ goBack: () => void; navigate: (s: string) => void }>();
  const route = useRoute<{
    key: string;
    name: string;
    params: { slipId: string; extraction: SlipExtraction; readOnly?: boolean };
  }>();

  const { slipId, extraction, readOnly = false } = route.params;
  // Defensive guard (H5): every caller is now expected to pass a fully-shaped
  // `extraction`, but if it is ever missing/malformed (e.g. a stale deep link
  // or a future call site regressing), render a recoverable empty state
  // instead of throwing a TypeError on `extraction.items` and white-screening.
  const initialItems: EditableLineItem[] = useMemo(
    () =>
      (Array.isArray(extraction?.items) ? extraction.items : []).map((item) => ({
        ...item,
        lineId: randomUUID(),
      })),
    [extraction],
  );

  const listRef = useRef<FlatList<EditableLineItem>>(null);

  // UX-14: description/amount are editable and a line can be removed, so the
  // confirmable list is local editable state — not the raw extraction items.
  // Read-only (an already-confirmed slip reopened from the queue) never
  // mutates this; it is only ever seeded from `initialItems`.
  const [lineItems, setLineItems] = useState<EditableLineItem[]>(initialItems);
  const [assignedEnvelopes, setAssignedEnvelopes] = useState<(EnvelopeOption | null)[]>(
    initialItems.map((item) => {
      if (item.suggestedEnvelopeId) {
        return envelopes.find((e) => e.id === item.suggestedEnvelopeId) ?? null;
      }
      return null;
    }),
  );
  // NOTE: All items share a single transaction date (slip-level date).
  // Per-item date is a v2 spec change — deferred. See PR #8 review finding #24.
  const [transactionDate, setTransactionDate] = useState<Date>(() =>
    parseSlipDate(extraction?.slipDate),
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerTargetIdx, setPickerTargetIdx] = useState<number | null>(null);
  const [bulkEnvelope, setBulkEnvelope] = useState<EnvelopeOption | null>(null);
  const [showBulkPicker, setShowBulkPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unassignedCount = useMemo(
    () => assignedEnvelopes.filter((e) => e === null).length,
    [assignedEnvelopes],
  );

  const canSave = !readOnly && unassignedCount === 0 && lineItems.length > 0;

  const handleSelectEnvelope = useCallback(
    (idx: number): void => {
      if (readOnly) return;
      setPickerTargetIdx(idx);
    },
    [readOnly],
  );

  const handleEnvelopePicked = useCallback(
    (env: EnvelopeOption): void => {
      if (pickerTargetIdx !== null) {
        setAssignedEnvelopes((prev) => {
          const next = [...prev];
          next[pickerTargetIdx] = env;
          return next;
        });
        setPickerTargetIdx(null);
      }
    },
    [pickerTargetIdx],
  );

  const handleBulkAssign = useCallback((env: EnvelopeOption): void => {
    setBulkEnvelope(env);
    setAssignedEnvelopes((prev) => prev.map((e) => (e === null ? env : e)));
  }, []);

  const handleUnassignedChipPress = useCallback((): void => {
    const firstUnassignedIdx = assignedEnvelopes.findIndex((e) => e === null);
    if (firstUnassignedIdx >= 0) {
      listRef.current?.scrollToIndex({ index: firstUnassignedIdx, animated: true });
    }
  }, [assignedEnvelopes]);

  const handleDescriptionChange = useCallback((idx: number, description: string): void => {
    setLineItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], description };
      return next;
    });
  }, []);

  const handleAmountChange = useCallback((idx: number, amountCents: number): void => {
    setLineItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], amountCents };
      return next;
    });
  }, []);

  const handleRemoveItem = useCallback((idx: number): void => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
    setAssignedEnvelopes((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const dateStr = format(transactionDate, 'yyyy-MM-dd');
      const payload = lineItems.map((item, idx) => ({
        description: item.description,
        amountCents: item.amountCents,
        envelopeId: assignedEnvelopes[idx]!.id,
        transactionDate: dateStr,
      }));
      const result = await confirmSlip({
        slipId,
        items: payload,
        merchant: extraction?.merchant ?? null,
        totalCents: extraction?.totalCents ?? null,
      });
      if (result.success) {
        // DOM-12: a mismatched total never blocks the save — warn instead,
        // via the global toast so it still shows after navigating away.
        if (result.totalMismatch) {
          enqueueToast("Saved, but the total doesn't match the receipt", 'info');
        }
        navigation.navigate('SlipQueue');
      } else {
        // REG-12: show the use case's actual reason (e.g. "Envelope has been
        // archived") when the caller supplies one, instead of a generic
        // message that hides why the save actually failed.
        setError(result.error?.message ?? 'Could not save these transactions. Please try again.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    transactionDate,
    lineItems,
    assignedEnvelopes,
    confirmSlip,
    slipId,
    extraction,
    navigation,
    enqueueToast,
  ]);

  const ListHeader = useMemo(
    () => (
      <View>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.outlineVariant }]}>
          <Text variant="titleLarge" style={{ color: colors.onSurface, marginBottom: 4 }}>
            {extraction?.merchant ?? 'Unknown merchant'}
          </Text>
          {readOnly && (
            <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant, marginBottom: 4 }}>
              Already confirmed
            </Text>
          )}
          {extraction?.totalCents != null && (
            <Text variant="bodyLarge" style={{ color: colors.onSurface, marginBottom: 4 }}>
              Total: {formatCurrency(extraction.totalCents)}
            </Text>
          )}
          {readOnly ? (
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
              {format(transactionDate, 'd MMM yyyy')}
            </Text>
          ) : (
            <TouchableOpacity onPress={() => setShowDatePicker(true)} testID="date-picker-trigger">
              <Text variant="bodyMedium" style={{ color: colors.primary }}>
                {format(transactionDate, 'd MMM yyyy')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Bulk assign */}
        {!readOnly && (
          <View style={[styles.bulkRow, { backgroundColor: colors.surfaceVariant }]}>
            <Text variant="bodySmall" style={{ flex: 1, color: colors.onSurfaceVariant }}>
              Assign all unassigned to:
            </Text>
            <Button mode="text" onPress={() => setShowBulkPicker(true)} testID="bulk-assign-button">
              {bulkEnvelope ? bulkEnvelope.name : 'Select…'}
            </Button>
          </View>
        )}
      </View>
    ),
    [extraction, transactionDate, bulkEnvelope, colors, readOnly],
  );

  const ListFooter = useMemo(
    () =>
      readOnly ? null : (
        <Button
          mode="contained"
          onPress={handleSave}
          disabled={!canSave || saving}
          loading={saving}
          style={styles.saveButton}
          testID="save-button"
        >
          Save {lineItems.length} transaction{lineItems.length !== 1 ? 's' : ''}
        </Button>
      ),
    [handleSave, canSave, saving, lineItems.length, readOnly],
  );

  return (
    <View
      style={[styles.container, { backgroundColor: colors.surface }]}
      testID="slip-confirm-screen"
    >
      {/* Sticky unassigned chip — Android: elevation+position absolute */}
      {!readOnly && unassignedCount > 0 && (
        <Chip
          style={[styles.unassignedChip, { backgroundColor: colors.errorContainer }]}
          testID="unassigned-chip"
          onPress={handleUnassignedChipPress}
          elevation={4}
        >
          {unassignedCount} item{unassignedCount > 1 ? 's' : ''} unassigned
        </Chip>
      )}

      <FlatList
        ref={listRef}
        data={lineItems}
        keyExtractor={(item) => item.lineId}
        renderItem={({ item, index }) => (
          <LineItemRow
            item={item}
            index={index}
            selectedEnvelope={assignedEnvelopes[index] ?? null}
            transactionDate={format(transactionDate, 'yyyy-MM-dd')}
            onSelectEnvelope={handleSelectEnvelope}
            onDescriptionChange={readOnly ? undefined : handleDescriptionChange}
            onAmountChange={readOnly ? undefined : handleAmountChange}
            onRemove={readOnly ? undefined : handleRemoveItem}
            readOnly={readOnly}
          />
        )}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.scrollContent}
        onScrollToIndexFailed={() => {}}
        testID="line-items-list"
      />

      {/* Envelope pickers */}
      {!readOnly && (
        <>
          <EnvelopePickerSheet
            visible={pickerTargetIdx !== null}
            envelopes={envelopes}
            selectedId={pickerTargetIdx !== null ? assignedEnvelopes[pickerTargetIdx]?.id : null}
            onSelect={handleEnvelopePicked}
            onClose={() => setPickerTargetIdx(null)}
          />
          <EnvelopePickerSheet
            visible={showBulkPicker}
            envelopes={envelopes}
            selectedId={bulkEnvelope?.id}
            onSelect={handleBulkAssign}
            onClose={() => setShowBulkPicker(false)}
          />
        </>
      )}

      {showDatePicker && (
        <DateTimePicker
          value={transactionDate}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={(_, date) => {
            setShowDatePicker(false);
            if (date) setTransactionDate(date);
          }}
        />
      )}

      <Snackbar
        visible={error !== null}
        onDismiss={() => setError(null)}
        duration={4000}
        action={{ label: 'OK', onPress: () => setError(null) }}
        accessibilityLiveRegion="polite"
        testID="slip-confirm-error-snackbar"
      >
        {error}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  unassignedChip: {
    margin: spacing.sm,
    alignSelf: 'flex-start',
    // Android z-index fix
    elevation: 4,
    position: 'relative',
  },
  scrollContent: { paddingBottom: spacing.xl },
  header: {
    padding: spacing.base,
    borderBottomWidth: 1,
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
  },
  saveButton: { margin: spacing.base },
});
