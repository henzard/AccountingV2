import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { envelopeScopeCondition } from '../../data/local/balances/EnvelopeBalanceQuery';
import { getEnvelopeScope } from '../envelopes/EnvelopeEntity';
import type { EnvelopeType } from '../envelopes/EnvelopeEntity';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import { insertRowWithinUow } from '../../data/uow/createSyncedRepo';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { uuidv5, APP_NAMESPACE } from '../../infrastructure/crypto/uuidv5';
import { requestSyncNow } from '../../data/sync/syncRuntime';
import {
  buildContributionRow,
  ensureOpeningBalances,
  findExistingContributionIds,
  findFundedEnvelopeIdsForPeriod,
  groupPersistentFunds,
  isContributingEnvelope,
  periodContributionId,
} from './PersistentContributions';

export interface StartNewPeriodInput {
  householdId: string;
  /** ISO date (YYYY-MM-DD) of the period being rolled FROM. */
  fromPeriodStart: string;
  /** ISO date (YYYY-MM-DD) of the period being rolled TO. */
  toPeriodStart: string;
}

export interface StartNewPeriodOutput {
  /** Number of envelopes newly copied forward into `toPeriodStart`. */
  count: number;
  /**
   * Number of PERSISTENT FUNDS newly funded for `toPeriodStart` — one
   * `envelope_contributions` row each, counting duplicate rows of the same
   * fund once (see `groupPersistentFunds`). 0 on a replayed rollover, since
   * the deterministic contribution ids already exist.
   */
  contributionCount: number;
  /** Total cents moved into persistent envelopes by this rollover. */
  contributedCents: number;
}

/**
 * True if `envelope` is a PERIOD-scoped, non-archived envelope — the exact
 * source-envelope selection `StartNewPeriodUseCase.execute` copies forward.
 * Exported so any caller that needs to preview or reference this same set
 * before the use case runs (e.g. `RolloverWizard`'s review step) imports
 * this predicate instead of re-deriving it — a second, independent copy of
 * this logic would silently drift from the use case's actual selection if
 * either changed without the other.
 */
export function isRolloverSource(envelope: { envelopeType: string; isArchived: boolean }): boolean {
  return (
    !envelope.isArchived &&
    getEnvelopeScope({ envelopeType: envelope.envelopeType as EnvelopeType }) === 'period'
  );
}

/**
 * The deterministic id `StartNewPeriodUseCase.execute` gives the copied-
 * forward row for `sourceId` when rolling `householdId` into `toPeriodStart`
 * (see the class doc comment for why this must be a pure function of these
 * three inputs, not a random id). Exported so any caller that needs to
 * reference or mutate that target row before/around the use case call
 * (e.g. `RolloverWizard` applying a user's allocation edit right after
 * commit) computes the SAME id via this one formula, instead of a second
 * copy that could silently drift out of sync with the use case.
 */
export function rolloverEnvelopeId(
  householdId: string,
  toPeriodStart: string,
  sourceId: string,
): string {
  return uuidv5(`${householdId}:${toPeriodStart}:${sourceId}`, APP_NAMESPACE);
}

/**
 * The real period rollover: copies every non-archived, non-deleted
 * PERIOD-scoped envelope (`spending` | `income` | `utility` — see
 * `getEnvelopeScope`) of `fromPeriodStart` forward into `toPeriodStart`,
 * preserving its `allocatedCents`. PERSISTENT envelopes (`sinking_fund` |
 * `emergency_fund` | `savings` | `baby_step`) are never COPIED here — they
 * already carry across periods unchanged (same row, all-time derived
 * balance), so "copying" them forward would create a duplicate row. Instead
 * each one is FUNDED: starting the new period is the moment its monthly
 * `allocatedCents` actually becomes money in the fund, so this use case
 * appends one `envelope_contributions` row per persistent FUND per period —
 * per fund, not per row, because a household whose import created the same
 * fund once per period would otherwise have one month's saving credited once
 * per duplicate (see `groupPersistentFunds`). That is what makes a R500/month
 * fund read R1,500 after three periods instead of R500 forever, and what
 * stops Baby Step 1 from completing the instant someone types R1,000 into an
 * allocation field — a typed allocation is a pledge for the current period,
 * not savings.
 *
 * Determinism / idempotency: each copy's id is
 * `uuidv5(household:toPeriodStart:sourceId, APP_NAMESPACE)` — NOT a random
 * id. Two offline devices independently rolling over the same
 * `fromPeriodStart -> toPeriodStart` transition for the same household
 * therefore compute the IDENTICAL target id for the same source envelope,
 * so when their oplogs eventually sync they converge on one row instead of
 * duplicating it. Re-running `execute` (e.g. after a crash, or a second
 * device replaying the same rollover) is safe: any target id that already
 * exists is skipped rather than re-inserted or thrown on. Contribution rows
 * follow the identical rule via `periodContributionId`, so a double rollover
 * funds each persistent envelope exactly once.
 */
