import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopeContributions, envelopes } from '../../data/local/schema';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import type { PortableDb, UnitOfWork } from '../../data/uow/UnitOfWork';
import { insertRowWithinUow, updateRowWithinUow } from '../../data/uow/createSyncedRepo';
import { requestSyncNow } from '../../data/sync/syncRuntime';
import { getEnvelopeScope } from '../envelopes/EnvelopeEntity';
import type { EnvelopeType } from '../envelopes/EnvelopeEntity';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { uuidv5, APP_NAMESPACE } from '../../infrastructure/crypto/uuidv5';

/**
 * How a contribution row came to exist.
 *
 *  - `rollover`: the household started a new budget period, so the persistent
 *    envelope's monthly `allocatedCents` was actually moved into it. This is
 *    the main way a fund grows — an allocation the user has merely TYPED is a
 *    pledge for the current period, not money saved, which is exactly why
 *    Baby Step 1 must not complete the instant someone enters R1,000.
 *  - `initial`: the fund was CREATED mid-period, so it never saw a rollover
 *    into the period it was born in. `CreateEnvelopeUseCase` writes this row
 *    in the same unit of work as the envelope, under the SAME deterministic
 *    id a later rollover into that period would use, so the two can never
 *    double-fund the same period (REG-7).
 *  - `opening_balance`: the one-off carry-over of a LEGACY envelope's
 *    `allocatedCents` (see `LEGACY_OPENING_BALANCE_CUTOFF`).
 *  - `monthly_confirmed`: a ZERO-amount MARKER row, not money. It records
 *    that the user has explicitly told us what this envelope's monthly
 *    contribution is, so a legacy envelope stops being treated as
 *    "amount unknown" (see `ensureOpeningBalances`).
 *  - `adjustment`: a manual correction of the saved balance entered by the
 *    user (`AdjustSavedBalanceUseCase`) — money already saved that the ledger
 *    never saw, or a correction downwards. May be negative.
 */
export type ContributionSource =
  | 'opening_balance'
  | 'rollover'
  | 'initial'
  | 'monthly_confirmed'
  | 'adjustment';

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
 *
 * `CreateEnvelopeUseCase` uses this SAME id for the `initial` contribution of
 * a fund created mid-period, which is what stops the next rollover INTO that
 * period from funding it a second time.
 */
export function periodContributionId(
  householdId: string,
  envelopeId: string,
  periodStart: string,
): string {
  return uuidv5(`contribution:period:${householdId}:${periodStart}:${envelopeId}`, APP_NAMESPACE);
}

/**
 * The deterministic id of the `monthly_confirmed` MARKER row for
 * `envelopeId` — see `ContributionSource` and `ensureOpeningBalances`.
 *
 * Deterministic for the same reason the other two are: two devices that both
 * confirm the same envelope's monthly amount must converge on ONE marker
 * (`apply_one_op` inserts `ON CONFLICT (id) DO NOTHING`), not accumulate one
 * per device.
 */
export function monthlyConfirmedContributionId(householdId: string, envelopeId: string): string {
  return uuidv5(`contribution:monthly_confirmed:${householdId}:${envelopeId}`, APP_NAMESPACE);
}

/**
 * True if `envelope` is a PERSISTENT, non-archived envelope carrying a
 * positive monthly allocation — the exact set that earns a contribution when
 * a period rolls over. A zero (or negative) allocation contributes nothing,
 * so no row is written for it.
 *
 * This is also precisely what stops an UNCONFIRMED legacy envelope from being
 * funded: `ensureOpeningBalances` moves its legacy `allocatedCents` into the
 * ledger and leaves the column at 0 ("monthly amount not known yet"), so it
 * drops out of this predicate until the user confirms an amount.
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

/** True for a PERSISTENT, non-archived envelope, whatever its allocation. */
export function isPersistentEnvelope(envelope: {
  envelopeType: string;
  isArchived: boolean;
}): boolean {
  return (
    !envelope.isArchived &&
    getEnvelopeScope({ envelopeType: envelope.envelopeType as EnvelopeType }) === 'persistent'
  );
}

