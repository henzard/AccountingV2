/**
 * OfflineBanner — thin banner mounted app-wide (above the tab bar in
 * MainTabNavigator) so a sync problem is visible wherever the user actually
 * is, not just buried in Settings > Sync Health.
 *
 * Priority (offline wins over everything else — there's no point telling a
 * fully-offline user their pull is "stuck", that's just what offline means):
 *   1. offline                      — existing copy, not tappable.
 *   2. online, pull blocked         — "Sync is stuck..."  tap -> Sync Health.
 *   3. online, dead-lettered items  — "Some changes couldn't sync..." tap -> Sync Health.
 *   4. none of the above            — render nothing (in particular, a
 *      transient/backing-off `syncStore.error` never shows a banner here —
 *      only the three durable states above do).
 */

import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  LayoutAnimation,
  Platform,
  UIManager,
  Pressable,
  View,
  StyleSheet,
} from 'react-native';
import { Text } from 'react-native-paper';
import { NavigationContext } from '@react-navigation/native';
import { useSyncStore } from '../../stores/syncStore';
import { useSyncEngineStore } from '../../stores/syncEngineStore';
import { useAppStore } from '../../stores/appStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

// Enable LayoutAnimation on Android (no-op on iOS where it's always on).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const MIN_TOUCH_HEIGHT = 44;

type BannerState =
  | { kind: 'offline' }
  | { kind: 'pull-blocked' }
  | { kind: 'dead-lettered' }
  | null;

const COPY: Record<Exclude<BannerState, null>['kind'], string> = {
  offline: "Offline — changes will sync when you're back online.",
  'pull-blocked': "Sync is stuck — your partner's changes aren't arriving. Tap to fix.",
  'dead-lettered': "Some changes couldn't sync. Tap to review.",
};

export function OfflineBanner(): React.JSX.Element | null {
  const { colors } = useAppTheme();
  // Not `useNavigation()`: that throws when rendered outside a
  // NavigationContainer. OfflineBanner is mounted app-wide (including in
  // tests without a navigator), so read the context directly and treat a
  // missing one as "not tappable" rather than crashing.
  const navigation = useContext(NavigationContext);

  const isOnline = useSyncStore((s) => s.isOnline);
  const pullBlocked = useSyncStore((s) => s.pullBlocked);
  // Not the sync status/count themselves — used only to know a sync round
  // just finished, so the dead-letter count below is re-read (mirrors
  // SyncHealthScreen's own `refresh` dependency list).
  const pendingSyncCount = useSyncStore((s) => s.pendingSyncCount);
  const syncStatus = useSyncStore((s) => s.syncStatus);

  const engine = useSyncEngineStore((s) => s.engine);
  const householdId = useAppStore((s) => s.householdId);

  const [hasDeadLettered, setHasDeadLettered] = useState(false);

  useEffect(() => {
    if (!engine || !householdId) {
      setHasDeadLettered(false);
      return;
    }
    setHasDeadLettered(engine.listDeadLettered(householdId).length > 0);
  }, [engine, householdId, pendingSyncCount, syncStatus, pullBlocked]);

  const state: BannerState = !isOnline
    ? { kind: 'offline' }
    : pullBlocked
      ? { kind: 'pull-blocked' }
      : hasDeadLettered
        ? { kind: 'dead-lettered' }
        : null;

  // Reduce-motion: read once, then follow changes. Unknown counts as "on",
  // so the banner never animates before the setting is known.
  const reduceMotionRef = useRef(true);
  useEffect(() => {
    let eventSeen = false;
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      eventSeen = true;
      reduceMotionRef.current = enabled;
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!eventSeen) reduceMotionRef.current = enabled;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (reduceMotionRef.current) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [state?.kind]);

  const handlePress = useCallback((): void => {
    if (!navigation) return;
    // `navigation` here is the RootStack's navigation object for the 'Main'
    // screen (OfflineBanner renders above <Tab.Navigator>, so no tab/stack
    // context has been entered yet) — same nested-navigate pattern used
    // elsewhere for reaching a screen inside a different tab's stack (see
    // RootNavigator's `navigateToTarget` / SlipProcessingScreen's
    // `getParent()?.navigate('Main', {...})`). Cast through `unknown`, never
    // `any`, since `RootStackParamList.Main` is typed `undefined` and can't
    // express the nested params react-navigation still accepts at runtime.
    const navigate = navigation.navigate as unknown as (screen: string, params?: object) => void;
    navigate('Main', { screen: 'Settings', params: { screen: 'SyncHealth' } });
  }, [navigation]);

  if (!state) return null;

  const tappable = state.kind !== 'offline' && Boolean(navigation);
  const backgroundColor =
    state.kind === 'dead-lettered' ? colors.errorContainer : colors.warningContainer;
  const textColor = state.kind === 'dead-lettered' ? colors.error : colors.warning;

  const content = (
    <Text variant="labelSmall" style={[styles.text, { color: textColor }]}>
      {COPY[state.kind]}
    </Text>
  );

  if (tappable) {
    return (
      <Pressable
        onPress={handlePress}
        style={[styles.banner, styles.touchTarget, { backgroundColor }]}
        testID="offline-banner"
        accessible
        accessibilityRole="button"
        accessibilityLabel={COPY[state.kind]}
        accessibilityLiveRegion="polite"
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      style={[styles.banner, { backgroundColor }]}
      testID="offline-banner"
      accessibilityLabel={COPY[state.kind]}
      accessibilityLiveRegion="polite"
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  touchTarget: {
    minHeight: MIN_TOUCH_HEIGHT,
  },
  text: {
    textAlign: 'center',
  },
});
