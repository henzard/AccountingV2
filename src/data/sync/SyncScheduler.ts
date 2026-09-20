// src/data/sync/SyncScheduler.ts
//
// Trigger/orchestration layer for the production SyncEngine (Task 3). Wires
// the spec's trigger list (§4, §6.7) that calls `engine.sync(householdId)`:
//
//   (a) debounced after-write  — fired by `onOplogWrite` (UnitOfWork.ts),
//       which every `createSyncedRepo` write goes through after it commits.
//       No domain/use-case call site needs to know about sync at all.
//   (b) AppState 'active'      — foreground.
//   (c) NetInfo reconnect      — via the injected `ReconnectSource`
//       (the app's `networkObserver` singleton satisfies this — see
//       infrastructure/network/NetworkObserver.ts, kept alive per Task 6).
//   (d) Supabase Realtime nudge — a `postgres_changes` INSERT on this
//       household's `oplog` rows (RLS-scoped by the `oplog_select` policy,
//       slice 2) triggers the SAME debounced `requestSync`, nothing more.
//
// CRITICAL (spec §6.7): Realtime is a NUDGE ONLY, never the sole trigger.
// (a)/(b)/(c) above are the actual guarantee — if the realtime channel never
// reaches SUBSCRIBED, or silently stops delivering after connecting, sync
// still happens on every foreground/reconnect/local-write event. This class
// deliberately treats channel subscribe failure/CLOSE/TIMED_OUT as a
// log-and-continue condition, never a thrown error — losing the nudge must
// never be able to take down the guarantee triggers.
//
// This is intentionally a THIN layer: it does not touch SyncEngine's
// push()/pull()/sync() core (Task 3) — it only decides WHEN to call
// `sync()`, keeping the engine itself pure and unit-testable against a fake
// transport (see SyncEngine.test.ts) independent of AppState/NetInfo/Realtime.
//
// NOT auto-started: Task 5 owns the App.tsx boot rework and decides when to
// call `.start()` (after the navigator mounts, per the "boot never blocks on
// network" rule) and `.stop()`/`.start()` again on household switch.

import type { AppStateStatus } from 'react-native';
import { AppState } from 'react-native';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { onOplogWrite } from '../uow/UnitOfWork';
import type { PullHealth, SyncSummary } from './SyncEngine';
import { logger } from '../../infrastructure/logging/Logger';

/** Minimal shape of `SyncEngine` this scheduler drives — an interface (not
 * the concrete class) so tests can inject a fake without a real SQLite db +
 * transport. The production `SyncEngine` satisfies this structurally. */
export interface SyncRunner {
  sync(householdId: string): Promise<SyncSummary>;
  getPullHealth(householdId: string): PullHealth;
  getPendingPushCount(): number;
}

/** Minimal shape of `NetworkObserver` this scheduler needs — the real
 * `networkObserver` singleton (infrastructure/network/NetworkObserver.ts)
 * satisfies this; tests can inject a bare `{ onConnected }` stub. Returning
 * an unsubscribe function is optional so an older stub stays valid, but the
 * real observer returns one and `stop()` calls it. */
export interface ReconnectSource {
  onConnected(callback: () => Promise<void>): (() => void) | void;
}

/** Status callbacks the scheduler reports live sync activity through.
 * Implemented by `syncStore`'s adapter (presentation layer) — kept as a port
 * here so this data-layer file never imports `presentation/*` (dependencies
 * still point inward: presentation depends on data, not the reverse). */
export interface SyncStatusSink {
  /** True for the duration of one `sync()` call. */
  setSyncing(isSyncing: boolean): void;
  /** Called once per successful `sync()` round with the completion time. */
  setLastSyncedAt(iso: string): void;
  /** Called after every `sync()` attempt (success or failure) with the
   * current unpushed-op count. */
  setPendingCount(count: number): void;
  /** `null` clears a previous error; non-null is the last sync failure's message. */
  setError(message: string | null): void;
  /** Mirrors `SyncEngine.getPullHealth(householdId).blocked` after every attempt. */
  setPullBlocked(blocked: boolean): void;
}

/** No-op sink — used when the caller doesn't wire live status (most tests;
 * also a safe default so a missing `statusSink` never crashes the scheduler). */
export const NULL_SYNC_STATUS_SINK: SyncStatusSink = {
  setSyncing: () => {},
  setLastSyncedAt: () => {},
  setPendingCount: () => {},
  setError: () => {},
  setPullBlocked: () => {},
};

/** What one `runSync` call produced: the round's summary, plus the error it
 * threw with (already logged + reported to the status sink) when it did. */