/**
 * The identity of a persistent FUND, as opposed to the identity of an
 * envelope ROW: its type plus its trimmed, lower-cased name.
 *
 * A persistent envelope is meant to be ONE row for ever, but real households
 * arrive with more: this app's own imports created the fund "Saving" once per
 * budget period, so one household carries 18 live `savings` rows for a single
 * fund. Nothing in the schema forbids it (there is no unique index on
 * household+type+name, and adding one is a migration this round cannot make),
 * so the rules that MOVE MONEY have to be written against the fund, not the
 * row — otherwise one month's contribution is credited once per duplicate.
 *
 * Type is part of the key because two different persistent types may legitimately
 * share a name ("Car" as a sinking fund and "Car" as a baby step are different
 * funds); name is trimmed and lower-cased because that is the same rule the
 * rest of the app uses to recognise "the same envelope" across periods, where
 * ids differ every period.
 */
export function persistentFundKey(envelope: { envelopeType: string; name: string }): string {
  return `${envelope.envelopeType}:${envelope.name.trim().toLowerCase()}`;
}

/** One persistent fund and every live envelope row that represents it. */
export interface PersistentFundGroup<T> {
  key: string;
  /**
   * The ONE row of the group that carries the fund's money: the earliest
   * `createdAt`, ties broken by the lowest `id`.
   */
  representative: T;
  /** Every live, non-archived row of the group — `representative` included. */
  members: T[];
}

/**
 * Groups live persistent envelopes into FUNDS (see `persistentFundKey`) and
 * picks the one row of each group that carries that fund's period
 * contribution.
 *
 * The choice must be DETERMINISTIC ACROSS DEVICES, because the contribution's
 * id is derived from the chosen envelope's id (`periodContributionId`): two
 * phones rolling the same period over offline have to pick the same row, or
 * they write two differently-keyed rows for one month and the fund is funded
 * twice as soon as they sync. `createdAt` and `id` are both SYNCED columns
 * with identical values on every device, and neither changes afterwards, so
 * "earliest `createdAt`, then lowest `id`" is stable over time as well as
 * across devices: a duplicate created LATER (the import's next period, say)
 * never displaces the row already carrying the fund, which keeps replays
 * idempotent. Ordering by, for instance, the newest `periodStart` would move
 * the carrier every period and re-key the contribution with it.
 *
 * Archived rows are excluded by `isPersistentEnvelope`, so an archived
 * duplicate can never become the carrier of a live fund.
 */
export function groupPersistentFunds<
  T extends {
    id: string;
    name: string;
    envelopeType: string;
    isArchived: boolean;
    createdAt: string;
  },
>(rows: T[]): PersistentFundGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (!isPersistentEnvelope(row)) continue;
    const key = persistentFundKey(row);
    const members = groups.get(key);
    if (members) members.push(row);
    else groups.set(key, [row]);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, members]) => {
      const ordered = [...members].sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0
          : a.createdAt < b.createdAt
            ? -1
            : 1,
      );
      return { key, representative: ordered[0], members: ordered };
    });
}

