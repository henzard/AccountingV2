/**
 * OfflineBanner — thin yellow banner shown when NetworkObserver reports offline.
 * Mount inside MainTabNavigator above the tab bar so it appears app-wide.
 */

import React, { useEffect } from 'react';
import { LayoutAnimation, Platform, UIManager, View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useNetworkStore } from '../../stores/networkStore';
import { colours, spacing } from '../../theme/tokens';

// Enable LayoutAnimation on Android (no-op on iOS where it's always on).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function OfflineBanner(): React.JSX.Element | null {
  const isOnline = useNetworkStore((s) => s.isOnline);

  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [isOnline]);

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