interface SyncRoundOutcome {
  summary: SyncSummary;
  error?: Error;
}

export interface SyncSchedulerDeps {
  engine: SyncRunner;
  supabase: SupabaseClient;
  /** Reconnect trigger source — pass the app's `networkObserver` singleton. */
  networkObserver: ReconnectSource;
  statusSink?: SyncStatusSink;
  /** Debounce window for after-write / realtime-nudge requestSync. Spec: ~300-500ms. Default 400. */
  debounceMs?: number;
  /** Returns "now" as an ISO-8601 string. Injected for deterministic tests. */
  clock?: () => string;
  /**
   * Optional hook run after every successful `engine.sync()` round. Kept
   * generic (not domain-specific) so this data-layer scheduler never imports
   * `domain/*` — the composition root (App.tsx) supplies the actual
   * behavior. Its production use, added in slice 5 task 6: re-wiring the
   * duplicate-emergency-fund reconcile backstop
   * (`ReconcileEmergencyFundTypeUseCase` / `emergencyFundReconcileStore`)
   * that used to fire from the OLD `SyncOrchestrator.syncPending` after a
   * clean `{failed: 0}` sync — the Task 5 cutover to this engine dropped
   * that call site without replacing it, silently orphaning a mechanism the
   * spec's own slice-3/4 as-built notes document as a still-live,
   * load-bearing backstop (not dead code). Failures here are logged and
   * swallowed — the hook must never be able to fail a sync round or crash
   * the scheduler.
   */
  onSyncSuccess?: (householdId: string) => Promise<void> | void;
}

/**
 * Orchestrates SyncEngine.sync() calls for one active household, from the
 * four trigger sources above, and mirrors each round's outcome into
 * `statusSink`. Construct one per active household; call `stop()` before
 * `start()`-ing a different household (e.g. on household switch).
 */
export class SyncScheduler {
  private readonly engine: SyncRunner;
  private readonly supabase: SupabaseClient;
  private readonly networkObserver: ReconnectSource;
  private readonly statusSink: SyncStatusSink;
  private readonly debounceMs: number;
  private readonly clock: () => string;
  private readonly onSyncSuccess: ((householdId: string) => Promise<void> | void) | undefined;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingHouseholdId: string | null = null;
  private unsubscribeWrite: (() => void) | null = null;
  private unsubscribeReconnect: (() => void) | null = null;
  /** Return type of `AppState.addEventListener` — typed structurally (just
   * `.remove()`) to avoid depending on react-native's exact exported
   * subscription type name, which has changed across versions. */
  private appStateSub: { remove(): void } | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private started = false;
  /** Re-entrancy guard (Task 4 review minor, closed here in Task 5): the
   * underlying `engine.sync()` is already single-flight (SyncEngine's own
   * `withLock`), but WITHOUT this flag two triggers landing at once (e.g. an
   * immediate foreground trigger firing while a debounced after-write round
   * is still in flight) would each still call `statusSink.setSyncing(true)`
   * then `false` independently — the second call's `setSyncing(false)` can
   * land BEFORE the first round actually finishes, flickering the UI back to
   * "idle" mid-sync. Guarding here means only the round that's actually
   * running drives the status sink. */
  private syncing = false;
  /** A trigger that arrived while a round was already in flight (SYNC-7).
   * Holds that trigger's household id so the `finally` below can re-request
   * it: the running round may have already read the oplog before the write
   * that fired the trigger committed, so silently dropping it can strand a
   * write until the NEXT unrelated trigger — potentially never. */
  private rerunHouseholdId: string | null = null;
  /** The round currently draining, so `syncNow` can await it. */
  private inFlight: Promise<SyncRoundOutcome> | null = null;

  constructor(deps: SyncSchedulerDeps) {
    this.engine = deps.engine;
    this.supabase = deps.supabase;
    this.networkObserver = deps.networkObserver;
    this.statusSink = deps.statusSink ?? NULL_SYNC_STATUS_SINK;
    this.debounceMs = deps.debounceMs ?? 400;
    this.clock = deps.clock ?? ((): string => new Date().toISOString());
    this.onSyncSuccess = deps.onSyncSuccess;
  }

  /** True once `start()` has wired triggers and not yet been `stop()`-ed. */
  get isStarted(): boolean {
    return this.started;
  }