/**
 * Builds the snake_case contribution row the synced-write path expects.
 *
 * The column set here is FROZEN to what migration 0016 / supabase 0008
 * already shipped. A new key would not merely need a migration: the SHIPPED
 * 1.1.130 puller builds its `INSERT OR IGNORE` straight from the pulled
 * payload's keys (`SyncEngine.applyOne`) with no intersection against the
 * local table's real columns — that intersection exists only in the
 * dead-letter discard path. So a single unknown key on a pulled row throws
 * "table envelope_contributions has no column named …", rolls the whole
 * batch back, and after the retry cap leaves that household PULL-BLOCKED
 * until the device is updated. Anything new a contribution needs to carry
 * must therefore be encoded in `source`, or kept out of the synced payload
 * entirely (see `AdjustSavedBalanceUseCase`'s reason note, which lives in the
 * local audit log).
 */
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
 * The same existence check as `findExistingContributionIds`, but against an
 * ALREADY-OPEN transaction handle (`uow.db`) using raw `sql` so it works on
 * the bare `PortableDb` a unit of work hands out.
 *
 * This is the "insert-if-absent INSIDE the unit of work" half of
 * `ensureOpeningBalances`' race safety (SEC2-5): a pre-transaction SELECT can
 * be stale by the time the transaction opens, and SQLite serialises write
 * transactions, so re-reading here is what makes three concurrent callers
 * write exactly one row instead of two of them dying on a PK conflict.
 */
function findExistingContributionIdsWithin(tx: PortableDb, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql.raw(', '),
  );
  const rows = tx.all(sql`SELECT id FROM envelope_contributions WHERE id IN (${idList})`) as {
    id: string;
  }[];
  return new Set(rows.map((row) => row.id));
}

/** An `opening_balance` row that already exists for some envelope. */
interface ExistingOpeningRow {
  /** The contribution row's own id — compared against `openingContributionId`. */
  id: string;
  amountCents: number;
  isDeleted: boolean;
}

/**
 * The `opening_balance` row each of `envelopeIds` already has, read from
 * inside the unit of work.
 *
 * Keyed by ENVELOPE, not by contribution id, and deliberately including
 * SOFT-DELETED rows — that is the whole point (REG-4 follow-up, bug 2). The
 * backfill used to ask only "does a row with the id I am about to write
 * exist?", which is blind to an opening row that reached this device any
 * other way: an import, a restore, or any writer that did not use
 * `openingContributionId`. The real household's 18 imported opening rows are
 * exactly that, so the backfill wrote a SECOND opening row beside each of
 * them and doubled every fund's saved balance. An envelope may have at most
 * ONE opening balance, ever, so existence is now decided by the fact that one
 * EXISTS for that envelope.
 *
 * Soft-deleted counts as existing: the row is append-only and its id is
 * deterministic, so re-inserting could never restore it anyway
 * (`ON CONFLICT (id) DO NOTHING` / `INSERT OR IGNORE`) — it could only ever
 * add a SECOND, differently-keyed row. A user who deleted an opening balance
 * on purpose, and a tombstone that arrived by sync, must both stay deleted
 * rather than come back under a new id on the next app foreground.
 *
 * At most one row per envelope is returned; if a household already carries
 * several (written before this guard existed), the live one wins, then the
 * lowest id, so every device resolves the same row.
 */
function findOpeningBalanceRowsWithin(
  tx: PortableDb,
  householdId: string,
  envelopeIds: string[],
): Map<string, ExistingOpeningRow> {
  const result = new Map<string, ExistingOpeningRow>();
  if (envelopeIds.length === 0) return result;
  const idList = sql.join(
    envelopeIds.map((id) => sql`${id}`),
    sql.raw(', '),
  );
  const rows = tx.all(
    sql`SELECT id, envelope_id, amount_cents, deleted_at
        FROM envelope_contributions
        WHERE household_id = ${householdId}
          AND source = 'opening_balance'
          AND envelope_id IN (${idList})
        ORDER BY (deleted_at IS NULL) DESC, id ASC`,
  ) as { id: string; envelope_id: string; amount_cents: number; deleted_at: string | null }[];
  for (const row of rows) {
    if (result.has(row.envelope_id)) continue;
    result.set(row.envelope_id, {
      id: row.id,
      amountCents: row.amount_cents,
      isDeleted: row.deleted_at !== null,
    });
  }
  return result;
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
 *
 * MARKER rows (`monthly_confirmed`) are excluded: they carry no money and are
 * keyed to whatever period the user happened to confirm in, so counting one
 * as "already funded" would silently skip that period's real contribution.
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
        ne(envelopeContributions.source, 'monthly_confirmed'),
        isNull(envelopeContributions.deletedAt),
      ),
    );
  return new Set(rows.map((row) => row.envelopeId));
}

