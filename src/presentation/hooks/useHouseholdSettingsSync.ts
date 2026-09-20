import { useCallback, useEffect } from 'react';
import { eq } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { households as householdsTable } from '../../data/local/schema';
import { useAppStore } from '../stores/appStore';
import { useReloadOnSync } from './useReloadOnSync';

/**
 * Keeps `appStore`'s copy of the active household's server-owned attributes
 * (payday day, name) in step with the LOCAL `households` row (REG-5).
 *
 * `paydayDay` is what every period key is derived from, but it used to be
 * written only at boot, in Settings, in onboarding and by the household
 * picker — always from a snapshot taken at sign-in. So when a PARTNER changed
 * the payday (which re-keys the current period's envelopes on the server),
 * this device pulled the re-keyed envelope rows but kept querying the OLD
 * period key: an empty dashboard, and then the rollover wizard auto-opening
 * on "the current period is empty" — which would have DUPLICATED the live
 * period's envelopes.
 *
 * The household row arrives through the ordinary puller, so re-reading it
 * after every genuinely successful sync round (`useReloadOnSync`) and on
 * household switch is enough; no extra network call and no new trigger.
 *
 * Mounted once, in App.tsx's composition root — not per screen.
 */
export function useHouseholdSettingsSync(householdId: string | null): void {
  const applyHouseholdPatch = useAppStore((s) => s.applyHouseholdPatch);

  const reload = useCallback(async () => {
    if (!householdId) return;
    const rows = await db
      .select({ name: householdsTable.name, paydayDay: householdsTable.paydayDay })
      .from(householdsTable)
      .where(eq(householdsTable.id, householdId))
      .limit(1);
    const row = rows[0];
    if (!row) return;
    applyHouseholdPatch(householdId, { name: row.name, paydayDay: row.paydayDay });
  }, [householdId, applyHouseholdPatch]);

  // Household switch (and first mount): adopt THAT household's stored payday
  // rather than carrying the previous household's over.
  useEffect(() => {
    void reload();
  }, [reload]);

  useReloadOnSync(reload);
}
