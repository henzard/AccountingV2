/**
 * toastStore — Zustand store for UI regression toasts.
 *
 * Distinct from notificationStore (which manages push notification preferences).
 * This store queues non-blocking UI toast messages shown on foreground after a
 * Baby Step regression event.
 *
 * Spec §Presentation layer (hooks/stores) — toastStore.
 */

import { create } from 'zustand';

export type ToastKind = 'regression' | 'info' | 'error';

export interface ToastQueueItem {
  id: string;
  message: string;
  kind: ToastKind;
  triggeredAt: string;
}

interface ToastState {
  queue: ToastQueueItem[];
}

interface ToastActions {
  enqueue: (message: string, kind: ToastKind) => void;
  dequeue: () => ToastQueueItem | null;
  clear: () => void;
}

let _idCounter = 0;

function generateId(): string {
  _idCounter += 1;
  return `toast-${Date.now()}-${_idCounter}`;
}

export const useToastStore = create<ToastState & ToastActions>((set, get) => ({
  queue: [],

  enqueue: (message: string, kind: ToastKind): void => {
    set((state) => ({
      queue: [
        ...state.queue,
        {
          id: generateId(),
          message,
          kind,
          triggeredAt: new Date().toISOString(),
        },
      ],
    }));
  },

  dequeue: (): ToastQueueItem | null => {
    const { queue } = get();
    if (queue.length === 0) return null;
    const [head, ...rest] = queue;
    set({ queue: rest });
    return head;
  },

  clear: (): void => {
    set({ queue: [] });
  },
}));
