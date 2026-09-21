// src/infrastructure/monitoring/syncHealthReporter.ts
//
// WHY THIS EXISTS. A household's phone sat with its sync puller BLOCKED for
// two months and nobody knew — the only signal was one screen deep in
// Settings (SyncHealthScreen). This module evaluates the SAME diagnostic
// surface `SyncEngine` already exposes (`getPullHealth`, `listDeadLettered`,
// `getPendingPushCount`) automatically, in the background, after every sync
// attempt, and reports a Crashlytics non-fatal when it is failing — so the
// signal reaches the developer even when nobody opens that screen.
//
// CONDITION 3 ("ops pending >24h while online"): uses
// `SyncEngine.getOldestPendingCreatedAt()` (the oldest unpushed, non
// dead-lettered op's `client_created_at`) for the real age when the engine
// exposes it. That method is OPTIONAL on `SyncHealthEngine` on purpose: an
// older engine / a test double that doesn't implement it yet degrades to a
// device-local approximation instead of throwing — this module then tracks,
// in AsyncStorage, the first moment it observed a non-zero pending count and
// treats that as the pending queue's start time (resets across
// app updates/reinstalls, undercounts if the queue was already stale before
// this reporter first ran, but never crashes on a missing method). When the
// method IS present but returns `null` or an unparseable value, that is
// treated as "no stale ops" (never falls back to the approximation) — see
// `runEvaluation`'s `oldestPendingH` computation below.
//
// PRIVACY (§7.4-style discipline, matching SyncEngine's own PullHealth/
// DeadLetteredOp doc comments): never send amounts, payees, names, emails,
// invite codes, or op payloads. Op ids are random UUIDs and are fine.
// Household/user identifiers are NOT attached here beyond whatever the
// existing Crashlytics wrapper already attaches via `initCrashlytics`'s
// `setUserId` call — this module never adds a new raw identifier.
//
// SAFETY: every exported entry point is fire-and-forget and swallows every
// error internally (AsyncStorage and Crashlytics calls included) — this must
// never throw into, or block, the sync loop it observes. It is also a silent
// no-op wherever Crashlytics itself is a no-op (web/tests/dev — see
// `web-shims/rnfirebase-crashlytics.js` and the jest manual mock), because it
// only ever calls through the same `@react-native-firebase/crashlytics`
// entry point + the existing `recordError`/`log` wrapper (crashlytics.ts)
// that already resolve to those no-op shims there.
//
// DEDUPE: the same problem must not be reported on every sync round. Each of
// the three conditions below persists its own "last reported signature +
// time" record in AsyncStorage (already a dependency elsewhere in this
// codebase — see membershipCheckSchedule.ts for the same device-local-flag
// pattern) and reports again only when the signature changes (immediately)
// or the dedupe window has elapsed. When a condition clears, a "recovered"
// breadcrumb/log (not a non-fatal) is recorded and the stored signature is
// deleted, so a recurrence reports again right away.

import AsyncStorage from '@react-native-async-storage/async-storage';
// Same direct import crashlytics.ts itself uses; needed here to set
// PERSISTENT custom keys ("latest state on every evaluation") independently
// of raising a non-fatal, which `recordError`'s one-shot `context` param
// cannot do.
import crashlytics from '@react-native-firebase/crashlytics';
import { logger } from '../logging/Logger';
import { recordError, log } from './crashlytics';
import type { DeadLetteredOp, PullHealth } from '../../data/sync/SyncEngine';
import type { SyncStatusSink } from '../../data/sync/SyncScheduler';

/** Minimal read-only slice of `SyncEngine` (via `SyncRunner`) this module
 * needs. Kept as a narrow structural interface (not an import of
 * `SyncRunner`) so this stays a small, dependency-free leaf module. */
