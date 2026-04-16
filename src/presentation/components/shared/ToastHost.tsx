/**
 * ToastHost — reads toastStore.queue and shows react-native-paper Snackbar.
 *
 * Mount once at navigator root so toasts appear above all screens.
 * Mirrors CelebrationModalHost pattern.
 */

import React, { useEffect, useState } from 'react';
import { Snackbar } from 'react-native-paper';
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
    <Snackbar
      visible
      onDismiss={handleDismiss}
      duration={current.durationMs ?? DEFAULT_DURATION_MS}
      style={snackbarStyle(current.kind)}
      action={{ label: 'OK', onPress: handleDismiss }}
    >
      {current.message}
    </Snackbar>
  );
}