/** Envelope ids of `householdId` with at least one non-deleted contribution row of `source`. */
export async function findEnvelopeIdsWithSource(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  source: ContributionSource,
): Promise<Set<string>> {
  const rows = await db
    .select({ envelopeId: envelopeContributions.envelopeId })
    .from(envelopeContributions)
    .where(
      and(
        eq(envelopeContributions.householdId, householdId),
        eq(envelopeContributions.source, source),
        isNull(envelopeContributions.deletedAt),
      ),
    );
  return new Set(rows.map((row) => row.envelopeId));
}

/**
 * How a persistent envelope's MONTHLY contribution currently stands — the
 * shape the rollover wizard's "Savings contributions" section renders.
 */
export interface PersistentEnvelopeContributionState {
  id: string;
  name: string;
  envelopeType: EnvelopeType;
  /**
   * The monthly contribution on the envelope row. 0 for a LEGACY envelope
   * whose amount has not been confirmed yet — the legacy number it used to
   * carry is money already saved and now lives in its `opening_balance` row.
   */
  monthlyCents: number;
  /** True while this envelope's monthly amount is still unknown — ASK the user. */
  needsMonthlyConfirmation: boolean;
}

/**
 * Every non-archived PERSISTENT envelope of `householdId` with its monthly
 * contribution and whether we still need to ask the user what that amount is.
 *
 * "Legacy" is recognised by DATA, not by a client-side date comparison: an
 * envelope is legacy exactly when it has an `opening_balance` contribution
 * row, which is a synced fact every device and every client version agrees
 * on. `needsMonthlyConfirmation` is then simply "legacy, and no
 * `monthly_confirmed` marker yet".
 */
export async function loadPersistentContributionState(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
): Promise<PersistentEnvelopeContributionState[]> {
  const rows = await db
    .select()
    .from(envelopes)
    .where(and(eq(envelopes.householdId, householdId), isNull(envelopes.deletedAt)));

  const persistent = rows.filter((row) =>
    isPersistentEnvelope({ envelopeType: row.envelopeType, isArchived: row.isArchived }),
  );
  if (persistent.length === 0) return [];

  const legacy = await findEnvelopeIdsWithSource(db, householdId, 'opening_balance');
  const confirmed = await findEnvelopeIdsWithSource(db, householdId, 'monthly_confirmed');

  return persistent.map((row) => ({
    id: row.id,
    name: row.name,
    envelopeType: row.envelopeType as EnvelopeType,
    monthlyCents: row.allocatedCents,
    needsMonthlyConfirmation: legacy.has(row.id) && !confirmed.has(row.id),
  }));
}

/**
 * Records the user's answer to "how much do you put into this fund each
 * month?": sets the envelope's `allocatedCents` and writes the one-off
 * `monthly_confirmed` MARKER row, in ONE unit of work.
 *
 * The marker is what makes the answer DURABLE and CONVERGENT without a server
 * schema change. `ensureOpeningBalances` re-zeroes any legacy envelope whose
 * amount is still unknown, on every device, every run — so without a synced
 * "the user answered" fact, a second device would simply wipe the amount the
 * first device's user had just typed. An append-only, deterministic-id
 * contribution row is the right carrier for that fact: `apply_one_op` applies
 * it `ON CONFLICT (id) DO NOTHING`, so two devices confirming the same
 * envelope converge on one row with no last-write-wins fight, older clients
 * that do not know the source value simply sum its `amount_cents` of 0 and
 * are unaffected, and no column had to change on either side of the wire.
 *
 * `monthlyCents` of 0 is a legitimate answer ("I don't put anything in each
 * month") and still writes the marker, so the wizard stops asking.
 */
