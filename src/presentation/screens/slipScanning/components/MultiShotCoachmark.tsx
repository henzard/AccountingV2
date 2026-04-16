import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { useAppTheme } from '../../../theme/useAppTheme';

export type MultiShotCoachmarkProps = {
  onDismiss: () => void;
};

export function MultiShotCoachmark({ onDismiss }: MultiShotCoachmarkProps): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={styles.coachmark} testID="coachmark">
      <Text style={styles.coachmarkTitle}>How to scan</Text>
      <Text style={styles.coachmarkBody}>
        Tap the shutter to capture your slip. Capture up to 5 photos for multi-page slips.
      </Text>
      <TouchableOpacity onPress={onDismiss} testID="coachmark-dismiss">
        <Text style={[styles.coachmarkDismiss, { color: colors.primary }]}>Got it</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  coachmark: {
    position: 'absolute',
    bottom: 160,
    left: 24,
    right: 24,
    // Dark translucent overlay on camera viewfinder — intentional, not theme-dependent
    backgroundColor: 'rgba(0,0,0,0.85)',
    padding: 16,
    borderRadius: 12,
  },
  // White/light-grey text on dark overlay is correct and intentional
  coachmarkTitle: { color: '#fff', fontWeight: 'bold', fontSize: 16, marginBottom: 8 },
  coachmarkBody: { color: '#ddd', marginBottom: 12 },
  coachmarkDismiss: { fontWeight: 'bold' },
});
