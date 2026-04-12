/**
 * CelebrationModal — ribbon-and-seal stamp overlay for Baby Step completion.
 *
 * Full-screen overlay with muted ledger-paper tint.
 * 144×144 StepSealMark, spring-animated scale 0.6→1.0 + opacity 0→1 over ~600ms with overshoot.
 * reducedMotion prop skips animation (renders final state immediately) — used in tests.
 * Ribbon banner: "Completed <date>".
 * Dismiss button triggers onDismiss callback (caller stamps via StampCelebratedUseCase).
 *
 * Spec §CelebrationModal, §Visual Identity.
 */

import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Animated,
} from 'react-native';
import { Text, Button } from 'react-native-paper';
import { format, parseISO } from 'date-fns';
import { StepSealMark } from './components/StepSealMark';
import { BABY_STEP_RULES } from '../../../domain/babySteps/BabyStepRules';
import type { BabyStepStatus } from '../../../domain/babySteps/types';
import { colours, spacing, radius } from '../../theme/tokens';

export interface CelebrationModalProps {
  /** The step being celebrated */
  status: BabyStepStatus;
  /** Called when user taps the dismiss button — caller stamps celebrated_at */
  onDismiss: () => void;
  /** When true, skips spring animation — renders final state immediately */
  reducedMotion?: boolean;
  /** Whether modal is visible */
  visible: boolean;
}

const SEAL_SIZE = 144;

// One-off intentional colour: muted ledger-paper tint for the full-screen overlay.
const LEDGER_PAPER_TINT = 'rgba(230, 240, 235, 0.97)';

export const CelebrationModal: React.FC<CelebrationModalProps> = ({
  status,
  onDismiss,
  reducedMotion = false,
  visible,
}) => {
  const scaleAnim = useRef(new Animated.Value(reducedMotion ? 1.0 : 0.6)).current;
  const opacityAnim = useRef(new Animated.Value(reducedMotion ? 1.0 : 0)).current;

  useEffect(() => {
    if (!visible) return;

    if (reducedMotion) {
      scaleAnim.setValue(1.0);
      opacityAnim.setValue(1.0);
      return;
    }

    // Spring: scale 0.6→1.0, opacity 0→1, ~600ms with overshoot
    const anim = Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1.0,
        useNativeDriver: true,
        tension: 60,
        friction: 6,
        // Overshoot: friction=6 with tension=60 gives ~1.05 overshoot naturally
      }),
      Animated.timing(opacityAnim, {
        toValue: 1.0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [visible, reducedMotion, scaleAnim, opacityAnim]);

  // Reset animation values when modal closes
  useEffect(() => {
    if (!visible) {
      scaleAnim.setValue(reducedMotion ? 1.0 : 0.6);
      opacityAnim.setValue(reducedMotion ? 1.0 : 0);
    }
  }, [visible, reducedMotion, scaleAnim, opacityAnim]);

  const rule = BABY_STEP_RULES[status.stepNumber];

  const completedDate = status.completedAt
    ? format(parseISO(status.completedAt), 'd MMM yyyy')
    : format(new Date(), 'd MMM yyyy');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onDismiss}
      testID="celebration-modal"
    >
      {/* Ledger-paper tint overlay */}
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Ribbon banner */}
          <View style={styles.ribbon}>
            <Text variant="labelSmall" style={styles.ribbonText}>
              {`Completed ${completedDate}`}
            </Text>
          </View>

          {/* Animated seal */}
          <Animated.View
            style={[
              styles.sealContainer,
              { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
            ]}
            testID="celebration-seal"
          >
            <StepSealMark
              stepNumber={status.stepNumber}
              state="complete"
              size={SEAL_SIZE}
            />
          </Animated.View>

          {/* Step title */}
          <Text
            variant="headlineMedium"
            style={styles.stepTitle}
            testID="celebration-title"
          >
            {rule.shortTitle}
          </Text>

          {/* Completion message */}
          <Text
            variant="bodyLarge"
            style={styles.completionMessage}
            testID="celebration-message"
          >
            {rule.completionMessage}
          </Text>

          {/* Dismiss */}
          <Button
            mode="contained"
            onPress={onDismiss}
            style={styles.dismissButton}
            contentStyle={styles.dismissButtonContent}
            testID="celebration-dismiss"
          >
            Continue
          </Button>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: LEDGER_PAPER_TINT,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    alignItems: 'center',
    gap: spacing.base,
    maxWidth: 360,
    width: '100%',
  },
  ribbon: {
    backgroundColor: colours.secondary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  ribbonText: {
    color: colours.onSecondary,
    letterSpacing: 0.8,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  sealContainer: {
    marginVertical: spacing.lg,
  },
  stepTitle: {
    color: colours.onSurface,
    fontFamily: 'PlusJakartaSans_700Bold',
    textAlign: 'center',
  },
  completionMessage: {
    color: colours.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 26,
  },
  dismissButton: {
    marginTop: spacing.lg,
    backgroundColor: colours.primary,
    borderRadius: radius.full,
    minWidth: 180,
  },
  dismissButtonContent: {
    paddingVertical: spacing.xs,
  },
});
