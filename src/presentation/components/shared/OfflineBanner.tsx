/**
 * OfflineBanner — thin yellow banner shown when NetworkObserver reports offline.
 * Mount inside MainTabNavigator above the tab bar so it appears app-wide.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useNetworkStore } from '../../stores/networkStore';
import { colours, spacing } from '../../theme/tokens';

export function OfflineBanner(): React.JSX.Element | null {
  const isOnline = useNetworkStore((s) => s.isOnline);

  if (isOnline) return null;

  return (
    <View style={styles.banner} testID="offline-banner">
      <Text variant="labelSmall" style={styles.text}>
        Offline — changes will sync when you're back online.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colours.warningContainer,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.base,
    alignItems: 'center',
  },
  text: {
    color: colours.warning,
    textAlign: 'center',
  },
});
