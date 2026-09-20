// src/data/sync/syncRuntime.ts
//
// A tiny registry so code OUTSIDE the composition root can demand a sync
// round and wait for it.
//
// The `SyncScheduler` is built in App.tsx (it needs the resolved device id,
// the supabase client and the status sink) and kept module-local there, so a
// screen or use case cannot reach it — and importing App.tsx from a screen
// would be a circular import through the whole navigator. Instead App.tsx
// REGISTERS its scheduler here once it exists, and callers depend only on
// this two-function module.
//
// This is deliberately not a zustand store: the callers want to AWAIT a
// completed round, not subscribe to state, and a data-layer module must not
// reach into `presentation/*`.
//
// Why callers need it (the fire-and-forget `requestSync` triggers are not
// enough for either):
//   - pull-to-refresh must keep its spinner up until the round it asked for
//     has actually finished, and must show an error if it never reached the
//     server;
//   - the slip-scanning edge function reads the `slip_queue` row server-side
//     and 403s if the local insert has not been pushed yet, so that flow has
//     to push BEFORE it calls out.

/** What `registerSyncRuntime` accepts — satisfied by App.tsx's adapter over
 * `SyncScheduler.syncNow`. Kept structural so tests can register a stub. */
export interface SyncRuntime {
  /** Resolves once an immediate, non-debounced round for `householdId` has
   * completed; rejects if that round did not reach the server. */
  requestSyncNow(householdId: string): Promise<void>;
  /** Unwires every sync trigger and resolves once the round already in
   * flight (if any) has settled — see `stopSyncRuntime`. */
  stop(): Promise<void>;
}

let runtime: SyncRuntime | null = null;

/**
 * Publishes the app's sync runtime, or clears it with `null`.
 *
 * App.tsx registers it where the scheduler is created and clears it on
 * sign-out / `stop()`, so a caller after sign-out gets a clear rejection
 * rather than silently syncing the previous user's household.
 */
export function registerSyncRuntime(runtime_: SyncRuntime | null): void {
  runtime = runtime_;
}

/**
 * Runs one immediate sync round for `householdId` and resolves when it has
 * completed — including waiting out, then re-running after, a round that was
 * already in flight (that round may have read the oplog before the caller's
 * write committed, so it cannot be treated as covering it).
 *
 * Rejects if the round had a transport failure, and if no runtime is
 * registered (not signed in, or boot has not reached the scheduler yet) —
 * never resolves as though a sync happened when none did.
 */
/**
 * Stops the registered runtime's triggers, waits out the sync round already
 * in flight, and clears the registration — then resolves.
 *
 * Exists for account deletion (REG-11 / SEC2-6): the local database is wiped
 * right after the server-side erasure, and a pull that is mid-apply when that
 * happens either re-creates rows into the emptied schema or throws inside the
 * wipe's own transaction. Stopping the triggers is not enough on its own —
 * `SyncScheduler.stop()` returns immediately — so the caller needs the awaited
 * form. A no-op (resolved) when nothing is registered.
 */
export async function stopSyncRuntime(): Promise<void> {
  const current = runtime;
  runtime = null;
  if (current) await current.stop();
}

export function requestSyncNow(householdId: string): Promise<void> {
  if (!runtime) {
    return Promise.reject(
      new Error(
        'requestSyncNow: no sync runtime registered — the app is not signed in, or boot has ' +
          'not started the sync scheduler yet.',
      ),
    );
  }
  return runtime.requestSyncNow(householdId);
}
