import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Text, Button, Chip } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
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
  }) => Promise<{ success: boolean }>;
};

export function SlipConfirmScreen({
  envelopes,
  confirmSlip,
}: SlipConfirmScreenProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<{ goBack: () => void; navigate: (s: string) => void }>();
  const route = useRoute<{
    key: string;
    name: string;
    params: { slipId: string; extraction: SlipExtraction };
  }>();

  const { slipId, extraction } = route.params;
  const items = extraction.items;

  const listRef = useRef<FlatList<SlipExtractionItem>>(null);

  const [assignedEnvelopes, setAssignedEnvelopes] = useState<(EnvelopeOption | null)[]>(
    items.map((item) => {
      if (item.suggestedEnvelopeId) {
        return envelopes.find((e) => e.id === item.suggestedEnvelopeId) ?? null;
      }
      return null;
    }),
  );
  // NOTE: All items share a single transaction date (slip-level date).
  // Per-item date is a v2 spec change — deferred. See PR #8 review finding #24.
  const [transactionDate, setTransactionDate] = useState<Date>(
    extraction.slipDate ? new Date(extraction.slipDate) : new Date(),
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerTargetIdx, setPickerTargetIdx] = useState<number | null>(null);
  const [bulkEnvelope, setBulkEnvelope] = useState<EnvelopeOption | null>(null);
  const [showBulkPicker, setShowBulkPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const unassignedCount = useMemo(
    () => assignedEnvelopes.filter((e) => e === null).length,
    [assignedEnvelopes],
  );

  const canSave = unassignedCount === 0 && items.length > 0;

  const handleSelectEnvelope = useCallback((idx: number): void => {
    setPickerTargetIdx(idx);
  }, []);

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

  const handleSave = useCallback(async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    const dateStr = format(transactionDate, 'yyyy-MM-dd');
    const payload = items.map((item, idx) => ({
      description: item.description,
      amountCents: item.amountCents,
      envelopeId: assignedEnvelopes[idx]!.id,
      transactionDate: dateStr,
    }));
    const result = await confirmSlip({
      slipId,
      items: payload,
      merchant: extraction.merchant,
      totalCents: extraction.totalCents,
    });
    setSaving(false);
    if (result.success) {
      navigation.navigate('SlipQueue');
    }
  }, [
    canSave,
    transactionDate,
    items,
    assignedEnvelopes,
    confirmSlip,
    slipId,
    extraction,
    navigation,
  ]);

  const ListHeader = useMemo(
    () => (
      <View>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.outlineVariant }]}>
          <Text variant="titleLarge" style={{ color: colors.onSurface, marginBottom: 4 }}>
            {extraction.merchant ?? 'Unknown merchant'}
          </Text>
          {extraction.totalCents !== null && (
            <Text variant="bodyLarge" style={{ color: colors.onSurface, marginBottom: 4 }}>
              Total: R{(extraction.totalCents / 100).toFixed(2)}
            </Text>
          )}
          <TouchableOpacity onPress={() => setShowDatePicker(true)} testID="date-picker-trigger">
            <Text variant="bodyMedium" style={{ color: colors.primary }}>
              {format(transactionDate, 'd MMM yyyy')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Bulk assign */}
        <View style={[styles.bulkRow, { backgroundColor: colors.surfaceVariant }]}>
          <Text variant="bodySmall" style={{ flex: 1, color: colors.onSurfaceVariant }}>
            Assign all unassigned to:
          </Text>
          <Button mode="text" onPress={() => setShowBulkPicker(true)} testID="bulk-assign-button">
            {bulkEnvelope ? bulkEnvelope.name : 'Select\u2026'}
          </Button>
        </View>
      </View>
    ),
    [extraction, transactionDate, bulkEnvelope, colors],
  );

  const ListFooter = useMemo(
    () => (
      <Button
        mode="contained"
        onPress={handleSave}
        disabled={!canSave || saving}
        loading={saving}
        style={styles.saveButton}
        testID="save-button"
      >
        Save {items.length} transaction{items.length !== 1 ? 's' : ''}
      </Button>
    ),
    [handleSave, canSave, saving, items.length],
  );

  return (
    <View
      style={[styles.container, { backgroundColor: colors.surface }]}
      testID="slip-confirm-screen"
    >
      {/* Sticky unassigned chip — Android: elevation+position absolute */}
      {unassignedCount > 0 && (
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
        data={items}
        keyExtractor={(item, idx) =>
          item.suggestedEnvelopeId
            ? `${item.description}-${item.amountCents}-${idx}`
            : `${item.description}-${item.amountCents}-${idx}`
        }
        renderItem={({ item, index }) => (
          <LineItemRow
            item={item}
            index={index}
            selectedEnvelope={assignedEnvelopes[index] ?? null}
            transactionDate={format(transactionDate, 'yyyy-MM-dd')}
            onSelectEnvelope={handleSelectEnvelope}
          />
        )}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.scrollContent}
        onScrollToIndexFailed={() => {}}
        testID="line-items-list"
      />

      {/* Envelope pickers */}
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
