import React from 'react';
import { View, ScrollView, StyleSheet, Share, Appearance } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { captureBoot } from '../../infrastructure/monitoring/earlyCrashLog';
import { spacing } from '../theme/tokens';
import { lightTheme, darkTheme } from '../theme/useAppTheme';
import { useThemeStore } from '../stores/themeStore';

interface State {
  error: Error | null;
  shareFailed: boolean;
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
  state: State = { error: null, shareFailed: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, shareFailed: false };
  }

  componentDidCatch(error: Error): void {
    captureBoot('render (ErrorBoundary)', error);
  }

  private handleShare = (): void => {
    const err = this.state.error;
    if (!err) return;
    this.setState({ shareFailed: false });
    Share.share({
      message: `${err.message}\n\n${err.stack ?? '(no stack)'}`,
    }).catch(() => {
      // This boundary renders when the app crashed, so it must not depend on
      // any store/provider that may not exist — e.g. react-native-web's
      // Share.share rejects outright when navigator.share is unavailable
      // (Firefox, most desktop browsers). Fall back to local component state.
      this.setState({ shareFailed: true });
    });
  };

  private getThemeColors(): typeof lightTheme.colors | typeof darkTheme.colors {
    const preference = useThemeStore.getState().preference;
    const osScheme = Appearance.getColorScheme();
    const effective = preference === 'system' ? osScheme : preference;
    return effective === 'dark' ? darkTheme.colors : lightTheme.colors;
  }

  render(): React.ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    const err = this.state.error;
    const colors = this.getThemeColors();
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text variant="titleLarge" style={[styles.title, { color: colors.error }]}>
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
        {this.state.shareFailed && (
          <Text style={[styles.shareFallback, { color: colors.error }]}>
            Couldn&apos;t open sharing — select and copy the text above.
          </Text>
        )}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: spacing.xxl,
  },
  content: {
    padding: spacing.base,
  },
  title: {
    marginBottom: spacing.base,
  },
  label: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
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
    gap: spacing.md,
    padding: spacing.base,
  },
  shareFallback: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
  },
});
