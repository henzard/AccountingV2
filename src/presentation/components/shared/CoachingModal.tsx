import React from 'react';
import { View, StyleSheet, Modal } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';
import { formatCurrency } from '../../utils/currency';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { EnvelopeScope } from '../../../domain/envelopes/EnvelopeEntity';

interface CoachingModalProps {
  visible: boolean;
  message: string;
  overspendCents: number;
  onProceed: () => void;
  onCancel: () => void;
  /**
   * REG-8/VAL2-2: a persistent envelope (fund) has no "budget" to go over —
   * `overspendCents` there is the amount short of its saved balance, so the
   * detail sentence must read differently. Defaults to 'period' (the
   * original, budget-scoped wording) so existing callers are unaffected.
   */
  scope?: EnvelopeScope;
  /**
   * VAL2-9: "cover it from another envelope" — moving unspent ALLOCATION
   * from a sibling envelope only makes sense for a PERIOD-scoped overspend
   * (a fund's "over budget" reading is against its own saved balance, not a
   * monthly allocation another fund could lend it). Omit — or pass
   * `undefined` — to hide the action entirely: this happens both when
   * `scope` is 'persistent' and when the caller found no sibling envelope
   * with enough unspent money to cover the shortfall.
   */
  onCoverFromAnotherEnvelope?: () => void;
}

export function CoachingModal({
  visible,
  message,
  overspendCents,
  onProceed,
  onCancel,
  scope = 'period',
  onCoverFromAnotherEnvelope,
}: CoachingModalProps): React.JSX.Element {
  const { colors } = useAppTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay} testID="coaching-modal">
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
            {scope === 'persistent'
              ? `This transaction is ${formatCurrency(overspendCents)} more than what's saved in this fund.`
              : `This transaction puts you ${formatCurrency(overspendCents)} over budget.`}
          </Text>

          {scope === 'period' && onCoverFromAnotherEnvelope && (
            <Button
              mode="text"
              onPress={onCoverFromAnotherEnvelope}
              style={styles.coverBtn}
              testID="coaching-cover-from-another-envelope"
            >
              Cover it from another envelope
            </Button>
          )}

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
  coverBtn: {
    marginBottom: spacing.sm,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btn: { flex: 1 },
});
