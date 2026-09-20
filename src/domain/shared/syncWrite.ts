import { createSyncedRepo } from '../../data/uow/createSyncedRepo';
import type { SyncedRepo, SyncedRepoCtx } from '../../data/uow/createSyncedRepo';
import type { PortableDb } from '../../data/uow/UnitOfWork';

/**
 * The attribution a synced write carried before the composition root supplied
 * a real device id. NOTHING writes this any more — `setSyncWriteDefaults` is
 * called during boot (App.tsx) before any write can happen, and
 * `resolveSyncedRepoCtx` refuses to fall back to it outside tests.
 *
 * It is still exported (and still recognised by `SyncEngine`'s own-op skip)
 * because ops written by SHIPPED builds were pushed to the server under this
 * device id: after the upgrade, pulling those ops back must not re-apply this
 * device's own increments (money double-count). See
 * `SyncEngine.isOwnIncrement`.
 */
export const UNASSIGNED_DEVICE_ID = 'unassigned-device';

/**
 * Process-wide attribution for every synced write, set once during boot.
 *
 * `deviceId` MUST match the id the `SyncEngine` was built with
 * (`infrastructure/device/deviceId.ts`), because the puller identifies this
 * device's OWN `increment` ops by comparing the op's `device_id` to the
 * engine's. When they disagree, the puller re-applies increments this device
 * already folded into local state — a payment counted twice (the SYNC-1
 * money-corruption bug).
 */
interface SyncWriteDefaults {
  deviceId: string | null;
  actorUserId: string | null;
}

const defaults: SyncWriteDefaults = { deviceId: null, actorUserId: null };

/**
 * Sets the process-wide write attribution. Called from the composition root
 * (App.tsx): `deviceId` once on the local boot gate, before first paint and
 * therefore before any use case can write; `actorUserId` on every auth change
 * (and `null` on sign-out).
 *
 * Only the keys present are changed, so setting the actor never clears the
 * device id and vice versa.
 */
export function setSyncWriteDefaults(next: {
  deviceId?: string;
  actorUserId?: string | null;
}): void {
  if (next.deviceId !== undefined) defaults.deviceId = next.deviceId;
  if (next.actorUserId !== undefined) defaults.actorUserId = next.actorUserId;
}

/** Clears both defaults. Used by tests; production only ever clears the actor. */
export function clearSyncWriteDefaults(): void {
  defaults.deviceId = null;
  defaults.actorUserId = null;
}

/** The currently installed defaults (read-only copy) — for diagnostics/tests. */
export function getSyncWriteDefaults(): Readonly<SyncWriteDefaults> {
  return { ...defaults };
}

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

/**
 * Resolves the `SyncedRepoCtx` passed to every `SyncedRepo` write.
 *
 * Precedence: the per-call override, then the boot-installed default. A
 * production build with neither THROWS rather than silently attributing the
 * write to `UNASSIGNED_DEVICE_ID` — that silent fallback is what let a
 * device's own increments be pulled back and double-counted. Under jest
 * (`NODE_ENV === 'test'`) the legacy placeholder is still used so the many
 * unit tests that construct use cases with bare `{}` deps keep working.
 */
export function resolveSyncedRepoCtx(deps: SyncWriteDeps): SyncedRepoCtx {
  const deviceId = deps.deviceId ?? defaults.deviceId ?? resolveFallbackDeviceId();
  return {
    deviceId,
    actorUserId: deps.actorUserId !== undefined ? deps.actorUserId : defaults.actorUserId,
    clock: deps.clock ?? ((): string => new Date().toISOString()),
    genId: deps.genId,
  };
}

function resolveFallbackDeviceId(): string {
  if (process.env.NODE_ENV === 'test') return UNASSIGNED_DEVICE_ID;
  throw new Error(
    'resolveSyncedRepoCtx: no deviceId — setSyncWriteDefaults({ deviceId }) must run during boot ' +
      'before any synced write (see App.tsx). Refusing to attribute this write to a placeholder ' +
      'device, which would make the puller re-apply this device’s own increments.',
  );
}