export async function confirmMonthlyContribution(
  db: ExpoSQLiteDatabase<typeof schema>,
  input: {
    householdId: string;
    envelopeId: string;
    monthlyCents: number;
    /** The period the confirmation was made in — the marker's `period_start`. */
    periodStart: string;
    currentMonthlyCents: number;
  },
  deps: SyncWriteDeps = {},
): Promise<Result<{ confirmed: boolean }>> {
  if (!Number.isSafeInteger(input.monthlyCents) || input.monthlyCents < 0) {
    return createFailure({
      code: 'INVALID_AMOUNT',
      message: 'Monthly contribution must be a whole number of cents, zero or more',
    });
  }

  try {
    const ctx = resolveSyncedRepoCtx(deps);
    const now = ctx.clock();
    const markerId = monthlyConfirmedContributionId(input.householdId, input.envelopeId);

    runInUnitOfWork(db, (uow) => {
      if (input.monthlyCents !== input.currentMonthlyCents) {
        updateRowWithinUow(
          uow,
          'envelopes',
          input.envelopeId,
          input.householdId,
          { allocated_cents: input.monthlyCents, updated_at: now },
          ctx,
        );
      }
      if (!findExistingContributionIdsWithin(uow.db, [markerId]).has(markerId)) {
        insertRowWithinUow(
          uow,
          'envelope_contributions',
          buildContributionRow({
            id: markerId,
            householdId: input.householdId,
            envelopeId: input.envelopeId,
            // A MARKER, not money: it must never move the saved balance.
            amountCents: 0,
            periodStart: input.periodStart,
            source: 'monthly_confirmed',
            now,
          }),
          ctx,
        );
      }
    });

    return createSuccess({ confirmed: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return createFailure({ code: 'DB_ERROR', message });
  }
}

export interface EnsureOpeningBalancesOutput {
  /** Number of `opening_balance` rows newly written by this call. */
  count: number;
  /**
   * Number of LEGACY envelopes whose `allocatedCents` was moved into the
   * ledger and reset to 0 by this call ("monthly amount not known yet").
   */
  zeroedCount: number;
}

/**
 * Best-effort "push and pull everything we have before we write" round.
 *
 * SEC2-5: every write below carries a DETERMINISTIC id, and `apply_one_op`
 * applies an insert `ON CONFLICT (id) DO NOTHING` while the puller applies it
 * `INSERT OR IGNORE`. That makes a duplicate id harmless, but it also means
 * the AMOUNT is decided by whichever device wrote first and can never be
 * corrected: a device that backfills (or rolls over) before its first pull
 * has completed computes its amount from a stale local envelope row, and both
 * sides then keep their own figure forever. Syncing first is the client half
 * of the fix — it makes the local envelope rows current before any amount is
 * derived from them.
 *
 * Rejection is EXPECTED and ignored: offline, signed out, or booted before
 * the scheduler exists. The write must still happen in those cases — a fund
 * that shows nothing until the network comes back is worse than one that may
 * need the server-side half of the fix to converge.
 */
async function syncBeforeDerivingAmounts(householdId: string): Promise<void> {
  try {
    await requestSyncNow(householdId);
  } catch {
    // Offline / not signed in / scheduler not started — proceed with local state.
  }
}

/**
 * In-flight `ensureOpeningBalances` calls, keyed by household.
 *
 * The dashboard fires this three times concurrently on first mount
 * (`usePersistentEnvelopeSavings`, `DashboardScreen`'s focus effect and
 * `useBabySteps`' reconcile). Each call used to read "no opening row exists"
 * before any of them had written, so two of the three lost the PK race and
 * surfaced a DB_ERROR — which the hook turns into a load error on a screen
 * that is otherwise fine. Coalescing here means the second and third caller
 * AWAIT the first call's result instead of racing it; the in-transaction
 * existence re-check below covers the writes this map cannot see (another
 * process, or a pulled row landing mid-call).
 */
const inFlightOpeningBalances = new Map<string, Promise<Result<EnsureOpeningBalancesOutput>>>();

/**
 * Writes the one-off `opening_balance` contribution for every LEGACY
 * persistent envelope of `householdId` that does not have one yet (see
 * `LEGACY_OPENING_BALANCE_CUTOFF` for who qualifies and why), and leaves that
 * envelope's `allocatedCents` at 0 in the SAME unit of work.
 *
 * Why the zeroing (REG-4). On a legacy envelope the old `allocatedCents` was
 * the SAVED figure — an emergency fund reading R10,000 had R10,000 in it, not
 * a R10,000/month contribution. Carrying that number into the ledger as an
 * opening balance is correct, but leaving it in the column as well means the
 * very same R10,000 is ALSO read as this month's contribution: it inflates
 * the dashboard's "Budget"/"To assign" figures, and every rollover adds
 * another R10,000 to the fund (R20,000, R30,000 …) so Baby Step 3 completes
 * on money that was never saved. Moving the number — ledger row in, column to
 * 0 — is the only reading under which both figures are true, and it fixes
 * every reader at once (budget totals, rollover funding, baby steps, the
 * forecaster) because they all already treat `allocatedCents` on a persistent
 * envelope as the monthly contribution.
 *
 * Zero means "not known yet", not "zero rands": the rollover wizard's
 * "Savings contributions" section asks the user for the real monthly amount
 * and records the answer through `confirmMonthlyContribution`, whose
 * `monthly_confirmed` marker is what stops this function re-zeroing it.
 *
 * Devices already on 1.1.130 wrote their opening rows WITHOUT zeroing, so the
 * same pass corrects them: a legacy envelope whose OWN opening row (the one
 * under `openingContributionId`) is still live and still holds exactly what
 * the column holds has an unfinished move, and is zeroed here. Both devices
 * therefore converge on the same state — and because zeroing is an idempotent
 * "set to 0" rather than an arithmetic delta, a device applying the other's
 * update op lands on exactly the same value.
 *
 * THE INVARIANT (bug 2): an envelope gets AT MOST ONE `opening_balance`
 * contribution, ever. Once one exists — live or soft-deleted, written by this
 * app or by an import — that envelope's legacy migration is OVER: no second
 * opening row is written, and its `allocatedCents` is a MONTHLY contribution
 * that must never again be reinterpreted as a saved balance. The check that
 * enforces it is VALUE-based (`findOpeningBalanceRowsWithin`, keyed by
 * envelope) precisely because the id-based check it replaces could not see an
 * opening row written by anyone else, which is how the real household's 18
 * imported opening rows each got a duplicate and doubled their fund.
 *
 * Deliberately a SYNCED write rather than a SQL backfill inside migration
 * 0016: a migration only ever runs on the device that upgraded, so its rows
 * would never reach the oplog — a second device that restores from the server
 * would then show every legacy fund short by its whole opening balance.
 * Writing through the unit of work replicates it once, and the deterministic
 * id makes the duplicate a no-op on every other device
 * (`apply_one_op` inserts `ON CONFLICT (id) DO NOTHING`).
 *
 * Idempotent, race-safe and safe to call on every app foreground: concurrent
 * calls for the same household share one promise, existence is re-checked
 * inside the transaction, and a second call writes nothing.
 */
export function ensureOpeningBalances(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  deps: SyncWriteDeps = {},
): Promise<Result<EnsureOpeningBalancesOutput>> {
  const existing = inFlightOpeningBalances.get(householdId);
  if (existing) return existing;

  const run = runEnsureOpeningBalances(db, householdId, deps).finally(() => {
    inFlightOpeningBalances.delete(householdId);
  });
  inFlightOpeningBalances.set(householdId, run);
  return run;
}

async function runEnsureOpeningBalances(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  deps: SyncWriteDeps,
): Promise<Result<EnsureOpeningBalancesOutput>> {
  try {
    await syncBeforeDerivingAmounts(householdId);

    const candidates = await db
      .select()
      .from(envelopes)
      .where(and(eq(envelopes.householdId, householdId), isNull(envelopes.deletedAt)));

    const funded = candidates.filter(isContributingEnvelope);
    if (funded.length === 0) {
      return createSuccess({ count: 0, zeroedCount: 0 });
    }

    const alreadyOpened = await findEnvelopeIdsWithSource(db, householdId, 'opening_balance');
    const confirmed = await findEnvelopeIdsWithSource(db, householdId, 'monthly_confirmed');
    // An `initial` row is PROOF that this envelope was created by a client
    // that already understands `allocatedCents` as a monthly contribution and
    // funded its creation period accordingly — so that number was never a
    // saved balance and must not be backfilled a second time. This matters
    // for the last hours before the cutoff, where a fund created by the new
    // client would otherwise be born legacy and count its allocation twice.
    const selfFunded = await findEnvelopeIdsWithSource(db, householdId, 'initial');

    // CANDIDATES only: born before the cutoff (may still need its opening row
    // written), OR already carrying an opening row (a 1.1.130 device wrote it,
    // without zeroing). Which of them actually gets a row written, and which
    // gets its column zeroed, is decided inside the transaction below from
    // the opening rows that really exist — a pre-transaction read cannot be
    // trusted for either (SEC2-5), and "has an opening row" no longer implies
    // "this client wrote it".
    const legacy = funded.filter(
      (row) =>
        !selfFunded.has(row.id) &&
        (row.createdAt < LEGACY_OPENING_BALANCE_CUTOFF || alreadyOpened.has(row.id)),
    );
    if (legacy.length === 0) {
      return createSuccess({ count: 0, zeroedCount: 0 });
    }

    const ctx = resolveSyncedRepoCtx(deps);
    const now = ctx.clock();

    let count = 0;
    let zeroedCount = 0;
    runInUnitOfWork(db, (uow: UnitOfWork) => {
      const existingOpening = findOpeningBalanceRowsWithin(
        uow.db,
        householdId,
        legacy.map((row) => row.id),
      );

      legacy.forEach((envelope) => {
        const id = openingContributionId(householdId, envelope.id);
        const existing = existingOpening.get(envelope.id);
        if (!existing) {
          insertRowWithinUow(
            uow,
            'envelope_contributions',
            buildContributionRow({
              id,
              householdId,
              envelopeId: envelope.id,
              amountCents: envelope.allocatedCents,
              // The period the envelope was created in — the period whose
              // income the legacy allocation was assigned from.
              periodStart: envelope.periodStart,
              source: 'opening_balance',
              now,
            }),
            ctx,
          );
          count += 1;
        }

        // Zeroing is the second half of MOVING the number (ledger row in,
        // column out), so it may only happen while that move is demonstrably
        // still in progress: either this call just wrote the opening row, or
        // the opening row is the one WE key and still holds exactly what the
        // column holds — the 1.1.130 state, where the row was written and the
        // column never cleared.
        //
        // Any other shape means the move is FINISHED and the column has since
        // been given a new meaning, so re-reading it as a legacy balance
        // would be wrong twice over: it would delete a monthly contribution
        // the user is entitled to (the fund then receives nothing at
        // rollover) and, before this guard existed, bank that same number a
        // second time as savings. That covers an opening row this app did not
        // write (an import's, a restore's — the real household's 18), a
        // soft-deleted one, and a column the user has since re-typed.
        const moveIncomplete =
          !existing ||
          (!existing.isDeleted &&
            existing.id === id &&
            existing.amountCents === envelope.allocatedCents);

        if (moveIncomplete && !confirmed.has(envelope.id)) {
          updateRowWithinUow(
            uow,
            'envelopes',
            envelope.id,
            householdId,
            { allocated_cents: 0, updated_at: now },
            ctx,
          );
          zeroedCount += 1;
        }
      });
    });

    return createSuccess({ count, zeroedCount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return createFailure({ code: 'DB_ERROR', message });
  }
}
