/**
 * ToastHost — reads toastStore.queue and shows react-native-paper Snackbar.
 *
 * UX2-3: must be mounted exactly ONCE, at the app root (RootNavigator, next
 * to the root ConfirmDialogHost) — not inside MainTabNavigator. The old
 * MainTabNavigator-only mount meant every toast enqueued from a screen
 * outside the five main tabs (JoinHousehold's "wrong invite code",
 * CreateHousehold/HouseholdMembers errors, SlipCapture, onboarding notices)
 * had nowhere to render and either silently vanished or appeared stale once
 * the user navigated back into a tab. The Snackbar is wrapped in Paper's
 * `<Portal>` so it renders above whatever screen is currently on top,
 * regardless of where in the tree ToastHost itself lives (PaperProvider
 * already supplies the Portal.Host — see App.tsx).
 */

import React, { useEffect, useState } from 'react';
import { Snackbar, Portal } from 'react-native-paper';
import { useToastStore, type ToastQueueItem } from '../../stores/toastStore';
import { useAppTheme } from '../../theme/useAppTheme';

const DEFAULT_DURATION_MS = 3000;

export function ToastHost(): React.JSX.Element | null {
  const { colors } = useAppTheme();
  const queue = useToastStore((s) => s.queue);
  const dequeue = useToastStore((s) => s.dequeue);
  const [current, setCurrent] = useState<ToastQueueItem | null>(null);

  function snackbarStyle(kind: ToastQueueItem['kind']): object {
    switch (kind) {
      case 'error':
        return { backgroundColor: colors.error };
      case 'regression':
        return { backgroundColor: colors.warning };
      case 'success':
        return { backgroundColor: colors.success };
      default:
        return { backgroundColor: colors.success };
    }
  }

  useEffect(() => {
    if (!current && queue.length > 0) {
      setCurrent(queue[0]);
    }
  }, [queue, current]);

  const handleDismiss = (): void => {
    dequeue();
    setCurrent(null);
  };

  if (!current) return null;

  return (
    <Portal>
      <Snackbar
        visible
        onDismiss={handleDismiss}
        duration={current.durationMs ?? DEFAULT_DURATION_MS}
        style={snackbarStyle(current.kind)}
        action={{ label: 'OK', onPress: handleDismiss }}
      >
        {current.message}
      </Snackbar>
    </Portal>
  );
}
