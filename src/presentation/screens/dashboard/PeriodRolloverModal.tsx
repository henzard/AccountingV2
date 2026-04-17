import React from 'react';
import { View, StyleSheet, Modal } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

interface PeriodRolloverModalProps {
  visible: boolean;
  periodLabel: string;
  onAcknowledge: () => void;
}

export function PeriodRolloverModal({
  visible,
  periodLabel,
  onAcknowledge,
}: PeriodRolloverModalProps): React.JSX.Element {
  const { colors } = useAppTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onAcknowledge}
      testID="period-rollover-modal"
    >
      <View style={styles.overlay}>
        <Surface style={[styles.sheet, { backgroundColor: colors.surface }]} elevation={4}>
          <Text style={styles.icon}>📅</Text>
          <Text variant="titleLarge" style={[styles.title, { color: colors.onSurface }]}>
            New budget period
          </Text>
          <Text variant="bodyMedium" style={[styles.body, { color: colors.onSurfaceVariant }]}>
            {`${periodLabel} has started. Your envelopes have been reset. Review your allocations and start fresh — intentionally.`}
          </Text>
          <Button
            mode="contained"
            onPress={onAcknowledge}
            style={styles.btn}
            testID="period-rollover-acknowledge"
          >
            {`Start ${periodLabel}`}
          </Button>
        </Surface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    alignItems: 'center',
  },
  icon: {
    fontSize: 36,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: 'PlusJakartaSans_700Bold',
    marginBottom: spacing.base,
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  btn: { width: '100%' },
});
