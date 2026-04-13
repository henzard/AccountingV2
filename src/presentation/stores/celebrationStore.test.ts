/**
 * Tests for celebrationStore — dedup semantics, queue ordering.
 * Spec §Concurrency guards, §Presentation layer (hooks/stores).
 */

import { useCelebrationStore } from './celebrationStore';

describe('celebrationStore', () => {
  beforeEach(() => {
    // Reset Zustand state between tests
    useCelebrationStore.setState({
      queue: [],
      _checker: null,
    });
  });

  describe('enqueue — dedup by stepNumber already in queue', () => {
    it('adds the first enqueue for a step', async () => {
      useCelebrationStore.getState().init(async () => false);
      await useCelebrationStore.getState().enqueue(1);
      expect(useCelebrationStore.getState().queue).toHaveLength(1);
      expect(useCelebrationStore.getState().queue[0].stepNumber).toBe(1);
    });

    it('drops a duplicate stepNumber already in queue (rule a)', async () => {
      useCelebrationStore.getState().init(async () => false);
      await useCelebrationStore.getState().enqueue(2);
      await useCelebrationStore.getState().enqueue(2);
      expect(useCelebrationStore.getState().queue).toHaveLength(1);
    });

    it('allows different step numbers', async () => {
      useCelebrationStore.getState().init(async () => false);
      await useCelebrationStore.getState().enqueue(1);
      await useCelebrationStore.getState().enqueue(2);
      expect(useCelebrationStore.getState().queue).toHaveLength(2);
    });
  });

  describe('enqueue — dedup by persisted celebrated_at (rule b)', () => {
    it('drops enqueue when checker returns true (already celebrated)', async () => {
      useCelebrationStore.getState().init(async () => true);
      await useCelebrationStore.getState().enqueue(3);
      expect(useCelebrationStore.getState().queue).toHaveLength(0);
    });

    it('allows enqueue when checker returns false (not yet celebrated)', async () => {
      useCelebrationStore.getState().init(async () => false);
      await useCelebrationStore.getState().enqueue(3);
      expect(useCelebrationStore.getState().queue).toHaveLength(1);
    });

    it('checks each step independently via the checker', async () => {
      // Step 1 is already celebrated, step 2 is not
      const checker = jest.fn().mockImplementation(async (stepNumber: number) => stepNumber === 1);
      useCelebrationStore.getState().init(checker);
      await useCelebrationStore.getState().enqueue(1);
      await useCelebrationStore.getState().enqueue(2);
      expect(useCelebrationStore.getState().queue).toHaveLength(1);
      expect(useCelebrationStore.getState().queue[0].stepNumber).toBe(2);
    });
  });

  describe('queue ordering (FIFO)', () => {
    it('preserves insertion order', async () => {
      useCelebrationStore.getState().init(async () => false);
      await useCelebrationStore.getState().enqueue(1);
      await useCelebrationStore.getState().enqueue(3);
      await useCelebrationStore.getState().enqueue(6);
      const q = useCelebrationStore.getState().queue;
      expect(q.map((i) => i.stepNumber)).toEqual([1, 3, 6]);
    });
  });

  describe('dequeue', () => {
    it('returns null when queue is empty', () => {
      const item = useCelebrationStore.getState().dequeue();
      expect(item).toBeNull();
    });

    it('returns and removes head item', async () => {
      useCelebrationStore.getState().init(async () => false);
      await useCelebrationStore.getState().enqueue(1);
      await useCelebrationStore.getState().enqueue(2);
      const head = useCelebrationStore.getState().dequeue();
      expect(head?.stepNumber).toBe(1);
      expect(useCelebrationStore.getState().queue).toHaveLength(1);
      expect(useCelebrationStore.getState().queue[0].stepNumber).toBe(2);
    });
  });

  describe('clear', () => {
    it('empties the queue', async () => {
      useCelebrationStore.getState().init(async () => false);
      await useCelebrationStore.getState().enqueue(1);
      await useCelebrationStore.getState().enqueue(2);
      useCelebrationStore.getState().clear();
      expect(useCelebrationStore.getState().queue).toHaveLength(0);
    });
  });
});