export interface SyncHealthEngine {
  getPullHealth(householdId: string): PullHealth;
  listDeadLettered(householdId: string): DeadLetteredOp[];
  getPendingPushCount(): number;
  /** Optional — an older engine (or a test double) without this method
   * structurally still satisfies `SyncHealthEngine`; `runEvaluation` falls
   * back to a first-observed approximation rather than throwing when it's
   * absent. When present, the oldest unpushed op's ISO `client_created_at`,
   * or `null` when nothing is pending. */
  getOldestPendingCreatedAt?(): string | null;
}

export interface EvaluateSyncHealthParams {
  engine: SyncHealthEngine;
  householdId: string;
  /** Whether the device currently has connectivity — the third condition
   * (pending ops stale) only fires while online, since offline pending ops
   * are expected, not a health problem. */
  isOnline: boolean;
  /** Injected clock (ms since epoch) for deterministic tests — defaults to
   * `Date.now`. */
  now?: () => number;
}

const KEY_PREFIX = '@sync_health:';
const PULL_BLOCKED_KEY = `${KEY_PREFIX}pull_blocked`;
const DLQ_KEY = `${KEY_PREFIX}dlq`;
const PENDING_STALE_KEY = `${KEY_PREFIX}pending_stale`;
const PENDING_FIRST_SEEN_KEY = `${KEY_PREFIX}pending_first_seen`;

/** Report the same problem signature at most once per install per this
 * window; a NEW signature reports immediately regardless of the window. */
export const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Condition 3's threshold — see the module doc comment above for how
 * "pending" age is computed (real engine timestamp, or an approximation
 * fallback for an engine that doesn't expose one). */
export const PENDING_STALE_HOURS = 24;

interface DedupeRecord {
  signature: string;
  reportedAtMs: number;
}

function isDedupeRecord(value: unknown): value is DedupeRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DedupeRecord).signature === 'string' &&
    typeof (value as DedupeRecord).reportedAtMs === 'number'
  );
}

