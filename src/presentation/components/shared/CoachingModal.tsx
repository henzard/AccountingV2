import React from 'react';
import { View, StyleSheet, Modal } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';
import { formatCurrency } from '../../utils/currency';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

interface CoachingModalProps {
  visible: boolean;
  message: string;
  overspendCents: number;
  onProceed: () => void;
  onCancel: () => void;
}

export function CoachingModal({
  visible,
  message,
  overspendCents,
  onProceed,
  onCancel,
}: CoachingModalProps): React.JSX.Element {
  const { colors } = useAppTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID="coaching-modal"
    >
      <View style={styles.overlay}>
        <Surface style={[styles.sheet, { backgroundColor: colors.surface }]} elevation={4}>
          <Text style={styles.icon}>💬</Text>

          <Text variant="labelSmall" style={[styles.eyebrow, { color: colors.primary }]}>
            WHAT WOULD DAVE SAY?
          </Text>

          <Text variant="bodyLarge" style={[styles.message, { color: colors.onSurface }]}>
            {message}
          </Text>

          <Text
            variant="bodySmall"
            style={[styles.overspend, { color: colors.error }]}
            testID="coaching-overspend-amount"
          >
            This transaction puts you {formatCurrency(overspendCents)} over budget.
          </Text>

          <View style={styles.buttons}>
            <Button mode="outlined" onPress={onCancel} style={styles.btn} testID="coaching-cancel">
              Change amount
            </Button>
            <Button
              mode="contained"
              onPress={onProceed}
              buttonColor={colors.error}
              style={styles.btn}
              testID="coaching-proceed"
            >
              Log it anyway
            </Button>
          </View>
        </Surface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  icon: {
    fontSize: 32,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  eyebrow: {
    letterSpacing: 1.4,
    textAlign: 'center',
    marginBottom: spacing.base,
  },
  message: {
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: spacing.base,
    lineHeight: 24,
  },
  overspend: {
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btn: { flex: 1 },
});
