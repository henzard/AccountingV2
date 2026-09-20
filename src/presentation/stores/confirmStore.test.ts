/**
 * Tests for confirmStore — the promise-based confirm() dialog's backing
 * store (UX-6). Mirrors toastStore.test.ts's structure.
 */
import { useConfirmStore } from './confirmStore';

describe('confirmStore', () => {
  beforeEach(() => {
    useConfirmStore.setState({ request: null });
  });

  it('has no pending request initially', () => {
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it('requestConfirm sets a pending request with the given options', () => {
    void useConfirmStore
      .getState()
      .requestConfirm({ title: 'Sign out?', message: 'Are you sure?' });
    const { request } = useConfirmStore.getState();
    expect(request).not.toBeNull();
    expect(request?.title).toBe('Sign out?');
    expect(request?.message).toBe('Are you sure?');
    expect(request?.id).toBeTruthy();
  });

  it('resolveConfirm(true) resolves the pending promise with true and clears the request', async () => {
    const promise = useConfirmStore.getState().requestConfirm({ title: 't', message: 'm' });
    expect(useConfirmStore.getState().request).not.toBeNull();

    useConfirmStore.getState().resolveConfirm(true);

    await expect(promise).resolves.toBe(true);
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it('resolveConfirm(false) resolves the pending promise with false', async () => {
    const promise = useConfirmStore.getState().requestConfirm({ title: 't', message: 'm' });
    useConfirmStore.getState().resolveConfirm(false);
    await expect(promise).resolves.toBe(false);
  });

  it('resolveConfirm with no pending request does not throw', () => {
    expect(() => useConfirmStore.getState().resolveConfirm(true)).not.toThrow();
  });

  it('a second requestConfirm before the first resolves cancels the first as false', async () => {
    const first = useConfirmStore.getState().requestConfirm({ title: 'first', message: 'm' });
    const second = useConfirmStore.getState().requestConfirm({ title: 'second', message: 'm' });

    await expect(first).resolves.toBe(false);
    expect(useConfirmStore.getState().request?.title).toBe('second');

    useConfirmStore.getState().resolveConfirm(true);
    await expect(second).resolves.toBe(true);
  });

  it('each request gets a unique id', () => {
    void useConfirmStore.getState().requestConfirm({ title: 'a', message: 'm' });
    const id1 = useConfirmStore.getState().request?.id;
    useConfirmStore.getState().resolveConfirm(false);

    void useConfirmStore.getState().requestConfirm({ title: 'b', message: 'm' });
    const id2 = useConfirmStore.getState().request?.id;

    expect(id1).not.toBe(id2);
  });
});
