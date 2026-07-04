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
import type { PullHealth } from './SyncEngine';
import { logger } from '../../infrastructure/logging/Logger';

/** Minimal shape of `SyncEngine` this scheduler drives — an interface (not
 * the concrete class) so tests can inject a fake without a real SQLite db +
 * transport. The production `SyncEngine` satisfies this structurally. */
export interface SyncRunner {
  sync(householdId: string): Promise<void>;
  getPullHealth(householdId: string): PullHealth;
  getPendingPushCount(): number;
}

/** Minimal shape of `NetworkObserver` this scheduler needs — the real
 * `networkObserver` singleton (infrastructure/network/NetworkObserver.ts)
 * satisfies this; tests can inject a bare `{ onConnected }` stub. */
export interface ReconnectSource {
  onConnected(callback: () => Promise<void>): void;
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

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingHouseholdId: string | null = null;
  private unsubscribeWrite: (() => void) | null = null;
  /** Return type of `AppState.addEventListener` — typed structurally (just
   * `.remove()`) to avoid depending on react-native's exact exported
   * subscription type name, which has changed across versions. */
  private appStateSub: { remove(): void } | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private started = false;

  constructor(deps: SyncSchedulerDeps) {
    this.engine = deps.engine;
    this.supabase = deps.supabase;
    this.networkObserver = deps.networkObserver;
    this.statusSink = deps.statusSink ?? NULL_SYNC_STATUS_SINK;
    this.debounceMs = deps.debounceMs ?? 400;
    this.clock = deps.clock ?? ((): string => new Date().toISOString());
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

    // (c) NetInfo reconnect (the existing NetworkObserver singleton).
    this.networkObserver.onConnected(async () => {
      this.requestSync(householdId, { immediate: true });
    });

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

  private async runSync(householdId: string): Promise<void> {
    this.statusSink.setSyncing(true);
    try {
      await this.engine.sync(householdId);
      this.statusSink.setError(null);
      this.statusSink.setLastSyncedAt(this.clock());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('SyncScheduler: sync() failed', { householdId, error: message });
      this.statusSink.setError(message);
    } finally {
      this.statusSink.setSyncing(false);
      this.refreshDiagnostics(householdId);
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
    this.appStateSub?.remove();
    this.appStateSub = null;
    if (this.realtimeChannel) {
      void this.supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    this.started = false;
    this.pendingHouseholdId = null;
  }
}