  /**
   * Wires all four triggers for `householdId`. Idempotent — a second call
   * before `stop()` is a no-op (rebinding to a different household requires
   * `stop()` then `start(newHouseholdId)` — Task 5's household-switch concern).
   */
  start(householdId: string): void {
    if (this.started) return;
    this.started = true;
    this.pendingHouseholdId = householdId;

    // (a) after-write: any createSyncedRepo write, anywhere in the app,
    // notifies here via the UnitOfWork write-notifier once its transaction
    // commits. Uses the household the write actually touched, not
    // necessarily the bound `householdId` (a background write to a
    // different household the user belongs to still gets debounced-synced).
    this.unsubscribeWrite = onOplogWrite((writtenHouseholdId) => {
      this.requestSync(writtenHouseholdId);
    });

    // (b) AppState foreground.
    this.appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') this.requestSync(householdId, { immediate: true });
    });

    // (c) NetInfo reconnect (the existing NetworkObserver singleton). The
    // observer outlives this scheduler (app-lifetime singleton), so keep the
    // unsubscribe and drop the callback in stop() — otherwise every household
    // switch leaks another dead scheduler's callback onto every reconnect.
    this.unsubscribeReconnect =
      this.networkObserver.onConnected(async () => {
        this.requestSync(householdId, { immediate: true });
      }) ?? null;

    // (d) Supabase Realtime nudge — NEVER the sole trigger (§6.7, see module
    // doc above). Subscribe failures/CLOSE/TIMED_OUT are logged, not thrown.
    this.realtimeChannel = this.supabase
      .channel(`oplog:${householdId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'oplog',
          filter: `household_id=eq.${householdId}`,
        },
        () => this.requestSync(householdId),
      )
      .subscribe((status, err) => {
        if (status !== 'SUBSCRIBED') {
          logger.warn(
            'SyncScheduler: realtime nudge channel not subscribed — relying on ' +
              'foreground/reconnect/after-write triggers (spec §6.7, nudge is never the sole trigger)',
            { householdId, status, error: err instanceof Error ? err.message : err },
          );
        }
      });

    // Report the starting pending count immediately (before any trigger fires).
    this.refreshDiagnostics(householdId);
  }

  /**
   * Requests a sync of `householdId`. Debounced by default (~300-500ms per
   * spec — see `debounceMs`) so a burst of local writes collapses into one
   * `sync()` call. `immediate: true` (foreground/reconnect — infrequent,
   * high-value events) skips the debounce and runs right away.
   */
  requestSync(householdId: string, opts: { immediate?: boolean } = {}): void {
    // A no-op before `start()` / after `stop()`: a stopped scheduler has no
    // triggers wired and no household binding, so honouring a stray late
    // callback here would drive `statusSink` (and a real `engine.sync()`) for
    // a household the app has already left.
    if (!this.started) {
      logger.info('SyncScheduler: requestSync ignored, scheduler not started', { householdId });
      return;
    }
    this.pendingHouseholdId = householdId;
    if (opts.immediate) {
      this.clearDebounce();
      void this.runSync(householdId);
      return;
    }
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const hh = this.pendingHouseholdId;
      if (hh) void this.runSync(hh);
    }, this.debounceMs);
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Runs ONE immediate, non-debounced round for `householdId` and resolves
   * only when it has finished. Used by flows that must not continue until
   * their local write is on the server — a pull-to-refresh that should show
   * fresh data when the spinner stops, or a slip upload whose edge function
   * 403s unless the `slip_queue` row has already been pushed.
   *
   * If a round is already in flight it waits for it and then runs a FRESH
   * one, because the running round may have read the oplog before the
   * caller's write committed. Rejects when the round did not reach the
   * server, so the caller can surface a real failure instead of a silent
   * no-op — see `requestSync` for the fire-and-forget trigger path.
   */
  async syncNow(householdId: string): Promise<SyncSummary> {
    if (!this.started) {
      throw new Error('SyncScheduler.syncNow: scheduler is not started');
    }
    // At most one wait-then-run; a third attempt would mean an unrelated
    // trigger is winning the race repeatedly, which the caller should see.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (this.inFlight) {
        await this.inFlight.catch(() => undefined);
        continue;
      }
      this.clearDebounce();
      this.pendingHouseholdId = householdId;
      const outcome = await this.runSync(householdId);
      if (outcome === null) continue;
      if (outcome.error) throw outcome.error;
      if (outcome.summary.transportFailed) {
        throw new Error('Sync could not reach the server — changes are still queued.');
      }
      return outcome.summary;
    }
    throw new Error('SyncScheduler.syncNow: another sync round kept the household busy');
  }

  /** Resolves to `null` when the round was deferred by the re-entrancy guard. */
  private async runSync(householdId: string): Promise<SyncRoundOutcome | null> {
    // Re-entrancy guard: `engine.sync()` is already single-flight internally,
    // so this never causes duplicate work -- it only stops a second
    // overlapping trigger from re-driving `statusSink` (see the `syncing`
    // field doc-comment) while a round is already in progress. The skipped
    // trigger is never "lost" -- whatever prompted it (a write/foreground/
    // reconnect/nudge) will be covered by the CURRENTLY running round or the
    // next trigger after it.
    if (this.syncing) {
      // SYNC-7: remember it instead of dropping it. The running round may
      // already have read the oplog before this trigger's write committed, so
      // "the currently running round covers it" is not actually guaranteed —
      // the `finally` below re-requests it once the round ends.
      this.rerunHouseholdId = householdId;
      logger.info('SyncScheduler: sync already in flight, deferring overlapping trigger', {
        householdId,
      });
      return null;
    }
    this.syncing = true;
    this.statusSink.setSyncing(true);
    const round = this.runSyncRound(householdId);
    // Cleared inside `runSyncRound`'s own `finally`, i.e. BEFORE `round`
    // settles — so a `syncNow` awaiting it sees a free scheduler the moment
    // it resumes, never a stale in-flight handle.
    this.inFlight = round;
    return round;
  }

  private async runSyncRound(householdId: string): Promise<SyncRoundOutcome> {
    try {
      const summary = await this.engine.sync(householdId);
      // SYNC-10: `engine.sync()` never throws for a transport failure or a
      // poison batch — it reports them. Stamping `lastSyncedAt` on those
      // would tell the user "synced just now" for a round that never reached
      // the server (or whose puller is stalled), while the real error surface
      // stays empty.
      if (summary.transportFailed) {
        this.statusSink.setError('Sync could not reach the server — changes are still queued.');
      } else if (summary.pullBlocked) {
        this.statusSink.setError('Sync is blocked on an update this app version cannot apply.');
      } else if (summary.skipped) {
        // Another round for this household was already draining — neither
        // this round's success to claim nor an error.
        logger.info('SyncScheduler: sync round skipped by the engine single-flight guard', {
          householdId,
        });
      } else {
        this.statusSink.setError(null);
        this.statusSink.setLastSyncedAt(this.clock());
      }
      if (
        !summary.transportFailed &&
        !summary.pullBlocked &&
        !summary.skipped &&
        this.onSyncSuccess
      ) {
        try {
          await this.onSyncSuccess(householdId);
        } catch (hookErr) {
          logger.warn('SyncScheduler: onSyncSuccess hook failed', {
            householdId,
            error: hookErr instanceof Error ? hookErr.message : String(hookErr),
          });
        }
      }
      return { summary };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn('SyncScheduler: sync() failed', { householdId, error: error.message });
      this.statusSink.setError(error.message);
      return {
        summary: { transportFailed: true, pullBlocked: false, skipped: false },
        error,
      };
    } finally {
      this.syncing = false;
      this.inFlight = null;
      this.statusSink.setSyncing(false);
      this.refreshDiagnostics(householdId);
      // SYNC-7: replay whatever arrived mid-round. `requestSync` is itself a
      // no-op once stopped, and the flag is cleared FIRST so a failing round
      // can never spin here.
      const rerun = this.rerunHouseholdId;
      this.rerunHouseholdId = null;
      if (rerun) this.requestSync(rerun);
    }
  }

  /** Refreshes `pendingCount`/`pullBlocked` — read-only, never throws (a
   * count query failing must never break a trigger). */
  private refreshDiagnostics(householdId: string): void {
    try {
      this.statusSink.setPendingCount(this.engine.getPendingPushCount());
    } catch (err) {
      logger.warn('SyncScheduler: getPendingPushCount failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      this.statusSink.setPullBlocked(this.engine.getPullHealth(householdId).blocked);
    } catch (err) {
      logger.warn('SyncScheduler: getPullHealth failed', {
        householdId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Unwires all triggers. Safe to call when not started. */
  stop(): void {
    this.clearDebounce();
    this.unsubscribeWrite?.();
    this.unsubscribeWrite = null;
    this.unsubscribeReconnect?.();
    this.unsubscribeReconnect = null;
    this.appStateSub?.remove();
    this.appStateSub = null;
    if (this.realtimeChannel) {
      void this.supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    this.started = false;
    this.pendingHouseholdId = null;
    // Reset the re-entrancy flag so a subsequent start() (e.g. a household
    // switch right after stop()) never has its immediate requestSync
    // spuriously skipped by a stale flag from the PREVIOUS household's round
    // still finishing in the background (that round's own `finally` will
    // still safely reset this again -- a plain boolean assignment is
    // idempotent either way).
    this.syncing = false;
    this.rerunHouseholdId = null;
    this.inFlight = null;
  }
}
