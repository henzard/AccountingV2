import { createSyncedRepo } from '../../data/uow/createSyncedRepo';
import type { SyncedRepo, SyncedRepoCtx } from '../../data/uow/createSyncedRepo';
import type { PortableDb } from '../../data/uow/UnitOfWork';

/**
 * Placeholder actor/device attribution for oplog rows written by the
 * envelope + transaction use cases (slice 3). Real session (`actorUserId`)
 * and installed-device (`deviceId`) values are not yet threaded from
 * presentation into these use cases — that lands with the composition-root
 * / session wiring in a later slice (see task-3-report.md). Until then,
 * writes are correctly atomic (entity write + oplog row in one SQLite
 * transaction via `createSyncedRepo`) but attributed to this placeholder
 * rather than a specific user/device. Grep this constant to find every call
 * site that still needs real attribution wired in.
 */
export const UNASSIGNED_DEVICE_ID = 'unassigned-device';

/**
 * Optional overrides for a use case's synced-repo write, injectable for
 * tests. `repo` lets a test supply a fake `SyncedRepo` (jest.fn() per
 * method) instead of hitting a real/mock Drizzle db. `clock`/`genId` are the
 * same per-call determinism seams `createSyncedRepo` already defines via
 * `SyncedRepoCtx` — passed straight through rather than wrapped in new
 * IClock/IIdGenerator port objects, since that would just re-box the same
 * two functions.
 */
export interface SyncWriteDeps {
  repo?: SyncedRepo;
  clock?: () => string;
  genId?: () => string;
  deviceId?: string;
  actorUserId?: string | null;
}

/** Resolves the `SyncedRepo` to write through: the injected fake in tests, or a real one over `db` in production. */
export function resolveSyncedRepo(
  db: PortableDb,
  tableName: string,
  deps: SyncWriteDeps,
): SyncedRepo {
  return deps.repo ?? createSyncedRepo(db, { tableName });
}

/** Resolves the `SyncedRepoCtx` passed to every `SyncedRepo` write. */
export function resolveSyncedRepoCtx(deps: SyncWriteDeps): SyncedRepoCtx {
  return {
    deviceId: deps.deviceId ?? UNASSIGNED_DEVICE_ID,
    actorUserId: deps.actorUserId ?? null,
    clock: deps.clock ?? ((): string => new Date().toISOString()),
    genId: deps.genId,
  };
}