async function readRecord(key: string): Promise<DedupeRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDedupeRecord(parsed) ? parsed : null;
  } catch (err) {
    logger.warn('syncHealthReporter: could not read dedupe record', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function writeRecord(key: string, record: DedupeRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(record));
  } catch (err) {
    logger.warn('syncHealthReporter: could not persist dedupe record', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function clearRecord(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (err) {
    logger.warn('syncHealthReporter: could not clear dedupe record', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function readFirstSeenMs(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_FIRST_SEEN_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (err) {
    logger.warn('syncHealthReporter: could not read pending first-seen timestamp', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function writeFirstSeenMs(ms: number): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_FIRST_SEEN_KEY, String(ms));
  } catch (err) {
    logger.warn('syncHealthReporter: could not persist pending first-seen timestamp', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function clearFirstSeenMs(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_FIRST_SEEN_KEY);
  } catch (err) {
    logger.warn('syncHealthReporter: could not clear pending first-seen timestamp', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Best-effort — mirrors how `crashlytics.ts` itself never awaits/guards
 * `setAttribute`'s promise; wrapped in try/catch here anyway (SAFETY: this
 * module must never throw regardless of the wrapper's own behavior). */
function setCustomKeys(state: {
  pullBlocked: boolean;
  dlqCount: number;
  pendingCount: number;
  oldestPendingH: number;
}): void {
  try {
    const instance = crashlytics();
    void Promise.resolve(
      instance.setAttribute('sync_pull_blocked', String(state.pullBlocked)),
    ).catch(() => {});
    void Promise.resolve(instance.setAttribute('sync_dlq_count', String(state.dlqCount))).catch(
      () => {},
    );
    void Promise.resolve(
      instance.setAttribute('sync_pending_count', String(state.pendingCount)),
    ).catch(() => {});
    void Promise.resolve(
      instance.setAttribute('sync_oldest_pending_h', String(state.oldestPendingH)),
    ).catch(() => {});
  } catch (err) {
    logger.warn('syncHealthReporter: setCustomKeys failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function reportNonFatal(message: string, context: Record<string, string | number | boolean>): void {
  try {
    recordError(new Error(message), context);
  } catch (err) {
    logger.warn('syncHealthReporter: recordError failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function logRecovery(message: string): void {
  try {
    log(message);
  } catch (err) {
    logger.warn('syncHealthReporter: recovery log failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

interface EvaluateConditionParams {
  key: string;
  now: number;
  active: boolean;
  signature: string;
  message: string;
  context: Record<string, string | number | boolean>;
  recoveredMessage: string;
}

/** One condition's dedupe/report/recover cycle — shared by all three checks. */
async function evaluateCondition(params: EvaluateConditionParams): Promise<void> {
  const stored = await readRecord(params.key);
  if (params.active) {
    const isNewSignature = !stored || stored.signature !== params.signature;
    const windowElapsed = !!stored && params.now - stored.reportedAtMs >= DEDUPE_WINDOW_MS;
    if (isNewSignature || windowElapsed) {
      reportNonFatal(params.message, params.context);
      await writeRecord(params.key, { signature: params.signature, reportedAtMs: params.now });
    }
  } else if (stored) {
    logRecovery(params.recoveredMessage);
    await clearRecord(params.key);
  }
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

/**
 * How many whole hours has the oldest pending op been sitting unpushed?
 *
 * Prefers the real answer from `engine.getOldestPendingCreatedAt()` when the
 * engine implements it: `null`/an unparseable timestamp there is treated as
 * "no stale ops" (0h) — NEVER falls back to the approximation below, since
 * the engine has actively told us there's nothing to be stale.
 *
 * Falls back to a first-observed approximation (persisted in AsyncStorage)
 * only when the method is structurally absent (an older engine / a test
 * double that hasn't implemented it yet) — this keeps `SyncHealthEngine` a
 * safe, non-throwing structural interface across engine versions.
 */
async function computeOldestPendingH(
  engine: SyncHealthEngine,
  pendingCount: number,
  now: number,
): Promise<number> {
  if (typeof engine.getOldestPendingCreatedAt === 'function') {
    let oldestIso: string | null = null;
    try {
      oldestIso = engine.getOldestPendingCreatedAt();
    } catch (err) {
      logger.warn('syncHealthReporter: getOldestPendingCreatedAt failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      oldestIso = null;
    }
    if (oldestIso === null) return 0;
    const parsedMs = Date.parse(oldestIso);
    if (!Number.isFinite(parsedMs)) return 0;
    return Math.max(0, Math.floor((now - parsedMs) / (60 * 60 * 1000)));
  }

  // Fallback approximation for an engine without `getOldestPendingCreatedAt`
  // — see the module doc comment's CONDITION 3 note.
  let firstSeenAtMs = await readFirstSeenMs();
  if (pendingCount > 0) {
    if (firstSeenAtMs === null) {
      firstSeenAtMs = now;
      await writeFirstSeenMs(now);
    }
  } else if (firstSeenAtMs !== null) {
    await clearFirstSeenMs();
    firstSeenAtMs = null;
  }
  return pendingCount > 0 && firstSeenAtMs !== null
    ? Math.floor((now - firstSeenAtMs) / (60 * 60 * 1000))
    : 0;
}

async function runEvaluation(params: EvaluateSyncHealthParams): Promise<void> {
  const now = (params.now ?? Date.now)();
  const { engine, householdId, isOnline } = params;

  let pullHealth: PullHealth = { blocked: false };
  try {
    pullHealth = engine.getPullHealth(householdId);
  } catch (err) {
    logger.warn('syncHealthReporter: getPullHealth failed', {
      householdId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let deadLettered: DeadLetteredOp[] = [];
  try {
    deadLettered = engine.listDeadLettered(householdId);
  } catch (err) {
    logger.warn('syncHealthReporter: listDeadLettered failed', {
      householdId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let pendingCount = 0;
  try {
    pendingCount = engine.getPendingPushCount();
  } catch (err) {
    logger.warn('syncHealthReporter: getPendingPushCount failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const oldestPendingH = await computeOldestPendingH(engine, pendingCount, now);

  // Custom keys reflect the latest state on EVERY evaluation, whether or not
  // any condition below actually reports — so any UNRELATED crash from this
  // phone also shows its sync health.
  setCustomKeys({
    pullBlocked: pullHealth.blocked,
    dlqCount: deadLettered.length,
    pendingCount,
    oldestPendingH,
  });

  const dlqTables = sortedUnique(deadLettered.map((d) => d.table));
  const sortedOpIds = sortedUnique(pullHealth.opIds ?? []);

  await evaluateCondition({
    key: PULL_BLOCKED_KEY,
    now,
    active: pullHealth.blocked,
    signature: `blocked:${sortedOpIds.join(',')}`,
    message: 'sync-health: pull blocked on a poison batch',
    context: {
      kind: 'pull_blocked',
      opIds: sortedOpIds.join(','),
      error: pullHealth.error ?? '',
    },
    recoveredMessage: 'sync-health: pull_blocked recovered',
  });

  await evaluateCondition({
    key: DLQ_KEY,
    now,
    active: deadLettered.length > 0,
    signature: `dlq:${deadLettered.length}:${dlqTables.join(',')}`,
    message: 'sync-health: dead-lettered ops present',
    context: {
      kind: 'dlq',
      count: deadLettered.length,
      tables: dlqTables.join(','),
    },
    recoveredMessage: 'sync-health: dlq recovered',
  });

  const pendingStaleActive = isOnline && pendingCount > 0 && oldestPendingH >= PENDING_STALE_HOURS;
  await evaluateCondition({
    key: PENDING_STALE_KEY,
    now,
    active: pendingStaleActive,
    signature: `pending:${pendingCount}`,
    message: 'sync-health: ops pending unusually long',
    context: {
      kind: 'pending_stale',
      count: pendingCount,
      oldestPendingH,
    },
    recoveredMessage: 'sync-health: pending_stale recovered',
  });
}

/**
 * Evaluates sync health and reports any failing condition to Crashlytics.
 * Fire-and-forget by design (returns `void`, not a `Promise`) — callers on
 * the sync loop (e.g. a `SyncStatusSink` wrapper) must never await this or
 * let it block/throw into a sync round. Every internal step already guards
 * itself; this outer catch is belt-and-braces.
 */
export function evaluateSyncHealth(params: EvaluateSyncHealthParams): void {
  void runEvaluation(params).catch((err: unknown) => {
    try {
      logger.warn('syncHealthReporter: evaluation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // Never let a logging failure escape either.
    }
  });
}

export interface SyncHealthReportingOptions {
  engine: SyncHealthEngine;
  /** Resolves the CURRENTLY active household at call time — `null` (no
   * active household yet, e.g. mid sign-out) is a no-op. */
  getHouseholdId: () => string | null;
  isOnline: () => boolean;
  now?: () => number;
}

/**
 * Wraps a `SyncStatusSink` so every completed sync round also triggers a
 * background sync-health evaluation, without adding a new callback to
 * `SyncScheduler`. `setPullBlocked` is the hook: `SyncScheduler.runSyncRound`
 * calls it (via `refreshDiagnostics`) from its `finally` block on EVERY
 * attempt — success, transport failure, AND a blocked pull (which does not
 * count as `onSyncSuccess`) — so wrapping it, rather than `onSyncSuccess`,
 * is what guarantees the blocked case actually reaches this reporter.
 *
 * The wrapped sink still calls straight through to `base` first — this must
 * never change what the UI (syncStore) sees.
 */
export function withSyncHealthReporting(
  base: SyncStatusSink,
  options: SyncHealthReportingOptions,
): SyncStatusSink {
  return {
    ...base,
    setPullBlocked: (blocked: boolean) => {
      base.setPullBlocked(blocked);
      const householdId = options.getHouseholdId();
      if (!householdId) return;
      evaluateSyncHealth({
        engine: options.engine,
        householdId,
        isOnline: options.isOnline(),
        now: options.now,
      });
    },
  };
}
