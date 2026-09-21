/**
 * pendingHouseholdPurge — the durable "this user asked to leave, the phone
 * still owes them a purge" marker, and the boot-time resume that pays it off.
 *
 * THE GAP IT CLOSES. `LeaveHouseholdUseCase` runs: sync and prove it → soft
 * delete the own membership row and push that op → purge the household's
 * local data in one transaction. If the process dies AFTER the leave op has
 * been pushed but BEFORE the purge commits (kill, crash, flat battery), the
 * household's transactions, envelopes and debts stay on this phone forever:
 * the user is no longer a member, so the household is gone from every list
 * and no screen is left to retry from — while they were explicitly promised
 * the data would be removed from this device.
 *
 * WHY A MARKER AT ALL. A boot-time sweep over "tombstoned own membership"
 * cannot tell a VOLUNTARY LEAVE from an OWNER-REMOVAL: both leave exactly the
 * same tombstoned row, and an owner-removal must NOT destroy the data (see
 * `SyncEngine`'s eviction, which deliberately keeps the household's financial
 * rows so the ex-member can still read what they lived through). The only
 * thing that distinguishes them is the user's INTENT, so intent is what gets
 * recorded — before the leave op is written, and cleared only once the purge
 * has committed or the leave has demonstrably not happened.
 *
 * WHY ASYNCSTORAGE, NOT SQLITE. The marker has to survive a process kill, and
 * it has to survive the purge itself — a marker stored in the database the
 * purge empties could be destroyed in the same transaction it is supposed to
 * outlive, and a `households`-keyed row would be deleted by the purge's own
 * root delete. It must also never be SYNCED: it is per-device intent, and a
 * new synced column/table is forbidden while 1.1.130 devices are in the field
 * (they pull-block on an unknown column). A new LOCAL-only table would need a
 * local migration for a single key/value pair. AsyncStorage is already a
 * dependency, is process-kill durable, is never synced and is never touched
 * by the purge — and this mirrors the device-local flags already living in
 * `src/infrastructure/storage/onboardingFlag.ts` and
 * `src/data/sync/membershipCheckSchedule.ts`.
 *
 * ONE KEY PER USER *AND* HOUSEHOLD (`@pending_household_purge:<userId>:<householdId>`):
 *   - a shared phone cannot resume the OTHER person's leave — enumeration is
 *     filtered by this user's own colon-terminated prefix, so another user's
 *     keys are never read and never removed;
 *   - a user who is stuck in LEAVE_NOT_SYNCED limbo for household A and then
 *     leaves household B keeps BOTH debts. A single per-user key would have
 *     silently dropped A's.
 * An older build's single-household key (`@pending_household_purge:<userId>`)
 * is migrated to the new shape on first read and only then removed, so no
 * pending purge can be lost across the upgrade.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { sql } from 'drizzle-orm';
import type { PortableDb } from '../../data/uow/UnitOfWork';
import { logger } from '../../infrastructure/logging/Logger';
import type { ISlipImageLocalStore } from '../slipScanning/CleanupExpiredSlipsUseCase';
import type { Result } from '../shared/types';
import {
  PurgeLocalHouseholdDataUseCase,
  type PurgeLocalHouseholdDataOutcome,
} from './PurgeLocalHouseholdDataUseCase';

/** The recorded intent. `userId` is carried INSIDE the value as well as in
 * the key so a resume can refuse a value that does not belong to the
 * signed-in user, whatever wrote it. */
export interface PendingHouseholdPurge {
  householdId: string;
  userId: string;
  /** ISO timestamp of the moment the user confirmed leaving. */
  requestedAt: string;
}

/** A marker still waiting on un-pushed ops after this long is not going to
 * resolve on its own — something is wrong with this device's sync, and a
 * human needs to see it. Generous on purpose: a phone can be offline for
 * weeks, and the answer is never to purge blindly. */
export const PENDING_PURGE_STALE_MS = 30 * 24 * 60 * 60 * 1000;

const KEY_NAMESPACE = '@pending_household_purge';

function markerKey(userId: string, householdId: string): string {
  return `${KEY_NAMESPACE}:${userId}:${householdId}`;
}

/** Colon-terminated so a user id that is a PREFIX of another user's id
 * (`u` vs `u-other`) cannot match their keys. */
