/**
 * syncRuntime — the registry that lets code outside App.tsx demand (and
 * await) a sync round.
 */

import { registerSyncRuntime, requestSyncNow, type SyncRuntime } from '../syncRuntime';

describe('syncRuntime', () => {
  afterEach(() => {
    registerSyncRuntime(null);
  });

  it('rejects with a clear error when no runtime is registered', async () => {
    await expect(requestSyncNow('hh-1')).rejects.toThrow(/no sync runtime registered/);
  });

  it('forwards the household id to the registered runtime', async () => {
    const runtime: SyncRuntime = { requestSyncNow: jest.fn().mockResolvedValue(undefined) };
    registerSyncRuntime(runtime);

    await expect(requestSyncNow('hh-1')).resolves.toBeUndefined();
    expect(runtime.requestSyncNow).toHaveBeenCalledWith('hh-1');
  });

  it('propagates the runtime rejection (e.g. a transport failure)', async () => {
    registerSyncRuntime({
      requestSyncNow: jest.fn().mockRejectedValue(new Error('could not reach the server')),
    });

    await expect(requestSyncNow('hh-1')).rejects.toThrow('could not reach the server');
  });

  it('does not resolve before the round has completed', async () => {
    let finish: (() => void) | null = null;
    registerSyncRuntime({
      requestSyncNow: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });

    let settled = false;
    const pending = requestSyncNow('hh-1').then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    finish!();
    await pending;
    expect(settled).toBe(true);
  });

  it('registering null makes a later call reject again (sign-out)', async () => {
    registerSyncRuntime({ requestSyncNow: jest.fn().mockResolvedValue(undefined) });
    registerSyncRuntime(null);

    await expect(requestSyncNow('hh-1')).rejects.toThrow(/no sync runtime registered/);
  });

  it('a re-registered runtime replaces the previous one', async () => {
    const first: SyncRuntime = { requestSyncNow: jest.fn().mockResolvedValue(undefined) };
    const second: SyncRuntime = { requestSyncNow: jest.fn().mockResolvedValue(undefined) };
    registerSyncRuntime(first);
    registerSyncRuntime(second);

    await requestSyncNow('hh-2');

    expect(first.requestSyncNow).not.toHaveBeenCalled();
    expect(second.requestSyncNow).toHaveBeenCalledWith('hh-2');
  });
});
