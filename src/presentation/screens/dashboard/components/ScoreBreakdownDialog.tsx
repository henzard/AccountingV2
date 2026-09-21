/**
 * ScoreBreakdownDialog — tap-through breakdown of the habit score shown on
 * the dashboard. Surfaces the exact point components `HabitScoreCalculator`
 * already returns (`loggingPoints`/`disciplinePoints`/`metersPoints`/
 * `babyStepPoints`) instead of leaving the single number unexplained.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Dialog, Portal, Text, Button } from 'react-native-paper';
import { useAppTheme } from '../../../theme/useAppTheme';
import { spacing } from '../../../theme/tokens';
import type { HabitScoreResult } from '../../../../domain/scoring/RamseyScoreCalculator';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  result: HabitScoreResult;
}

interface BreakdownRow {
  key: keyof Omit<HabitScoreResult, 'score'>;
  label: string;
  max: number;
}

const ROWS: BreakdownRow[] = [
  { key: 'loggingPoints', label: 'Logging transactions', max: 30 },
  { key: 'disciplinePoints', label: 'Staying on budget', max: 30 },
  { key: 'metersPoints', label: 'Meter readings logged', max: 20 },
  { key: 'babyStepPoints', label: 'Active baby step', max: 20 },
];

export function ScoreBreakdownDialog({ visible, onDismiss, result }: Props): React.JSX.Element {
  const { colors } = useAppTheme();

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} testID="score-breakdown-dialog">
        <Dialog.Title>Score breakdown</Dialog.Title>
        <Dialog.Content>
          {ROWS.map((row) => {
            // `null` means the component did not apply to this household at
            // all (they have never used it), so it was excluded and the rest
            // re-normalised to 100 — see `HabitScoreCalculator`. Printing
            // "0 / 20" would misreport a number that never counted.
            const value = result[row.key];
            return (
              <View key={row.key} style={styles.row} testID={`score-breakdown-row-${row.key}`}>
                <Text style={{ color: colors.onSurface }}>{row.label}</Text>
                <Text style={{ color: colors.onSurfaceVariant }}>
                  {value === null ? 'not used, not counted' : `${value} / ${row.max}`}
                </Text>
              </View>
            );
          })}
          <View style={[styles.row, styles.totalRow, { borderTopColor: colors.outlineVariant }]}>
            <Text style={[styles.totalLabel, { color: colors.onSurface }]}>Total</Text>
            <Text style={[styles.totalLabel, { color: colors.onSurface }]}>
              {`${result.score} / 100`}
            </Text>
          </View>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss} testID="score-breakdown-close">
            Close
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  totalRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  totalLabel: {
    fontFamily: 'PlusJakartaSans_700Bold',
  },
});
