/**
 * Tests for toastStore — queue, dedup semantics, ordering.
 * Spec §Presentation layer (hooks/stores) — toastStore.
 */

import { useToastStore } from './toastStore';
import type { ToastKind } from './toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ queue: [] });
  });

  describe('enqueue', () => {
    it('adds a toast to an empty queue', () => {
      useToastStore.getState().enqueue('Step 1 regressed', 'regression');
      const { queue } = useToastStore.getState();
      expect(queue).toHaveLength(1);
      expect(queue[0].message).toBe('Step 1 regressed');
      expect(queue[0].kind).toBe('regression');
    });

    it('enqueued item has an id and triggeredAt', () => {
      useToastStore.getState().enqueue('msg', 'info');
      const item = useToastStore.getState().queue[0];
      expect(item.id).toBeTruthy();
      expect(item.triggeredAt).toBeTruthy();
    });

    it('appends multiple toasts in order', () => {
      useToastStore.getState().enqueue('msg1', 'regression');
      useToastStore.getState().enqueue('msg2', 'error');
      useToastStore.getState().enqueue('msg3', 'info');
      const msgs = useToastStore.getState().queue.map((t) => t.message);
      expect(msgs).toEqual(['msg1', 'msg2', 'msg3']);
    });

    it('each item gets a unique id', () => {
      useToastStore.getState().enqueue('a', 'info');
      useToastStore.getState().enqueue('b', 'info');
      const ids = useToastStore.getState().queue.map((t) => t.id);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  describe('dequeue', () => {
    it('returns null when queue is empty', () => {
      expect(useToastStore.getState().dequeue()).toBeNull();
    });

    it('returns and removes head item (FIFO)', () => {
      useToastStore.getState().enqueue('first', 'regression');
      useToastStore.getState().enqueue('second', 'info');
      const head = useToastStore.getState().dequeue();
      expect(head?.message).toBe('first');
      expect(useToastStore.getState().queue).toHaveLength(1);
      expect(useToastStore.getState().queue[0].message).toBe('second');
    });
  });

  describe('clear', () => {
    it('empties the queue', () => {
      useToastStore.getState().enqueue('a', 'info');
      useToastStore.getState().enqueue('b', 'error');
      useToastStore.getState().clear();
      expect(useToastStore.getState().queue).toHaveLength(0);
    });
  });

  describe('kind values', () => {
    const kinds: ToastKind[] = ['regression', 'info', 'error'];
    it.each(kinds)('accepts kind %s', (kind) => {
      useToastStore.getState().enqueue('msg', kind);
      expect(useToastStore.getState().queue[0].kind).toBe(kind);
    });
  });
});
