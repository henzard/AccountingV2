/**
 * syncRuntime — the registry that lets code outside App.tsx demand (and
 * await) a sync round.
 */

import {
  registerSyncRuntime,
  requestSyncNow,
  stopSyncRuntime,
  type SyncRuntime,
} from '../syncRuntime';

/** A registerable runtime whose `stop` is a recorded no-op unless overridden. */
function makeRuntime(overrides: Partial<SyncRuntime> = {}): SyncRuntime {
  return {
    requestSyncNow: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('syncRuntime', () => {
  afterEach(() => {
    registerSyncRuntime(null);
  });

  it('rejects with a clear error when no runtime is registered', async () => {
    await expect(requestSyncNow('hh-1')).rejects.toThrow(/no sync runtime registered/);
  });

  it('forwards the household id to the registered runtime', async () => {
    const runtime = makeRuntime();
    registerSyncRuntime(runtime);

    await expect(requestSyncNow('hh-1')).resolves.toBeUndefined();
    expect(runtime.requestSyncNow).toHaveBeenCalledWith('hh-1');
  });

  it('propagates the runtime rejection (e.g. a transport failure)', async () => {
    registerSyncRuntime(
      makeRuntime({
        requestSyncNow: jest.fn().mockRejectedValue(new Error('could not reach the server')),
      }),
    );

    await expect(requestSyncNow('hh-1')).rejects.toThrow('could not reach the server');
  });

  it('does not resolve before the round has completed', async () => {
    let finish: (() => void) | null = null;
    registerSyncRuntime(
      makeRuntime({
        requestSyncNow: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      }),
    );

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
    registerSyncRuntime(makeRuntime());
    registerSyncRuntime(null);

    await expect(requestSyncNow('hh-1')).rejects.toThrow(/no sync runtime registered/);
  });

  it('a re-registered runtime replaces the previous one', async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    registerSyncRuntime(first);
    registerSyncRuntime(second);

    await requestSyncNow('hh-2');

    expect(first.requestSyncNow).not.toHaveBeenCalled();
    expect(second.requestSyncNow).toHaveBeenCalledWith('hh-2');
  });

  it('stopSyncRuntime awaits the runtime stop and then clears the registration', async () => {
    let finishStop: (() => void) | null = null;
    const runtime = makeRuntime({
      stop: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishStop = resolve;
          }),
      ),
    });
    registerSyncRuntime(runtime);

    let stopped = false;
    const pending = stopSyncRuntime().then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(runtime.stop).toHaveBeenCalled();
    expect(stopped).toBe(false);

    finishStop!();
    await pending;
    expect(stopped).toBe(true);
    await expect(requestSyncNow('hh-1')).rejects.toThrow(/no sync runtime registered/);
  });

  it('stopSyncRuntime is a resolved no-op when nothing is registered', async () => {
    await expect(stopSyncRuntime()).resolves.toBeUndefined();
  });
});