function markerKeyPrefix(userId: string): string {
  return `${KEY_NAMESPACE}:${userId}:`;
}

/** The shape written by the first build that shipped this marker: one key per
 * user, holding whichever household was last left. */
function legacyMarkerKey(userId: string): string {
  return `${KEY_NAMESPACE}:${userId}`;
}

/** Parses a stored value, rejecting anything that is not a well-formed marker
 * for `userId` — a marker is only ever allowed to CAUSE a purge, so anything
 * ambiguous reads as "no marker". */
function parseMarker(raw: string | null, userId: string): PendingHouseholdPurge | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const marker = parsed as Partial<PendingHouseholdPurge> | null;
  if (
    !marker ||
    typeof marker.householdId !== 'string' ||
    typeof marker.userId !== 'string' ||
    typeof marker.requestedAt !== 'string'
  ) {
    return null;
  }
  // A value written for somebody else (shared phone, or a key that somehow
  // outlived a user id) must never be acted on and must never be deleted.
  if (marker.userId !== userId) return null;
  return {
    householdId: marker.householdId,
    userId: marker.userId,
    requestedAt: marker.requestedAt,
  };
}

async function getMarker(key: string, userId: string): Promise<PendingHouseholdPurge | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (err) {
    logger.warn('pendingHouseholdPurge: could not read a marker', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  return parseMarker(raw, userId);
}

/**
 * Moves an older build's single-household marker onto its per-household key.
 *
 * The legacy key is removed ONLY after the new one has been written, so a
 * failure anywhere leaves the legacy key in place and the marker is still
 * returned to this boot — the purge it owes can never be lost by migrating.
 */
async function migrateLegacyMarker(userId: string): Promise<PendingHouseholdPurge | null> {
  const legacy = await getMarker(legacyMarkerKey(userId), userId);
  if (!legacy) return null;

  try {
    const key = markerKey(userId, legacy.householdId);
    const existing = await getMarker(key, userId);
    // An existing per-household marker is the authority (it may already carry
    // an older `requestedAt`); the legacy key is then simply redundant.
    if (!existing) await AsyncStorage.setItem(key, JSON.stringify(legacy));
    await AsyncStorage.removeItem(legacyMarkerKey(userId));
    return existing ?? legacy;
  } catch (err) {
    logger.warn('pendingHouseholdPurge: could not migrate the legacy marker — keeping it', {
      householdId: legacy.householdId,
      error: err instanceof Error ? err.message : String(err),
    });
    return legacy;
  }
}

/**
 * The marker for this user and household, or null when there is none.
 * Migrates a legacy single-household marker on the way past.
 */
export async function readPendingHouseholdPurge(
  userId: string,
  householdId: string,
): Promise<PendingHouseholdPurge | null> {
  await migrateLegacyMarker(userId);
  return getMarker(markerKey(userId, householdId), userId);
}

/**
 * Every household this phone still owes `userId` a purge for, oldest request
 * first. Reads ONLY keys under this user's own prefix, so a shared phone's
 * other accounts are neither read nor touched.
 */
export async function listPendingHouseholdPurges(userId: string): Promise<PendingHouseholdPurge[]> {
  const legacy = await migrateLegacyMarker(userId);

  let keys: readonly string[];
  try {
    keys = await AsyncStorage.getAllKeys();
  } catch (err) {
    logger.warn('pendingHouseholdPurge: could not list the markers', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const prefix = markerKeyPrefix(userId);
  const markers: PendingHouseholdPurge[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const marker = await getMarker(key, userId);
    // The key is the address; a value naming a DIFFERENT household than its
    // own key is corrupt, and purging the wrong household is the one mistake
    // this module may never make.
    if (marker && marker.householdId === key.slice(prefix.length)) markers.push(marker);
  }
  // A legacy marker whose rewrite FAILED is still under the old key, which
  // this enumeration cannot see — include it so the boot that found it can
  // still act on it, rather than losing a purge until storage recovers.
  if (legacy && !markers.some((m) => m.householdId === legacy.householdId)) markers.push(legacy);

  return markers.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/**
 * Records the intent to leave `householdId`, unless a marker for that
 * household is already there — a RESUMED leave attempt keeps its ORIGINAL
 * `requestedAt`, so the staleness report below measures how long the purge
 * has really been owed rather than restarting on every retry. A pending purge
 * for a DIFFERENT household has its own key and is left alone.
 *
 * Best-effort: a storage failure must not stop the user leaving. It only
 * costs the resume this marker would have driven — i.e. exactly today's
 * behaviour.
 */
export async function ensurePendingHouseholdPurge(
  userId: string,
  householdId: string,
  requestedAt: string = new Date().toISOString(),
): Promise<void> {
  const existing = await readPendingHouseholdPurge(userId, householdId);
  if (existing) return;

  const marker: PendingHouseholdPurge = { householdId, userId, requestedAt };
  try {
    await AsyncStorage.setItem(markerKey(userId, householdId), JSON.stringify(marker));
  } catch (err) {
    logger.warn('pendingHouseholdPurge: could not write the marker', {
      householdId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Drops this user's marker for one household. Best-effort for the same
 * reason as the write — a marker that survives one extra boot is re-evaluated
 * from the database, and every one of those outcomes is safe. */
export async function clearPendingHouseholdPurge(
  userId: string,
  householdId: string,
): Promise<void> {
  try {
    await AsyncStorage.removeItem(markerKey(userId, householdId));
    // A legacy key whose rewrite failed still names this household; the debt
    // is paid, so it goes too — otherwise the next boot would re-migrate it
    // and re-run a purge that has nothing left to delete.
    const legacy = await getMarker(legacyMarkerKey(userId), userId);
    if (legacy?.householdId === householdId) {
      await AsyncStorage.removeItem(legacyMarkerKey(userId));
    }
  } catch (err) {
    logger.warn('pendingHouseholdPurge: could not clear the marker', {
      householdId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** What the resume did for ONE household, for the tests and for logging. */
export type PendingPurgeResumeAction =
  /** The membership row is still ACTIVE: the leave never happened. */
  | 'membership-active'
  /** Tombstoned, but ops for that household are still only on this phone. */
  | 'waiting-for-sync'
  /** Tombstoned, nothing outstanding: the household was purged. */
  | 'purged'
  /** The purge ran and failed; the marker is kept so a later boot retries. */
  | 'purge-failed'
  /** Something threw for THIS household. Its marker is kept; the others still
   * get their turn, and boot is unaffected. */
  | 'failed';

export interface PendingPurgeResumeResult {
  householdId: string;
  action: PendingPurgeResumeAction;
}

export interface ResumePendingHouseholdPurgeDeps {
  db: PortableDb;
  /** The signed-in user. Only THEIR markers are ever read or written. */
  userId: string;
  /** Injection seam for the purge; production omits it. */
  purge?: (householdId: string) => Promise<Result<PurgeLocalHouseholdDataOutcome>>;
  /** Handed to the purge so the household's slip images leave the disk too. */
  slipImages?: ISlipImageLocalStore;
  /** `Date.now()` by default — the staleness check's clock. */
  nowMs?: number;
}

interface MembershipRow {
  active: number;
}

interface UnsyncedRow {
  unsynced: number;
}

/** Households already reported stale in THIS process, so the (once per boot)
 * `logger.error` cannot turn into a Crashlytics flood. */
const staleReported = new Set<string>();

/** Test-only reset for the module-level report guard. */
export function resetPendingPurgeStaleReports(): void {
  staleReported.clear();
}

/** One household's share of the resume. Throws nothing the caller has to
 * think about — every exit is a `PendingPurgeResumeAction`. */
async function resumeOne(
  deps: ResumePendingHouseholdPurgeDeps,
  marker: PendingHouseholdPurge,
): Promise<PendingPurgeResumeAction> {
  const { db, userId } = deps;
  const { householdId } = marker;

  // Deliberately scoped to this user AND this household: a resume must never
  // look at, or touch, any other household on this phone.
  const membership = db.get<MembershipRow>(sql`
    SELECT SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active
    FROM household_members
    WHERE household_id = ${householdId} AND user_id = ${userId}
  `);
  if ((membership?.active ?? 0) > 0) {
    // The process died before the soft delete committed, so the user is still
    // a member and still sees the household. A marker must never outlive a
    // leave that did not happen.
    await clearPendingHouseholdPurge(userId, householdId);
    return 'membership-active';
  }

  // Dead letters are excluded exactly as `LeaveHouseholdUseCase` excludes
  // them: the server has permanently refused them, so waiting is waiting
  // forever, and the user already agreed to discard them.
  const pending = db.get<UnsyncedRow>(sql`
    SELECT SUM(CASE WHEN pushed_at IS NULL AND dead_lettered_at IS NULL THEN 1 ELSE 0 END)
           AS unsynced
    FROM oplog
    WHERE household_id = ${householdId}
  `);
  if ((pending?.unsynced ?? 0) > 0) {
    const nowMs = deps.nowMs ?? Date.now();
    const requestedMs = Date.parse(marker.requestedAt);
    if (
      Number.isFinite(requestedMs) &&
      nowMs - requestedMs >= PENDING_PURGE_STALE_MS &&
      !staleReported.has(householdId)
    ) {
      staleReported.add(householdId);
      logger.error(
        'pendingHouseholdPurge: a leave has been waiting to finish for over 30 days',
        new Error('pending household purge is stale'),
        { householdId, requestedAt: marker.requestedAt, unsynced: pending?.unsynced ?? 0 },
      );
    }
    return 'waiting-for-sync';
  }

  const purge =
    deps.purge ??
    ((id: string): Promise<Result<PurgeLocalHouseholdDataOutcome>> =>
      new PurgeLocalHouseholdDataUseCase(
        db,
        { householdId: id },
        { slipImages: deps.slipImages },
      ).execute());

  const purged = await purge(householdId);
  if (!purged.success) {
    // The purge is one transaction, so the phone still holds every row. Keep
    // the marker: the next boot tries again.
    logger.warn('pendingHouseholdPurge: the resumed purge failed — keeping the marker', {
      householdId,
      code: purged.error.code,
    });
    return 'purge-failed';
  }

  await clearPendingHouseholdPurge(userId, householdId);
  logger.info('pendingHouseholdPurge: finished an interrupted leave', {
    householdId,
    purgedTables: purged.data.purgedTables.length,
  });
  return 'purged';
}

/**
 * Finishes every interrupted leave this user has pending. Called at boot once
 * the session is known and BEFORE `EnsureHouseholdUseCase` decides where the
 * user lands, so a household it purges is never the one they are dropped
 * into.
 *
 * Cheap and local: one key enumeration, then per household two small local
 * SQLite queries and — only in the case that actually owes a purge — one
 * transaction. It NEVER waits on the network (a leave that still has
 * un-pushed ops is deferred to a later boot, not synced here) and it never
 * rejects: a household that throws resolves as `'failed'` with its marker
 * left in place, and the remaining households still get their turn.
 *
 * The three cases, per household:
 *   (a) own membership row still ACTIVE → the leave never got written; the
 *       marker is cleared and NOTHING is deleted;
 *   (b) tombstoned but ops for that household are still un-pushed (and not
 *       dead-lettered) → do NOT purge, KEEP the marker, let a later boot
 *       finish once sync has drained. The pusher reaches those ops even
 *       though the household is no longer the active one: `fetchPushable`
 *       selects from `oplog` with NO household predicate (only `pushed_at IS
 *       NULL`, `dead_lettered_at IS NULL`, the backoff window and the stalled
 *       set), so any ordinary sync round drains them;
 *   (c) tombstoned with nothing outstanding → purge, then clear the marker.
 *
 * Returns one result per pending household (empty when there is nothing to
 * do, which includes every owner-removal — those never have a marker).
 */
export async function resumePendingHouseholdPurge(
  deps: ResumePendingHouseholdPurgeDeps,
): Promise<PendingPurgeResumeResult[]> {
  let markers: PendingHouseholdPurge[];
  try {
    markers = await listPendingHouseholdPurges(deps.userId);
  } catch (err) {
    logger.warn('pendingHouseholdPurge: resume could not read its markers', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const results: PendingPurgeResumeResult[] = [];
  for (const marker of markers) {
    try {
      results.push({ householdId: marker.householdId, action: await resumeOne(deps, marker) });
    } catch (err) {
      // Boot must not care, and one broken household must not strand the
      // others. The marker is untouched, so nothing is lost.
      logger.warn('pendingHouseholdPurge: resume failed for one household', {
        householdId: marker.householdId,
        error: err instanceof Error ? err.message : String(err),
      });
      results.push({ householdId: marker.householdId, action: 'failed' });
    }
  }
  return results;
}
