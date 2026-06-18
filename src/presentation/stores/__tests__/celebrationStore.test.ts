import { useCelebrationStore } from '../celebrationStore';

describe('celebrationStore', () => {
  beforeEach(() => {
    useCelebrationStore.setState({ queue: [], _checker: null });
  });

  it('defaults to empty queue', () => {
    expect(useCelebrationStore.getState().queue).toEqual([]);
  });

  it('init sets the checker', () => {
    const checker = jest.fn().mockResolvedValue(false);
    useCelebrationStore.getState().init(checker);
    expect(useCelebrationStore.getState()._checker).toBe(checker);
  });

  it('enqueue adds item to queue when not deduplicated', async () => {
    const checker = jest.fn().mockResolvedValue(false);
    useCelebrationStore.getState().init(checker);
    await useCelebrationStore.getState().enqueue(1);
    expect(useCelebrationStore.getState().queue).toHaveLength(1);
    expect(useCelebrationStore.getState().queue[0].stepNumber).toBe(1);
  });

  it('enqueue deduplicates by queue (same step already in queue)', async () => {
    const checker = jest.fn().mockResolvedValue(false);
    useCelebrationStore.getState().init(checker);
    await useCelebrationStore.getState().enqueue(2);
    await useCelebrationStore.getState().enqueue(2);
    expect(useCelebrationStore.getState().queue).toHaveLength(1);
  });

  it('enqueue deduplicates by celebrated_at checker', async () => {
    const checker = jest.fn().mockResolvedValue(true);
    useCelebrationStore.getState().init(checker);
    await useCelebrationStore.getState().enqueue(3);
    expect(useCelebrationStore.getState().queue).toHaveLength(0);
  });

  it('enqueue works without checker (no init)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await useCelebrationStore.getState().enqueue(1);
    expect(useCelebrationStore.getState().queue).toHaveLength(1);
    (console.warn as jest.Mock).mockRestore();
  });

  it('dequeue removes and returns head', async () => {
    const checker = jest.fn().mockResolvedValue(false);
    useCelebrationStore.getState().init(checker);
    await useCelebrationStore.getState().enqueue(1);
    await useCelebrationStore.getState().enqueue(2);
    const head = useCelebrationStore.getState().dequeue();
    expect(head?.stepNumber).toBe(1);
    expect(useCelebrationStore.getState().queue).toHaveLength(1);
  });

  it('dequeue returns null when queue is empty', () => {
    expect(useCelebrationStore.getState().dequeue()).toBeNull();
  });

  it('clear empties the queue', async () => {
    const checker = jest.fn().mockResolvedValue(false);
    useCelebrationStore.getState().init(checker);
    await useCelebrationStore.getState().enqueue(1);
    useCelebrationStore.getState().clear();
    expect(useCelebrationStore.getState().queue).toEqual([]);
  });
});
