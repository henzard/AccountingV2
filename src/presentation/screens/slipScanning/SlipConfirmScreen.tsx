import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Button, Chip } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { colours, spacing } from '../../theme/tokens';
import { LineItemRow } from './components/LineItemRow';
import { EnvelopePickerSheet } from './components/EnvelopePickerSheet';
import type { SlipExtraction } from '../../../domain/slipScanning/types';
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
  const navigation = useNavigation<{ goBack: () => void; navigate: (s: string) => void }>();
  const route = useRoute<{
    key: string;
    name: string;
    params: { slipId: string; extraction: SlipExtraction };
  }>();

  const { slipId, extraction } = route.params;
  const items = extraction.items;

  const [assignedEnvelopes, setAssignedEnvelopes] = useState<(EnvelopeOption | null)[]>(
    items.map((item) => {
      if (item.suggestedEnvelopeId) {
        return envelopes.find((e) => e.id === item.suggestedEnvelopeId) ?? null;
      }
      return null;
    }),
  );
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

  return (
    <View style={styles.container} testID="slip-confirm-screen">
      {/* Sticky unassigned chip */}
      {unassignedCount > 0 && (
        <Chip style={styles.unassignedChip} testID="unassigned-chip">
          {unassignedCount} item{unassignedCount > 1 ? 's' : ''} unassigned
        </Chip>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.merchant}>
            {extraction.merchant ?? 'Unknown merchant'}
          </Text>
          {extraction.totalCents !== null && (
            <Text variant="bodyLarge" style={styles.total}>
              Total: R{(extraction.totalCents / 100).toFixed(2)}
            </Text>
          )}
          <TouchableOpacity onPress={() => setShowDatePicker(true)} testID="date-picker-trigger">
            <Text variant="bodyMedium" style={styles.date}>
              {format(transactionDate, 'd MMM yyyy')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Bulk assign */}
        <View style={styles.bulkRow}>
          <Text variant="bodySmall" style={styles.bulkLabel}>
            Assign all unassigned to:
          </Text>
          <Button mode="text" onPress={() => setShowBulkPicker(true)} testID="bulk-assign-button">
            {bulkEnvelope ? bulkEnvelope.name : 'Select…'}
          </Button>
        </View>

        {/* Line items */}
        {items.map((item, idx) => (
          <LineItemRow
            key={idx}
            item={item}
            index={idx}
            selectedEnvelope={assignedEnvelopes[idx] ?? null}
            transactionDate={format(transactionDate, 'yyyy-MM-dd')}
            onSelectEnvelope={handleSelectEnvelope}
          />
        ))}

        {/* Save */}
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
      </ScrollView>

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
  container: { flex: 1, backgroundColor: colours.surface },
  unassignedChip: {
    margin: spacing.sm,
    backgroundColor: colours.errorContainer,
    alignSelf: 'flex-start',
  },
  scrollContent: { paddingBottom: spacing.xl },
  header: {
    padding: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colours.outlineVariant,
  },
  merchant: { color: colours.onSurface, marginBottom: 4 },
  total: { color: colours.onSurface, marginBottom: 4 },
  date: { color: colours.primary },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    backgroundColor: colours.surfaceVariant,
  },
  bulkLabel: { flex: 1, color: colours.onSurfaceVariant },
  saveButton: { margin: spacing.base },
});
