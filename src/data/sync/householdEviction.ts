// src/data/sync/householdEviction.ts
//
// A tiny registry for the one thing the sync engine can discover that the
// rest of the app has no other way to learn: THIS DEVICE IS NO LONGER A
// MEMBER OF A HOUSEHOLD IT STILL HAS OPEN.
//
// Why it cannot be discovered any other way: membership changes replicate as
// `public.oplog` rows, and `sync_pull` is SECURITY INVOKER over an
// RLS-protected `oplog` whose policy is `private.is_household_member`. The
// moment an owner removes someone, that someone's pulls return ZERO ROWS
// forever — indistinguishable from "nothing new". The removal op exists, and
// they are the one device that can never read it. The only authoritative
// signal that reaches them is a `sync_push` rejected `not_member` (or an
// explicit membership check), which is what `SyncEngine` acts on.
//
// Same shape, and for the same reason, as `syncRuntime.ts`: a data-layer
// module both sides depend on, so `SyncEngine` (data) never imports
// `presentation/*` while a screen or the composition root can still react.
// Deliberately not a zustand store — `data/*` must not reach into
// `presentation/*`, and the UI wants a one-shot event, not a subscription to
// a value.

import { logger } from '../../infrastructure/logging/Logger';

export interface HouseholdEviction {
  /** The household this device has been removed from. */
  householdId: string;
  /** ISO-8601 timestamp of when the removal was CONFIRMED (not when it happened server-side). */
  detectedAt: string;
}

export type HouseholdEvictionListener = (eviction: HouseholdEviction) => void;

/** An eviction announced while NOTHING was listening — a background sync
 * round that finished before the app subscribed, typically during boot. Held
 * so it is not lost, and read exactly once by `consumeHouseholdEviction`.
 *
 * It is deliberately NOT set when a listener was present: that listener has
 * already handled it, and latching it as well would make a later remount
 * handle the same eviction a second time (a duplicate toast, a second
 * household switch). Exactly one of the two paths fires, never both. */
let pending: HouseholdEviction | null = null;

const listeners = new Set<HouseholdEvictionListener>();

/**
 * Announces a confirmed eviction. Called by `SyncEngine.evictHousehold` AFTER
 * its transaction has committed, so every listener sees a local database that
 * already reflects the eviction.
 *
 * A listener that throws is logged and skipped: the engine's drain must never
 * fail because a UI subscriber did.
 */
export function publishHouseholdEviction(eviction: HouseholdEviction): void {
  if (listeners.size === 0) {
    pending = eviction;
    return;
  }
  for (const listener of [...listeners]) {
    try {
      listener(eviction);
    } catch (err) {
      logger.warn('householdEviction: listener threw, continuing', {
        householdId: eviction.householdId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Subscribes to evictions announced from now on. Returns the unsubscribe. */
export function subscribeHouseholdEviction(listener: HouseholdEvictionListener): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

/**
 * Takes the pending eviction, if any, and clears it — so a consumer that
 * mounts after the fact still reacts exactly ONCE (no repeated toast, no
 * repeated household switch on every re-render).
 */
export function consumeHouseholdEviction(): HouseholdEviction | null {
  const current = pending;
  pending = null;
  return current;
}

/** Drops the pending eviction and every listener. Tests only — production
 * unsubscribes via the function `subscribeHouseholdEviction` returns. */
export function resetHouseholdEvictions(): void {
  pending = null;
  listeners.clear();
}
