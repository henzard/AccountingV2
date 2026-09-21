import { sql } from 'drizzle-orm';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { households } from '../../data/local/schema';
import type { RestoreService } from '../../data/sync/RestoreService';
import { toLocalRow } from '../../data/sync/rowConverters';
import type { HouseholdSummary } from './EnsureHouseholdUseCase';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

export interface HydrateHouseholdDeps {
  supabase: SupabaseClient;
  db: ExpoSQLiteDatabase<typeof schema>;
  restoreService: RestoreService;
  householdId: string;
  userId: string;
}

/**
 * Downloads and persists the LOCAL `households` row for a membership that
 * already exists (server-side, and locally in `household_members`).
 *
 * Extracted verbatim from AcceptInviteUseCase so the three callers that need
 * it — the first-time join, re-entering the same code after a half-completed
 * join, and the app-start recovery (F1) — converge on exactly the same local
 * state and exactly the same honest, retryable failure. It is deliberately
 * idempotent: every step either re-reads the server or upserts, so running it
 * again after a failure (or after a force-quit) is always safe.
 */
export async function hydrateHousehold({
  supabase,
  db,
  restoreService,
  householdId,
  userId,
}: HydrateHouseholdDeps): Promise<Result<HouseholdSummary>> {
  let restored = await restoreService
    .restoreHousehold(householdId, 'member', userId)
    .catch(() => null);

  if (!restored) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    restored = await restoreService
      .restoreHousehold(householdId, 'member', userId)
      .catch(() => null);
  }

  if (!restored) {
    // M10 (exhaustive audit): both restore attempts failed.
    // RestoreService.restoreHousehold is the ONLY place that persists a
    // local `households` row — it returns null BEFORE that write when its
    // households fetch fails, so at this point the joiner has a local
    // household_members row but NO local household. Silently fabricating
    // name: 'My Household' / paydayDay: 25 here (the old behavior) would
    // corrupt every budget-period boundary the joiner sees in-session
    // (wrong payday), and never inserting a local `households` row means
    // the NEXT cold start's EnsureHouseholdUseCase finds the membership
    // but not the household. F1 (round 6) makes that state recoverable —
    // EnsureHouseholdUseCase reports `household_not_downloaded` and the
    // boot gate runs THIS function again — but it is still a state to
    // avoid, and "Create Household" must never be the way out of it.
    //
    // Fall back to a direct, minimal fetch of the real household record
    // (skipping RestoreService's full entity-table catch-up, which the
    // ordinary background restore/sync paths will still complete later)
    // and persist it locally ourselves. Only if THIS also fails (fully
    // offline, not just a flaky restore) do we fail cleanly instead of
    // inventing data.
    const { data: hh, error: hhError } = await supabase
      .from('households')
      .select('*')
      .eq('id', householdId)
      .single();

    if (hhError || !hh) {
      return createFailure({
        code: 'HOUSEHOLD_RESTORE_FAILED',
        message:
          "You've joined — we couldn't download the household yet. Check your connection and tap Try again.",
      });
    }

    const localHousehold = toLocalRow(hh as Record<string, unknown>);
    try {
      await db
        .insert(households)
        .values(localHousehold as typeof households.$inferInsert)
        .onConflictDoUpdate({
          target: households.id,
          set: {
            name: sql`excluded.name`,
            paydayDay: sql`excluded.payday_day`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    } catch {
      // A transient local SQLite failure here must not escape as an unhandled
      // rejection — keep the Result contract every caller relies on.
      return createFailure({
        code: 'HOUSEHOLD_RESTORE_FAILED',
        message: "You've joined — we couldn't save the household on this device. Tap Try again.",
      });
    }

    restored = {
      id: hh.id as string,
      name: hh.name as string,
      paydayDay: hh.payday_day as number,
      role: 'member',
    };
  }

  return createSuccess({
    id: restored.id,
    name: restored.name,
    paydayDay: restored.paydayDay,
    userLevel: 1,
  });
}
