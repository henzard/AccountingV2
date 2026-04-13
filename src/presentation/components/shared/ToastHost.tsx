/**
 * ToastHost — reads toastStore.queue and shows react-native-paper Snackbar.
 *
 * Mount once at navigator root so toasts appear above all screens.
 * Mirrors CelebrationModalHost pattern.
 */

import React, { useEffect, useState } from 'react';
import { Snackbar } from 'react-native-paper';
import { useToastStore, type ToastQueueItem } from '../../stores/toastStore';
import { colours } from '../../theme/tokens';

function snackbarStyle(kind: ToastQueueItem['kind']): object {
  switch (kind) {
    case 'error':
      return { backgroundColor: colours.error };
    case 'regression':
      return { backgroundColor: colours.warning };
    default:
      return { backgroundColor: colours.success };
  }
}

export function ToastHost(): React.JSX.Element | null {
  const queue = useToastStore((s) => s.queue);
  const dequeue = useToastStore((s) => s.dequeue);
  const [current, setCurrent] = useState<ToastQueueItem | null>(null);

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
      duration={3000}
      style={snackbarStyle(current.kind)}
      action={{ label: 'OK', onPress: handleDismiss }}
    >
      {current.message}
    </Snackbar>
  );
}
