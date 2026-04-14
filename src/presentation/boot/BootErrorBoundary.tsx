import React from 'react';
import { View, ScrollView, StyleSheet, Share } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { captureBoot } from '../../infrastructure/monitoring/earlyCrashLog';
import { colours } from '../theme/tokens';

interface State {
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
}

/**
 * Catches render-phase errors anywhere in the tree and displays them on-screen
 * so crashes are visible without leaving the app. Also persists them via
 * captureBoot so they survive across process restarts.
 */
export class BootErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    captureBoot('render (ErrorBoundary)', error);
  }

  private handleShare = (): void => {
    const err = this.state.error;
    if (!err) return;
    void Share.share({
      message: `${err.message}\n\n${err.stack ?? '(no stack)'}`,
    });
  };

  render(): React.ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    const err = this.state.error;
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text variant="titleLarge" style={styles.title}>
            App crashed while rendering
          </Text>
          <Text variant="labelLarge" style={styles.label}>
            Message
          </Text>
          <Text selectable style={styles.body}>
            {err.message}
          </Text>
          <Text variant="labelLarge" style={styles.label}>
            Stack
          </Text>
          <Text selectable style={styles.stack}>
            {err.stack ?? '(no stack)'}
          </Text>
        </ScrollView>
        <View style={styles.actions}>
          <Button mode="contained" onPress={this.handleShare}>
            Share
          </Button>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
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
