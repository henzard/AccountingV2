// src/data/sync/membershipCheckSchedule.ts
//
// DEVICE-LOCAL schedule for the periodic membership check (see
// `SyncScheduler.runMembershipCheckIfDue`).
//
// WHY IT EXISTS. `sync_pull` is SECURITY INVOKER over an RLS-protected
// `oplog`, so a member who has been removed server-side simply stops seeing
// rows — zero rows is indistinguishable from "nothing new". Eviction
// therefore only ever fired off a push rejected `not_member`, which a device
// that only READS never produces: it keeps showing the household's data
// indefinitely. A cheap periodic check closes that, but it must be BOUNDED —
// at most one extra round trip per household per day, not one per foreground.
//
// WHY ASYNCSTORAGE. The timestamp is per-device bookkeeping, not household
// data: it must never reach the oplog (a synced column would also be a NEW
// synced column, which pull-blocks shipped 1.1.130 devices outright). This
// mirrors the existing device-local flags under
// src/infrastructure/storage (onboardingFlag.ts).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../../infrastructure/logging/Logger';

/** At most one membership check per household per 24h. */
export const MEMBERSHIP_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function scheduleKey(householdId: string): string {
  return `@membership_checked_at:${householdId}`;
}

/**
 * Is a membership check due for `householdId` at `nowMs`?
 *
 * - never checked (or a value this build cannot parse) -> due;
 * - last check older than `MEMBERSHIP_CHECK_INTERVAL_MS` -> due;
 * - a timestamp in the FUTURE (device clock moved backwards) -> due, rather
 *   than parking the check until the clock catches up;
 * - storage unreadable -> NOT due. The whole point of the schedule is to
 *   bound the check; a device whose storage cannot be read also cannot
 *   record a new timestamp, so treating it as due would mean one network
 *   round trip on every single foreground, forever.
 */
export async function isMembershipCheckDue(householdId: string, nowMs: number): Promise<boolean> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(scheduleKey(householdId));
  } catch (err) {
    logger.warn('membershipCheckSchedule: could not read the last-checked timestamp — skipping', {
      householdId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  if (raw === null) return true;
  const last = Number(raw);
  if (!Number.isFinite(last)) return true;
  return last > nowMs || nowMs - last >= MEMBERSHIP_CHECK_INTERVAL_MS;
}

/**
 * Records that the server gave a CONCLUSIVE answer at `nowMs`. Only called
 * for an answered check — an inconclusive one (offline, 5xx, timeout) must
 * leave the timestamp exactly where it was, so the next foreground asks
 * again. Best-effort: a write failure only costs one extra check later.
 */
export async function recordMembershipCheck(householdId: string, nowMs: number): Promise<void> {
  try {
    await AsyncStorage.setItem(scheduleKey(householdId), String(nowMs));
  } catch (err) {
    logger.warn('membershipCheckSchedule: could not record the last-checked timestamp', {
      householdId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
