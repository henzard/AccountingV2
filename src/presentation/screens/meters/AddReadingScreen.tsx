import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TextInput, Button, SegmentedButtons, HelperText, Chip } from 'react-native-paper';
import { format } from 'date-fns';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { meterReadings as meterReadingsTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { LogMeterReadingUseCase } from '../../../domain/meterReadings/LogMeterReadingUseCase';
import { AnomalyDetector } from '../../../domain/meterReadings/AnomalyDetector';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { MeterReadingEntity, MeterType } from '../../../domain/meterReadings/MeterReadingEntity';
import { getMeterUnitLabel } from '../../../domain/meterReadings/MeterReadingEntity';
import type { AddReadingScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);
const anomalyDetector = new AnomalyDetector();

export const AddReadingScreen: React.FC<AddReadingScreenProps> = ({ navigation, route }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const [meterType, setMeterType] = useState<MeterType>(route.params.meterType);
  const [readingValue, setReadingValue] = useState('');
  const [costRands, setCostRands] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anomalyWarning, setAnomalyWarning] = useState<string | null>(null);
  const [priorReadings, setPriorReadings] = useState<MeterReadingEntity[]>([]);

  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    db.select()
      .from(meterReadingsTable)
      .where(
        and(
          eq(meterReadingsTable.householdId, householdId),
          eq(meterReadingsTable.meterType, meterType),
        ),
      )
      .orderBy(desc(meterReadingsTable.readingDate))
      .limit(10)
      .then((rows) => setPriorReadings(rows as MeterReadingEntity[]));
  }, [householdId, meterType]);

  const checkAnomaly = useCallback(
    (valueStr: string) => {
      const value = parseFloat(valueStr);
      if (isNaN(value) || priorReadings.length < 3) {
        setAnomalyWarning(null);
        return;
      }
      const preview: MeterReadingEntity = {
        id: 'preview',
        householdId,
        meterType,
        readingValue: value,
        readingDate: today,
        costCents: null,
        vehicleId: null,
        notes: null,
        createdAt: today,
        updatedAt: today,
        isSynced: false,
      };
      const result = anomalyDetector.detect(preview, priorReadings);
      if (result.isAnomaly) {
        const pct = Math.round(result.deviationPercent * 100);
        const unit = getMeterUnitLabel(meterType);
        const direction = result.currentConsumption > result.rollingAverageConsumption ? 'above' : 'below';
        setAnomalyWarning(
          `Consumption is ${pct}% ${direction} your ${result.rollingAverageConsumption.toFixed(1)} ${unit} average. Please verify before saving.`,
        );
      } else {
        setAnomalyWarning(null);
      }
    },
    [priorReadings, householdId, meterType, today],
  );

  const handleSave = async () => {
    const value = parseFloat(readingValue);
    if (isNaN(value) || value <= 0) {
      setError('Reading value must be a positive number');
      return;
    }
    const costCents = costRands.trim() ? Math.round(parseFloat(costRands) * 100) : null;
    setSaving(true);
    setError(null);
    const uc = new LogMeterReadingUseCase(db, audit, {
      householdId,
      meterType,
      readingValue: value,
      readingDate: today,
      costCents,
      vehicleId: null,
      notes: notes.trim() || null,
    });
    const result = await uc.execute();
    setSaving(false);
    if (result.success) {
      navigation.goBack();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text variant="titleMedium" style={styles.label}>Meter Type</Text>
      <SegmentedButtons
        value={meterType}
        onValueChange={(v) => { setMeterType(v as MeterType); setAnomalyWarning(null); }}
        buttons={[
          { value: 'electricity', label: 'Electricity', icon: 'lightning-bolt' },
          { value: 'water', label: 'Water', icon: 'water' },
          { value: 'odometer', label: 'Vehicle', icon: 'car' },
        ]}
        style={styles.segmented}
      />

      <TextInput
        label={`Current reading (${getMeterUnitLabel(meterType)})`}
        value={readingValue}
        onChangeText={(v) => { setReadingValue(v); checkAnomaly(v); }}
        keyboardType="numeric"
        mode="outlined"
        style={styles.input}
      />

      {anomalyWarning ? (
        <Chip icon="alert" style={styles.anomalyChip} textStyle={styles.anomalyText}>
          {anomalyWarning}
        </Chip>
      ) : null}

      <TextInput
        label="Cost this period (R) — optional"
        value={costRands}
        onChangeText={setCostRands}
        keyboardType="numeric"
        mode="outlined"
        style={styles.input}
      />

      <TextInput
        label="Notes — optional"
        value={notes}
        onChangeText={setNotes}
        mode="outlined"
        style={styles.input}
      />

      {error ? <HelperText type="error">{error}</HelperText> : null}

      <Button
        mode="contained"
        onPress={handleSave}
        loading={saving}
        disabled={saving}
        style={styles.button}
      >
        Save Reading
      </Button>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: spacing.base, gap: spacing.sm },
  label: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  segmented: { marginBottom: spacing.sm },
  input: { backgroundColor: colours.surface },
  anomalyChip: { backgroundColor: colours.warningContainer },
  anomalyText: { color: colours.warning, fontSize: 12, flexShrink: 1 },
  button: { marginTop: spacing.base, backgroundColor: colours.primary },
});