export class StartNewPeriodUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(input: StartNewPeriodInput): Promise<Result<StartNewPeriodOutput>> {
    const { householdId, fromPeriodStart, toPeriodStart } = input;

    // SEC2-5: every row this use case writes carries a DETERMINISTIC id, and
    // both `apply_one_op` (ON CONFLICT DO NOTHING) and the puller (INSERT OR
    // IGNORE) treat a duplicate id as already-applied. That makes the AMOUNT
    // permanently owned by whichever device wrote first, so a device that
    // rolls over before its first pull has landed would bake a stale
    // `allocatedCents` into the ledger with no way to correct it. Push/pull
    // first so the envelope rows these amounts are read from are current.
    // Rejection is expected offline / signed out and must not block the
    // rollover — a user on a plane still gets their new period.
    try {
      await requestSyncNow(householdId);
    } catch {
      // Offline, signed out, or booted before the scheduler exists.
    }

    // REG-4: a LEGACY persistent envelope's `allocatedCents` is a SAVED
    // balance, not a monthly contribution — funding it here is what turned a
    // R10,000 emergency fund into R20,000 on the first rollover. This moves
    // any such number into the ledger as an opening balance and leaves the
    // column at 0 until the user confirms a real monthly amount, so the
    // funding pass below simply never sees it. Idempotent and coalesced, so
    // calling it on every rollover costs one query on a normalised household.
    const opening = await ensureOpeningBalances(this.db, householdId, this.deps);
    if (!opening.success) return createFailure(opening.error);

    // `envelopeScopeCondition` also matches persistent-type rows
    // unconditionally (by design — see its doc comment), so the
    // `getEnvelopeScope(...) === 'period'` filter below is what actually
    // excludes them from copy-forward, per the scope rule this use case
    // must respect.
    const candidates = await this.db
      .select()
      .from(envelopes)
      .where(
        and(
          eq(envelopes.householdId, householdId),
          isNull(envelopes.deletedAt),
          envelopeScopeCondition(fromPeriodStart),
        ),
      );

    const sourceEnvelopes = candidates.filter((row) =>
      isRolloverSource({ envelopeType: row.envelopeType, isArchived: row.isArchived }),
    );

    // The same candidate set also carries every PERSISTENT envelope (the
    // scope condition matches those unconditionally), so the funds this
    // rollover must contribute to are read from it directly rather than by a
    // second query.
    //
    // Grouped into FUNDS rather than taken row by row: a persistent envelope
    // is supposed to be one row for ever, but this household's import created
    // the fund "Saving" once per budget period, leaving 18 live `savings`
    // rows for ONE fund. Funding each row would credit one month's saving 18
    // times on the very first press of "Start this period from last period's
    // budget". One contribution per fund per period, carried by the group's
    // deterministically chosen row (see `groupPersistentFunds`).
    const fundGroups = groupPersistentFunds(candidates);
    // The MONTHLY AMOUNT is the carrier row's own `allocatedCents`, not a sum
    // (that is the 18x bug itself) and not a max (which would let a stale
    // duplicate outrank the row the fund actually lives on). One row, one
    // meaning: the amount is exactly what a single, already-merged fund would
    // contribute, so behaviour does not change when the duplicates are
    // normalised away. A carrier holding 0 therefore contributes nothing —
    // "monthly amount not known yet" — which under-funds rather than invents
    // money, and the user can correct it in the wizard's savings section.
    const fundedGroups = fundGroups.filter((group) =>
      isContributingEnvelope({
        envelopeType: group.representative.envelopeType,
        isArchived: group.representative.isArchived,
        allocatedCents: group.representative.allocatedCents,
      }),
    );

    if (sourceEnvelopes.length === 0 && fundedGroups.length === 0) {
      return createSuccess({ count: 0, contributionCount: 0, contributedCents: 0 });
    }

    const targetIds = sourceEnvelopes.map((source) =>
      rolloverEnvelopeId(householdId, toPeriodStart, source.id),
    );

    // Idempotency check: a target id that already exists means this exact
    // source-envelope -> target-period copy was already made (by this
    // device or another, now synced), so it must be skipped rather than
    // re-inserted (which would throw on the primary key) or duplicated.
    const existingRows =
      targetIds.length === 0
        ? []
        : await this.db
            .select({ id: envelopes.id })
            .from(envelopes)
            .where(inArray(envelopes.id, targetIds));
    const existingIds = new Set(existingRows.map((row) => row.id));

