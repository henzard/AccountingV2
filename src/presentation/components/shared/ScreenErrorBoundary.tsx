import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing } from '../../theme/tokens';

interface State {
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
}

/**
 * Lightweight per-screen error boundary. When a screen crashes, only the
 * affected screen is replaced with a recovery UI — the rest of the app
 * (tabs, navigation) stays mounted and functional.
 */
export class ScreenErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    return <ScreenErrorFallback error={this.state.error} onReset={this.handleReset} />;
  }
}

function ScreenErrorFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <Text variant="titleLarge" style={[styles.title, { color: colors.error }]}>
        Something went wrong
      </Text>
      <Text variant="bodyMedium" style={[styles.body, { color: colors.onSurfaceVariant }]}>
        {__DEV__ ? error.message : 'An unexpected error occurred on this screen.'}
      </Text>
      {__DEV__ && error.stack && (
        <Text selectable style={[styles.stack, { color: colors.onSurfaceVariant }]}>
          {error.stack}
        </Text>
      )}
      <Button mode="contained" onPress={onReset} style={styles.button}>
        Try Again
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  title: {
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  body: {
    marginBottom: spacing.base,
    textAlign: 'center',
  },
  stack: {
    fontFamily: 'monospace',
    fontSize: 10,
    marginBottom: spacing.base,
    maxHeight: 200,
  },
  button: {
    marginTop: spacing.md,
  },
});
