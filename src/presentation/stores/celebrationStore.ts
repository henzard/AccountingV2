/**
 * celebrationStore — Zustand store for the Baby Step celebration modal queue.
 *
 * Dedup rules (spec §Concurrency guards):
 *  (a) stepNumber already in queue → drop.
 *  (b) persisted celebrated_at is non-null → drop (step already celebrated, no re-fire).
 *
 * The store accepts an async dedup check function at init time so tests can inject
 * a fake without touching the real DB.
 *
 * Spec §Presentation layer (hooks/stores) — celebrationStore.
 */

import { create } from 'zustand';

export interface CelebrationQueueItem {
  stepNumber: number;
  triggeredAt: string;
}

/** Async function that returns true if the step's celebrated_at is already stamped. */
export type CelebratedAtChecker = (stepNumber: number) => Promise<boolean>;

interface CelebrationState {
  queue: CelebrationQueueItem[];
  /** Injected checker — must be set via init() before enqueue is called in prod. */
  _checker: CelebratedAtChecker | null;
}

interface CelebrationActions {
  /** Inject the celebrated_at checker (once per app lifecycle). */
  init: (checker: CelebratedAtChecker) => void;
  /** Enqueue a step celebration, applying dedup rules. */
  enqueue: (stepNumber: number) => Promise<void>;
  /** Remove and return the head item, or null if queue is empty. */
  dequeue: () => CelebrationQueueItem | null;
  /** Clear the entire queue. */
  clear: () => void;
}

export const useCelebrationStore = create<CelebrationState & CelebrationActions>((set, get) => ({
  queue: [],
  _checker: null,

  init: (checker: CelebratedAtChecker): void => {
    set({ _checker: checker });
  },

  enqueue: async (stepNumber: number): Promise<void> => {
    const { queue, _checker } = get();

    // Dedup (a): already in queue
    if (queue.some((item) => item.stepNumber === stepNumber)) {
      return;
    }

    // Dedup (b): persisted celebrated_at is non-null
    if (_checker) {
      const alreadyCelebrated = await _checker(stepNumber);
      if (alreadyCelebrated) {
        return;
      }
    }

    set((state) => ({
      queue: [
        ...state.queue,
        { stepNumber, triggeredAt: new Date().toISOString() },
      ],
    }));
  },

  dequeue: (): CelebrationQueueItem | null => {
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
