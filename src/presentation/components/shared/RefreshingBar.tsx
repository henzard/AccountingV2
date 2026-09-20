import React from 'react';
import { StyleSheet } from 'react-native';
import { ProgressBar } from 'react-native-paper';
import { useAppTheme } from '../../theme/useAppTheme';

export interface RefreshingBarProps {
  /** True while a reload is in flight over data already on screen — see the
   * `refreshing` field on `useEnvelopes`/`useTransactions`/`useDebts`
   * (REG-9). NOT the first-load `loading` flag: that still drives each
   * screen's full skeleton/spinner state. */
  refreshing: boolean;
}

/**
 * Thin indeterminate progress bar shown under a screen's header while a
 * background reload (a sync round, pull-to-refresh, a period switch, …) is
 * in flight over data already on screen.
 *
 * Renders nothing when `refreshing` is false, so it never reserves layout
 * space that would compete with a screen's real content — callers place it
 * directly under their header, before the list/content, and must keep
 * rendering that list/content underneath rather than blanking it while
 * `refreshing` is true (see `useEnvelopes`'s doc comment on why `loading`
 * must not be used for this).
 */
export function RefreshingBar({ refreshing }: RefreshingBarProps): React.JSX.Element | null {
  const { colors } = useAppTheme();

  if (!refreshing) return null;

  return (
    <ProgressBar
      indeterminate
      color={colors.primary}
      style={styles.bar}
      accessibilityLabel="Updating"
      accessibilityLiveRegion="polite"
      testID="refreshing-bar"
    />
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 2,
  },
});
