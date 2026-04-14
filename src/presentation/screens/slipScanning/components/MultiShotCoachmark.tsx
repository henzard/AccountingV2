import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';

export type MultiShotCoachmarkProps = {
  onDismiss: () => void;
};

export function MultiShotCoachmark({ onDismiss }: MultiShotCoachmarkProps): React.JSX.Element {
  return (
    <View style={styles.coachmark} testID="coachmark">
      <Text style={styles.coachmarkTitle}>How to scan</Text>
      <Text style={styles.coachmarkBody}>
        Tap the shutter to capture your slip. Capture up to 5 photos for multi-page slips.
      </Text>
      <TouchableOpacity onPress={onDismiss} testID="coachmark-dismiss">
        <Text style={styles.coachmarkDismiss}>Got it</Text>
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
    backgroundColor: 'rgba(0,0,0,0.85)',
    padding: 16,
    borderRadius: 12,
  },
  coachmarkTitle: { color: '#fff', fontWeight: 'bold', fontSize: 16, marginBottom: 8 },
  coachmarkBody: { color: '#ddd', marginBottom: 12 },
  coachmarkDismiss: { color: '#4CAF50', fontWeight: 'bold' },
});
