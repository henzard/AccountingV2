import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useDatabaseMigrations } from './src/data/local/db';

export default function App(): React.JSX.Element {
  const { success, error } = useDatabaseMigrations();

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>DB Error: {error.message}</Text>
      </View>
    );
  }

  if (!success) {
    return (
      <View style={styles.container}>
        <Text>Initialising database...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.ready}>AccountingV2 — DB Ready ✓</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ready: { fontSize: 18, color: '#00695C', fontWeight: 'bold' },
  error: { fontSize: 16, color: '#C62828' },
});
