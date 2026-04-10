import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colours, spacing } from '../../theme/tokens';
import type { DashboardScreenProps } from '../../navigation/types';

export const DashboardScreen: React.FC<DashboardScreenProps> = () => {
  return (
    <View style={styles.container}>
      <Text variant="headlineLarge" style={{ color: colours.primary }}>
        Dashboard
      </Text>
      <Text variant="bodyMedium" style={{ color: colours.onSurfaceVariant, marginTop: spacing.sm }}>
        Envelope list will render here
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.surface, padding: spacing.base },
});
