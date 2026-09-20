/**
 * syncWrite — process-wide write attribution (SYNC-1).
 *
 * The device id stamped on an oplog op is what `SyncEngine` compares against
 * to decide whether a pulled `increment` is its OWN (already folded into
 * local state) or a remote one to apply. A write attributed to the legacy
 * placeholder while the engine runs with the real installed id is therefore a
 * money bug, not a cosmetic one — hence the boot-installed defaults and the
 * production-build refusal tested here.
 */

import {
  UNASSIGNED_DEVICE_ID,
  clearSyncWriteDefaults,
  getSyncWriteDefaults,
  resolveSyncedRepoCtx,
  setSyncWriteDefaults,
} from '../syncWrite';

describe('syncWrite defaults', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    clearSyncWriteDefaults();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('resolves the boot-installed device id and actor', () => {
    setSyncWriteDefaults({ deviceId: 'device-A', actorUserId: 'user-1' });

    const ctx = resolveSyncedRepoCtx({});

    expect(ctx.deviceId).toBe('device-A');
    expect(ctx.actorUserId).toBe('user-1');
  });

  it('setting the actor does not clear the device id (and vice versa)', () => {
    setSyncWriteDefaults({ deviceId: 'device-A', actorUserId: 'user-1' });
    setSyncWriteDefaults({ actorUserId: null });

    expect(getSyncWriteDefaults()).toEqual({ deviceId: 'device-A', actorUserId: null });
    expect(resolveSyncedRepoCtx({}).deviceId).toBe('device-A');
  });

  it('a per-call override still wins over the installed default', () => {
    setSyncWriteDefaults({ deviceId: 'device-A', actorUserId: 'user-1' });

    const ctx = resolveSyncedRepoCtx({ deviceId: 'device-B', actorUserId: 'user-2' });

    expect(ctx).toMatchObject({ deviceId: 'device-B', actorUserId: 'user-2' });
  });

  it('an explicit null actor override is honoured, not treated as "unset"', () => {
    setSyncWriteDefaults({ deviceId: 'device-A', actorUserId: 'user-1' });

    expect(resolveSyncedRepoCtx({ actorUserId: null }).actorUserId).toBeNull();
  });

  it('falls back to the legacy placeholder under jest so existing unit tests keep working', () => {
    expect(resolveSyncedRepoCtx({}).deviceId).toBe(UNASSIGNED_DEVICE_ID);
  });

  it('REFUSES to write in a production build with no device id installed', () => {
    process.env.NODE_ENV = 'production';

    expect(() => resolveSyncedRepoCtx({})).toThrow(/no deviceId/);
  });

  it('does not refuse once boot has installed the device id', () => {
    process.env.NODE_ENV = 'production';
    setSyncWriteDefaults({ deviceId: 'device-A' });

    expect(resolveSyncedRepoCtx({}).deviceId).toBe('device-A');
  });
});
