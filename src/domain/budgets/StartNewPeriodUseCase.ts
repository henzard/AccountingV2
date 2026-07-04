import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { envelopeScopeCondition } from '../../data/local/balances/EnvelopeBalanceQuery';
import { getEnvelopeScope } from '../envelopes/EnvelopeEntity';
import type { EnvelopeType } from '../envelopes/EnvelopeEntity';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';
import { uuidv5, APP_NAMESPACE } from '../../infrastructure/crypto/uuidv5';

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
 * `emergency_fund` | `savings` | `baby_step`) are never touched here — they
 * already carry across periods unchanged (same row, all-time derived
 * balance), so "copying" them forward would create a duplicate row.
 *
 * Determinism / idempotency: each copy's id is
 * `uuidv5(household:toPeriodStart:sourceId, APP_NAMESPACE)` — NOT a random
 * id. Two offline devices independently rolling over the same
 * `fromPeriodStart -> toPeriodStart` transition for the same household
 * therefore compute the IDENTICAL target id for the same source envelope,
 * so when their oplogs eventually sync they converge on one row instead of
 * duplicating it. Re-running `execute` (e.g. after a crash, or a second
 * device replaying the same rollover) is safe: any target id that already
 * exists is skipped rather than re-inserted or thrown on.
 */
export class StartNewPeriodUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(input: StartNewPeriodInput): Promise<Result<StartNewPeriodOutput>> {
    const { householdId, fromPeriodStart, toPeriodStart } = input;

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

    if (sourceEnvelopes.length === 0) {
      return createSuccess({ count: 0 });
    }

    const targetIds = sourceEnvelopes.map((source) =>
      rolloverEnvelopeId(householdId, toPeriodStart, source.id),
    );

    // Idempotency check: a target id that already exists means this exact
    // source-envelope -> target-period copy was already made (by this
    // device or another, now synced), so it must be skipped rather than
    // re-inserted (which would throw on the primary key) or duplicated.
    const existingRows = await this.db
      .select({ id: envelopes.id })
      .from(envelopes)
      .where(inArray(envelopes.id, targetIds));
    const existingIds = new Set(existingRows.map((row) => row.id));

    const repo = resolveSyncedRepo(this.db, 'envelopes', this.deps);
    const ctx = resolveSyncedRepoCtx(this.deps);
    const now = ctx.clock();

    let count = 0;
    sourceEnvelopes.forEach((source, index) => {
      const targetId = targetIds[index];
      if (existingIds.has(targetId)) return;

      const row: Record<string, unknown> = {
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
      };

      repo.insert(row, ctx);
      count += 1;
    });

    return createSuccess({ count });
  }
}
