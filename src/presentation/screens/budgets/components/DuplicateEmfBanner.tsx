/**
 * DuplicateEmfBanner — shown on Budget screen when a duplicate emergency fund
 * envelope was resolved by ReconcileEmergencyFundTypeUseCase.
 *
 * Copy verbatim from spec §Duplicate-EMF banner copy:
 *   "We found two emergency fund envelopes (one from each device). We kept
 *    the original. The other is now a Savings envelope — check your Budget
 *    to confirm."
 *
 * Dismissible. Backed by useEmergencyFundReconcileFlag hook.
 *
 * Spec §Duplicate-EMF banner copy, task 4.14.
 */

import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useEmergencyFundReconcileFlag } from '../../../hooks/useEmergencyFundReconcileFlag';
import { colours, spacing, radius } from '../../../theme/tokens';

const COPY =
  'We found two emergency fund envelopes (one from each device). We kept the original. The other is now a Savings envelope — check your Budget to confirm.';

export const DuplicateEmfBanner: React.FC = () => {
  const { hasFlag, dismiss } = useEmergencyFundReconcileFlag();

  if (!hasFlag) return null;

  return (
    <Surface
      style={styles.banner}
      elevation={0}
      testID="duplicate-emf-banner"
    >
      <MaterialCommunityIcons
        name="information-outline"
        size={20}
        color={colours.warning}
        style={styles.icon}
      />
      <Text variant="bodySmall" style={styles.copy} testID="duplicate-emf-copy">
        {COPY}
      </Text>
      <TouchableOpacity
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
        testID="duplicate-emf-dismiss"
      >
        <MaterialCommunityIcons name="close" size={18} color={colours.onSurfaceVariant} />
      </TouchableOpacity>
    </Surface>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colours.warningContainer,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  icon: {
    marginTop: 1,
  },
  copy: {
    flex: 1,
    color: colours.onSurface,
    lineHeight: 20,
  },
});
