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
import { colours, spacing, radius } from '../../../theme/tokens';

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
  return (
    <Surface style={styles.container} elevation={0} testID="manual-step-panel">
      <View style={styles.iconRow}>
        <MaterialCommunityIcons name="hand-pointing-right" size={32} color={colours.secondary} />
      </View>

      <Text variant="bodyMedium" style={styles.label}>
        You decide when this is complete — tap to mark done.
      </Text>

      <View style={styles.switchRow}>
        <Text variant="labelLarge" style={styles.switchLabel}>
          {isCompleted ? 'Done' : 'Not yet'}
        </Text>
        <Switch
          value={isCompleted}
          onValueChange={onToggle}
          disabled={loading}
          trackColor={{ false: colours.outlineVariant, true: colours.primary }}
          thumbColor={isCompleted ? colours.onPrimary : colours.surface}
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
    backgroundColor: colours.secondaryContainer,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colours.secondary,
    padding: spacing.base,
    gap: spacing.sm,
  },
  iconRow: {
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  label: {
    color: colours.onSecondaryContainer,
    textAlign: 'center',
    lineHeight: 22,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  switchLabel: {
    color: colours.onSecondaryContainer,
  },
});
