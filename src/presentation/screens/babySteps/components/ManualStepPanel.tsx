/**
 * ManualStepPanel — toggle control for manual Baby Steps (4, 5, 7).
 *
 * Verbatim label: "You decide when this is complete — tap to mark done."
 * Large switch with a11y role=switch and state.
 * Visually distinct container from CurrentStepHero ring layout —
 * uses a dashed border + secondary-tinted background vs the ring's
 * solid-primary-container card.
 *
 * Spec §ManualStepPanel, §Accessibility (switch role + state).
 */

import React from 'react';
import { View, StyleSheet, Switch } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { spacing, radius } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';

export interface ManualStepPanelProps {
  /** Whether the step is currently marked done */
  isCompleted: boolean;
  /** Called when the user flips the switch */
  onToggle: (value: boolean) => void;
  /** Whether the toggle is processing (disables input) */
  loading?: boolean;
}

export const ManualStepPanel: React.FC<ManualStepPanelProps> = ({
  isCompleted,
  onToggle,
  loading = false,
}) => {
  const { colors } = useAppTheme();
  return (
    <Surface
      style={[
        styles.container,
        { backgroundColor: colors.secondaryContainer, borderColor: colors.secondary },
      ]}
      elevation={0}
      testID="manual-step-panel"
    >
      <View style={styles.iconRow}>
        <MaterialCommunityIcons name="hand-pointing-right" size={32} color={colors.secondary} />
      </View>

      <Text variant="bodyMedium" style={[styles.label, { color: colors.onSecondaryContainer }]}>
        You decide when this is complete — tap to mark done.
      </Text>

      <View style={styles.switchRow}>
        <Text
          variant="labelLarge"
          style={[styles.switchLabel, { color: colors.onSecondaryContainer }]}
        >
          {isCompleted ? 'Done' : 'Not yet'}
        </Text>
        <Switch
          value={isCompleted}
          onValueChange={onToggle}
          disabled={loading}
          trackColor={{ false: colors.outlineVariant, true: colors.primary }}
          thumbColor={isCompleted ? colors.onPrimary : colors.surface}
          accessible
          accessibilityRole="switch"
          accessibilityState={{ checked: isCompleted, disabled: loading }}
          accessibilityLabel="Mark step complete"
          testID="manual-step-switch"
        />
      </View>
    </Surface>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    padding: spacing.base,
    gap: spacing.sm,
  },
  iconRow: {
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  label: {
    textAlign: 'center',
    lineHeight: 22,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  switchLabel: {},
});