    // Same idempotency rule for the funding side: a contribution id that
    // already exists means this fund was already funded for `toPeriodStart`,
    // so re-running the rollover must not fund it twice. Checked for EVERY
    // member of the group, not just the carrier: an older build (or a device
    // whose duplicate set differs) may have funded a different row of the
    // same fund, and that still means the fund has had its month.
    const groupContributionIds = fundedGroups.map((group) =>
      group.members.map((member) => periodContributionId(householdId, member.id, toPeriodStart)),
    );
    const existingContributionIds = await findExistingContributionIds(
      this.db,
      groupContributionIds.flat(),
    );
    // Second, VALUE-based guard: a contribution re-keyed onto `toPeriodStart`
    // by a payday change keeps its original id, so the id check above cannot
    // see it — see `findFundedEnvelopeIdsForPeriod`.
    const alreadyFundedEnvelopeIds = await findFundedEnvelopeIdsForPeriod(
      this.db,
      householdId,
      toPeriodStart,
    );

    const ctx = resolveSyncedRepoCtx(this.deps);
    const now = ctx.clock();

    // Build every row to copy FIRST (no writes yet), then insert them all
    // inside ONE `runInUnitOfWork` transaction below — see the class doc
    // comment. The old code called `repo.insert(row, ctx)` per envelope
    // inside this forEach; `createSyncedRepo.insert` opens its OWN
    // `runInUnitOfWork`/`db.transaction` per call, so N envelopes meant N
    // independent transactions and a mid-loop failure (or a kill) could
    // leave the new period with only SOME of its envelopes copied forward
    // (M14, 2026-07-05 audit). Using `insertRowWithinUow` directly — the
    // same primitive `ConfirmSlipUseCase` uses for its N-item atomic write —
    // makes the whole copy all-or-nothing.
    const rowsToInsert: Record<string, unknown>[] = [];
    sourceEnvelopes.forEach((source, index) => {
      const targetId = targetIds[index];
      if (existingIds.has(targetId)) return;

      rowsToInsert.push({
        id: targetId,
        household_id: householdId,
        name: source.name,
        allocated_cents: source.allocatedCents,
        envelope_type: source.envelopeType,
        // better-sqlite3 only binds numbers/strings/bigints/buffers/null —
        // not JS booleans — so the boolean columns are written as 0/1.
        is_savings_locked: source.isSavingsLocked ? 1 : 0,
        is_archived: 0,
        period_start: toPeriodStart,
        target_amount_cents: source.targetAmountCents,
        target_date: source.targetDate,
        created_at: now,
        updated_at: now,
      });
    });

    // Built alongside the envelope copies so BOTH land in the single
    // transaction below: a period that copied its envelopes forward but
    // failed to fund its sinking funds (or vice versa) is exactly the
    // half-rolled-over state the one-transaction rule exists to prevent.
    const contributionsToInsert: Record<string, unknown>[] = [];
    let contributedCents = 0;
    fundedGroups.forEach((group, index) => {
      const memberContributionIds = groupContributionIds[index];
      // Either guard hitting ANY member means the FUND has already had this
      // period's contribution — skip the whole group, not just that row.
      if (memberContributionIds.some((id) => existingContributionIds.has(id))) return;
      if (group.members.some((member) => alreadyFundedEnvelopeIds.has(member.id))) return;

      const envelope = group.representative;
      contributionsToInsert.push(
        buildContributionRow({
          id: periodContributionId(householdId, envelope.id, toPeriodStart),
          householdId,
          envelopeId: envelope.id,
          amountCents: envelope.allocatedCents,
          periodStart: toPeriodStart,
          source: 'rollover',
          now,
        }),
      );
      contributedCents += envelope.allocatedCents;
    });

    if (rowsToInsert.length === 0 && contributionsToInsert.length === 0) {
      return createSuccess({ count: 0, contributionCount: 0, contributedCents: 0 });
    }

    runInUnitOfWork(this.db, (uow) => {
      for (const row of rowsToInsert) {
        insertRowWithinUow(uow, 'envelopes', row, ctx);
      }
      for (const row of contributionsToInsert) {
        insertRowWithinUow(uow, 'envelope_contributions', row, ctx);
      }
    });

    return createSuccess({
      count: rowsToInsert.length,
      contributionCount: contributionsToInsert.length,
      contributedCents,
    });
  }
}
