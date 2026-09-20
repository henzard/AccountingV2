import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopeContributions, envelopes } from '../../data/local/schema';
import { getEnvelopeScope } from '../envelopes/EnvelopeEntity';
import type { EnvelopeType } from '../envelopes/EnvelopeEntity';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { uuidv5, APP_NAMESPACE } from '../../infrastructure/crypto/uuidv5';

/**
 * How a contribution row came to exist.
 *
 *  - `rollover`: the household started a new budget period, so the persistent
 *    envelope's monthly `allocatedCents` was actually moved into it. This is
 *    the ONLY way a fund grows — an allocation the user has merely TYPED is a
 *    pledge for the current period, not money saved, which is exactly why
 *    Baby Step 1 must not complete the instant someone enters R1,000.
 *  - `opening_balance`: the one-off carry-over of a LEGACY envelope's
 *    `allocatedCents` (see `LEGACY_OPENING_BALANCE_CUTOFF`).
 */
export type ContributionSource = 'opening_balance' | 'rollover';

/**
 * Backfill rule for envelopes that already exist in production.
 *
 * Before the contribution ledger existed, a persistent envelope's "saved"
 * figure WAS its `allocatedCents` — that number is the only record of what
 * those households have put away, and dropping it would zero real money on
 * screen. So every persistent envelope CREATED BEFORE this instant gets
 * exactly one `opening_balance` contribution equal to its `allocatedCents`,
 * and every envelope created AFTER it starts at zero and grows only by
 * rollover.
 *
 * The cutoff is what keeps the backfill honest: without it the same rule
 * would hand every NEW fund its typed allocation as instant savings,
 * re-introducing the "Baby Step 1 completes by typing R1,000" bug this ledger
 * exists to fix.
 *
 * `createdAt` is a synced column, so every device classifies the same
 * envelope the same way and the backfill converges without coordination. This
 * constant must NEVER move: changing it would re-classify already-backfilled
 * envelopes.
 */
export const LEGACY_OPENING_BALANCE_CUTOFF = '2026-09-21T00:00:00.000Z';

/**
 * The deterministic id of the one-off `opening_balance` contribution for
 * `envelopeId`. A pure function of the household + envelope, so the backfill
 * is idempotent across re-runs and identical on every device.
 */
export function openingContributionId(householdId: string, envelopeId: string): string {
  return uuidv5(`contribution:opening:${householdId}:${envelopeId}`, APP_NAMESPACE);
}

/**
 * The deterministic id of the `rollover` contribution that funds `envelopeId`
 * for `periodStart` — the same pattern (and the same reason) as
 * `rolloverEnvelopeId`: a double rollover, or two offline devices rolling the
 * same period transition over independently, must converge on ONE row rather
 * than fund the envelope twice.
 */
export function periodContributionId(
  householdId: string,
  envelopeId: string,
  periodStart: string,
): string {
  return uuidv5(`contribution:period:${householdId}:${periodStart}:${envelopeId}`, APP_NAMESPACE);
}

/**
 * True if `envelope` is a PERSISTENT, non-archived envelope carrying a
 * positive monthly allocation — the exact set that earns a contribution when
 * a period rolls over. A zero (or negative) allocation contributes nothing,
 * so no row is written for it.
 */
export function isContributingEnvelope(envelope: {
  envelopeType: string;
  isArchived: boolean;
  allocatedCents: number;
}): boolean {
  return (
    !envelope.isArchived &&
    envelope.allocatedCents > 0 &&
    getEnvelopeScope({ envelopeType: envelope.envelopeType as EnvelopeType }) === 'persistent'
  );
}

/** Builds the snake_case contribution row the synced-write path expects. */
export function buildContributionRow(input: {
  id: string;
  householdId: string;
  envelopeId: string;
  amountCents: number;
  periodStart: string;
  source: ContributionSource;
  now: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    household_id: input.householdId,
    envelope_id: input.envelopeId,
    amount_cents: input.amountCents,
    period_start: input.periodStart,
    source: input.source,
    created_at: input.now,
    updated_at: input.now,
  };
}

