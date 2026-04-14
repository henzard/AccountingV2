import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Share } from 'react-native';
import { Text, Button } from 'react-native-paper';
import {
  readLastCrash,
  clearLastCrash,
  type CrashRecord,
} from '../../infrastructure/monitoring/earlyCrashLog';
import { colours } from '../theme/tokens';

interface Props {
  children: React.ReactNode;
}

/**
 * On cold start, synchronously reads the last persisted crash. If one exists,
 * displays it on-screen instead of mounting the normal app tree — so users can
 * screenshot the error even when the app crashes immediately on boot.
 */
export function BootRecoveryGate({ children }: Props): React.JSX.Element {
  const [checked, setChecked] = useState(false);
  const [crash, setCrash] = useState<CrashRecord | null>(null);

  useEffect(() => {
    let mounted = true;
    readLastCrash()
      .then((record) => {
        if (!mounted) return;
        setCrash(record);
        setChecked(true);
      })
      .catch(() => {
        if (!mounted) return;
        setChecked(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!checked) {
    return <View style={styles.loading} />;
  }

  if (!crash) {
    return <>{children}</>;
  }

  const handleClear = async (): Promise<void> => {
    await clearLastCrash();
    setCrash(null);
  };

  const handleShare = (): void => {
    void Share.share({
      message: `[${crash.timestamp}] ${crash.step}\n${crash.message}\n\n${crash.stack}`,
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="titleLarge" style={styles.title}>
          Previous boot crashed
        </Text>
        <Text variant="bodySmall" style={styles.meta}>
          {crash.timestamp}
        </Text>
        <Text variant="labelLarge" style={styles.label}>
          Step
        </Text>
        <Text selectable style={styles.body}>
          {crash.step}
        </Text>
        <Text variant="labelLarge" style={styles.label}>
          Message
        </Text>
        <Text selectable style={styles.body}>
          {crash.message}
        </Text>
        <Text variant="labelLarge" style={styles.label}>
          Stack
        </Text>
        <Text selectable style={styles.stack}>
          {crash.stack}
        </Text>
      </ScrollView>
      <View style={styles.actions}>
        <Button mode="contained" onPress={handleShare}>
          Share
        </Button>
        <Button mode="outlined" onPress={handleClear}>
          Clear & continue
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colours.surface,
  },
  container: {
    flex: 1,
    backgroundColor: colours.surface,
    paddingTop: 48,
  },
  content: {
    padding: 16,
  },
  title: {
    color: '#b00020',
    marginBottom: 4,
  },
  meta: {
    opacity: 0.6,
    marginBottom: 16,
  },
  label: {
    marginTop: 12,
    marginBottom: 4,
  },
  body: {
    fontFamily: 'monospace',
  },
  stack: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
});
