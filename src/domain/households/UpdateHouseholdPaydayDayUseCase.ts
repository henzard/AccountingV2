import { randomUUID } from 'expo-crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopeContributions, envelopes, households } from '../../data/local/schema';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import { updateRowWithinUow } from '../../data/uow/createSyncedRepo';
import { getEnvelopeScope } from '../envelopes/EnvelopeEntity';
import type { EnvelopeType } from '../envelopes/EnvelopeEntity';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../shared/BudgetPeriodEngine';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

export interface UpdatePaydayDayOutput {
  /** The current period's key BEFORE the change (null when the household row was missing). */
  fromPeriodStart: string | null;
  /** The current period's key AFTER the change. */
  toPeriodStart: string;
  /** Envelopes re-keyed onto `toPeriodStart`. */
  reKeyedEnvelopeCount: number;
  /**
   * Envelopes deliberately LEFT on `fromPeriodStart` because an envelope with
   * the same name and type already exists under `toPeriodStart` — see the
   * collision rule on `execute`.
   */
  collidedEnvelopeCount: number;
  /** Contribution rows re-keyed onto `toPeriodStart`. */
  reKeyedContributionCount: number;
}

/** The identity two envelopes must share to be "the same envelope" for collision purposes. */
function envelopeIdentity(name: string, envelopeType: string): string {
  return JSON.stringify([name, envelopeType]);
}

const engine = new BudgetPeriodEngine();

/**
 * Changes the household's payday AND moves the current budget period's rows
 * onto the period key that payday now implies.
 *
 * Why the move is part of this use case: `period_start` is an EXACT-MATCH
 * scope key (`envelopeScopeCondition`), and the current period's key is a
 * pure function of `payday_day` and today's date. Changing `payday_day` alone
 * — all this use case used to do — therefore silently orphans every
 * period-scoped envelope the household has: they keep the key the OLD payday
 * implied, the dashboard queries the key the NEW payday implies, and the
 * user's whole budget vanishes. That is exactly what onboarding did, creating
 * envelopes in `AllocateEnvelopesStep` and then changing payday in
 * `PaydayStep` one screen later (UX-5/DOM-6).
 *
 * Scope of the move — only what the key change actually invalidates:
 *  - PERIOD-scoped envelopes (`spending` | `income` | `utility`) whose
 *    `period_start` is the OLD current-period key. Earlier periods' rows are
 *    history and keep their keys; PERSISTENT envelopes have no meaningful
 *    `period_start` to begin with (`envelopeScopeCondition` ignores it) and
 *    are never touched.
 *  - `envelope_contributions` rows keyed to the OLD current-period key, so
 *    "this period already funded the emergency fund" stays true under the new
 *    key and `StartNewPeriodUseCase` cannot fund the same period a second
 *    time after a payday change.
 *
 * COLLISION RULE: if an envelope with the same `name` and `envelope_type`
 * already exists (non-deleted) under the NEW key, the old-key row is LEFT
 * WHERE IT IS and counted in `collidedEnvelopeCount`. It is never merged
 * (that would silently add two user-entered allocations together) and never
 * deleted (that would destroy money and its transactions' envelope). The row
 * already sitting under the new key IS the current period's envelope for that
 * category; the old-key row is simply the previous period's history, which is
 * what a period-scoped envelope is supposed to become when its period ends.
 *
 * Every write goes through the unit of work / oplog path in ONE transaction,
 * so the payday and the re-key replicate together or not at all — a device
 * that received the payday change without the re-key would render the same
 * empty budget this use case exists to prevent.
 */
export class UpdateHouseholdPaydayDayUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly householdId: string,
    private readonly paydayDay: number,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<UpdatePaydayDayOutput>> {
    if (this.paydayDay < 1 || this.paydayDay > 28) {
      return createFailure({
        code: 'INVALID_PAYDAY',
        message: 'Payday day must be between 1 and 28',
      });
    }

    const ctx = resolveSyncedRepoCtx(this.deps);
    const now = ctx.clock();
    // The clock seam is also the reference date for both period boundaries, so
    // the OLD and NEW keys are computed against the SAME instant — computing
    // them from two different `new Date()` calls could straddle midnight and
    // move rows onto a key for a period that is not actually current.
    const referenceDate = new Date(now);

    const [householdRow] = await this.db
      .select({ paydayDay: households.paydayDay })
      .from(households)
      .where(eq(households.id, this.householdId));

    const toPeriodStart = formatPeriodDateKey(
      engine.getCurrentPeriod(this.paydayDay, referenceDate).startDate,
    );
    const fromPeriodStart =
      householdRow === undefined
        ? null
        : formatPeriodDateKey(
            engine.getCurrentPeriod(householdRow.paydayDay, referenceDate).startDate,
          );

    const needsReKey = fromPeriodStart !== null && fromPeriodStart !== toPeriodStart;

    const envelopesToReKey = needsReKey
      ? (
          await this.db
            .select()
            .from(envelopes)
            .where(
              and(
                eq(envelopes.householdId, this.householdId),
                eq(envelopes.periodStart, fromPeriodStart),
                isNull(envelopes.deletedAt),
              ),
            )
        ).filter(
          (row) =>
            getEnvelopeScope({ envelopeType: row.envelopeType as EnvelopeType }) === 'period',
        )
      : [];

    const occupiedIdentities = new Set<string>();
    if (envelopesToReKey.length > 0) {
      const existingAtTarget = await this.db
        .select({ name: envelopes.name, envelopeType: envelopes.envelopeType })
        .from(envelopes)
        .where(
          and(
            eq(envelopes.householdId, this.householdId),
            eq(envelopes.periodStart, toPeriodStart),
            isNull(envelopes.deletedAt),
          ),
        );
      for (const row of existingAtTarget) {
        occupiedIdentities.add(envelopeIdentity(row.name, row.envelopeType));
      }
    }

    const movableEnvelopes = envelopesToReKey.filter(
      (row) => !occupiedIdentities.has(envelopeIdentity(row.name, row.envelopeType)),
    );

    const contributionsToReKey = needsReKey
      ? await this.db
          .select({ id: envelopeContributions.id })
          .from(envelopeContributions)
          .where(
            and(
              eq(envelopeContributions.householdId, this.householdId),
              eq(envelopeContributions.periodStart, fromPeriodStart),
              isNull(envelopeContributions.deletedAt),
            ),
          )
      : [];

    runInUnitOfWork(this.db, (uow) => {
      // `households` has no `household_id` column (see CreateHouseholdUseCase's
      // matching comment) — a household's own `id` IS its scope — so this
      // drives the unit of work directly rather than `updateRowWithinUow`,
      // which always scopes its WHERE clause by a `household_id` column.
      uow.db.run(sql`
        UPDATE households SET payday_day = ${this.paydayDay}, updated_at = ${now}
        WHERE id = ${this.householdId}
      `);
      uow.appendOp({
        opId: ctx.genId ? ctx.genId() : randomUUID(),
        householdId: this.householdId,
        tableName: 'households',
        rowId: this.householdId,
        opType: 'update',
        payload: { payday_day: this.paydayDay, updated_at: now },
        actorUserId: ctx.actorUserId,
        deviceId: ctx.deviceId,
        clientCreatedAt: ctx.clock(),
      });

      for (const envelope of movableEnvelopes) {
        updateRowWithinUow(
          uow,
          'envelopes',
          envelope.id,
          this.householdId,
          { period_start: toPeriodStart, updated_at: now },
          ctx,
        );
      }

      for (const contribution of contributionsToReKey) {
        updateRowWithinUow(
          uow,
          'envelope_contributions',
          contribution.id,
          this.householdId,
          { period_start: toPeriodStart, updated_at: now },
          ctx,
        );
      }
    });

    return createSuccess({
      fromPeriodStart,
      toPeriodStart,
      reKeyedEnvelopeCount: movableEnvelopes.length,
      collidedEnvelopeCount: envelopesToReKey.length - movableEnvelopes.length,
      reKeyedContributionCount: contributionsToReKey.length,
    });
  }
}