/** Returns the subset of `ids` that already have an `envelope_contributions` row. */
export async function findExistingContributionIds(
  db: ExpoSQLiteDatabase<typeof schema>,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: envelopeContributions.id })
    .from(envelopeContributions)
    .where(inArray(envelopeContributions.id, ids));
  return new Set(rows.map((row) => row.id));
}

/**
 * Envelope ids that already have a non-deleted contribution row for
 * `periodStart` — "this period has already funded these funds".
 *
 * This is a VALUE-based idempotency check, deliberately alongside the
 * deterministic-id one: `UpdateHouseholdPaydayDayUseCase` re-keys the current
 * period's contribution rows when a payday change moves the period key, and a
 * re-keyed row keeps the id it was born with. Only the id check would
 * therefore miss it and let the same period fund the same envelope a second
 * time.
 */
export async function findFundedEnvelopeIdsForPeriod(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  periodStart: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ envelopeId: envelopeContributions.envelopeId })
    .from(envelopeContributions)
    .where(
      and(
        eq(envelopeContributions.householdId, householdId),
        eq(envelopeContributions.periodStart, periodStart),
        isNull(envelopeContributions.deletedAt),
      ),
    );
  return new Set(rows.map((row) => row.envelopeId));
}

export interface EnsureOpeningBalancesOutput {
  /** Number of `opening_balance` rows newly written by this call. */
  count: number;
}

/**
 * Writes the one-off `opening_balance` contribution for every LEGACY
 * persistent envelope of `householdId` that does not have one yet (see
 * `LEGACY_OPENING_BALANCE_CUTOFF` for who qualifies and why).
 *
 * Deliberately a SYNCED write rather than a SQL backfill inside migration
 * 0016: a migration only ever runs on the device that upgraded, so its rows
 * would never reach the oplog — a second device that restores from the server
 * would then show every legacy fund short by its whole opening balance.
 * Writing through the synced repo replicates it once, and the deterministic
 * id makes the duplicate a no-op on every other device
 * (`apply_one_op` inserts `ON CONFLICT (id) DO NOTHING`).
 *
 * Idempotent and safe to call on every app foreground: envelopes that already
 * have their opening row are skipped, so a second call writes nothing.
 */
export async function ensureOpeningBalances(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  deps: SyncWriteDeps = {},
): Promise<Result<EnsureOpeningBalancesOutput>> {
  try {
    const candidates = await db
      .select()
      .from(envelopes)
      .where(and(eq(envelopes.householdId, householdId), isNull(envelopes.deletedAt)));

    const legacy = candidates.filter(
      (row) => isContributingEnvelope(row) && row.createdAt < LEGACY_OPENING_BALANCE_CUTOFF,
    );
    if (legacy.length === 0) {
      return createSuccess({ count: 0 });
    }

    const existing = await findExistingContributionIds(
      db,
      legacy.map((row) => openingContributionId(householdId, row.id)),
    );

    const repo = resolveSyncedRepo(db, 'envelope_contributions', deps);
    const ctx = resolveSyncedRepoCtx(deps);
    const now = ctx.clock();

    let count = 0;
    for (const envelope of legacy) {
      const id = openingContributionId(householdId, envelope.id);
      if (existing.has(id)) continue;
      repo.insert(
        buildContributionRow({
          id,
          householdId,
          envelopeId: envelope.id,
          amountCents: envelope.allocatedCents,
          // The period the envelope was created in — the period whose income
          // the legacy allocation was assigned from.
          periodStart: envelope.periodStart,
          source: 'opening_balance',
          now,
        }),
        ctx,
      );
      count += 1;
    }

    return createSuccess({ count });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return createFailure({ code: 'DB_ERROR', message });
  }
}
