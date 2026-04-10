import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colours, spacing } from '../../theme/tokens';
import type { LoginScreenProps } from '../../navigation/types';

export const LoginScreen: React.FC<LoginScreenProps> = () => {
  return (
    <View style={styles.container}>
      <Text variant="headlineLarge" style={{ color: colours.primary }}>
        AccountingV2
      </Text>
      <Text variant="bodyMedium" style={{ color: colours.onSurfaceVariant, marginTop: spacing.sm }}>
        Login screen — placeholder
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.surface, padding: spacing.base },
});
