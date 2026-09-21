import { randomUUID } from 'expo-crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import type { PortableDb } from '../../data/uow/UnitOfWork';
import { insertRowWithinUow } from '../../data/uow/createSyncedRepo';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import { bestEffortAudit } from '../shared/bestEffortAudit';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { buildContributionRow, isPersistentEnvelope } from './PersistentContributions';

export interface AdjustSavedBalanceInput {
  householdId: string;
  envelopeId: string;
  /** Cents to add (positive) or take out (negative). Never zero. */
  deltaCents: number;
  /**
   * Why. Required — a hand-typed change to a money figure without a reason
   * is not something we want in the ledger — but recorded ONLY in this
   * device's audit log, never in the synced payload. See the class doc.
   */
  note: string;
  /** ISO date (YYYY-MM-DD) of the period the adjustment is recorded against. */
  periodStart: string;
}

export interface AdjustSavedBalanceOutput {
  contributionId: string;
  /** The fund's derived saved balance AFTER this adjustment. */
  savedCentsAfter: number;
}

/** Longest reason we will store — long enough for a real sentence, short enough to render. */
const MAX_NOTE_LENGTH = 200;

/**
 * The SAME derived saved balance `getPersistentEnvelopeSavedCents` computes
 * (contributions in, transactions out, tombstones excluded), for ONE envelope
 * and against an ALREADY-OPEN transaction handle.
 *
 * It exists as a second, raw-`sql` spelling for the same reason
 * `PersistentContributions`' `findExistingContributionIdsWithin` does: the
 * shared query is `async` over the outer `db`, and a unit-of-work callback is
 * SYNCHRONOUS — it cannot await, and a value awaited before the transaction
 * opened is exactly the stale snapshot this use case must not act on.
 */
function readSavedCentsWithin(tx: PortableDb, householdId: string, envelopeId: string): number {
  const row = tx.get(sql`
    SELECT
      (SELECT COALESCE(SUM(amount_cents), 0)
         FROM envelope_contributions
        WHERE household_id = ${householdId}
          AND envelope_id = ${envelopeId}
          AND deleted_at IS NULL)
      -
      (SELECT COALESCE(SUM(amount_cents), 0)
         FROM transactions
        WHERE household_id = ${householdId}
          AND envelope_id = ${envelopeId}
          AND deleted_at IS NULL)
      AS saved_cents
  `) as { saved_cents: number } | undefined;
  return row?.saved_cents ?? 0;
}

/**
 * Manually corrects a persistent envelope's SAVED balance.
 *
 * The contribution ledger only knows about money the app itself moved
 * (rollovers, a fund's creation period, the one-off legacy opening balance),
 * so there was no way to tell it about money that was already saved before
 * the app knew — "this emergency fund has R8,000 in it from the old savings
 * account" — nor to correct it downwards after cash was taken out without a
 * transaction being logged. Until now the only workaround was to type the
 * figure into `allocatedCents`, which is exactly the MONTHLY-contribution
 * confusion the ledger exists to end (REG-7 / SEC2-15).
 *
 * The adjustment is an ordinary append-only ledger row of
 * `source = 'adjustment'`, so it flows through the same synced-write path,
 * lands in the same `SUM(amount_cents)` the saved balance is derived from,
 * and can be negative. Unlike every other contribution its id is RANDOM, not
 * deterministic: two people each correcting the same fund by the same amount
 * on the same day are two real, separate adjustments, and collapsing them
 * onto one id would silently swallow one of them.
 *
 * The reason the user types is REQUIRED but deliberately does NOT travel on
 * the row. Carrying it would mean a new `note` column, and the SHIPPED
 * 1.1.130 puller builds its insert directly from a pulled payload's keys
 * (`SyncEngine.applyOne`) without intersecting them against the local
 * table's columns — so the first adjustment to reach such a device would
 * throw, roll its batch back and pull-block that household until it updated.
 * A reason string is not worth that, so it is written to the local audit log
 * instead (`bestEffortAudit`'s `newValue`) and the synced row carries only
 * `source: 'adjustment'` and the signed amount. Anything that must be shared
 * across devices has to be encoded in `source`, which is unconstrained text
 * on both sides and therefore free to take new values.
 *
 * The "a fund cannot go below zero" guard is not a pre-flight check: the
 * derived balance is re-read and re-tested INSIDE the same
 * `runInUnitOfWork` transaction that appends the row (the pattern
 * `MoveAllocationUseCase` and `LogDebtPaymentUseCase` use for their own
 * stale-snapshot races). Read before the transaction, two quick "take out"
 * adjustments both measured the same pre-adjustment balance, both passed,
 * and the fund went negative — SQLite serialises write transactions, so
 * re-reading here is what makes the second one see the first one's row.
 */
export class AdjustSavedBalanceUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(input: AdjustSavedBalanceInput): Promise<Result<AdjustSavedBalanceOutput>> {
    const note = input.note.trim();
    if (!note) {
      return createFailure({
        code: 'INVALID_NOTE',
        message: 'Tell us why you are adjusting this amount',
      });
    }
    if (note.length > MAX_NOTE_LENGTH) {
      return createFailure({
        code: 'INVALID_NOTE',
        message: `Reason must be ${MAX_NOTE_LENGTH} characters or fewer`,
      });
    }
    if (!Number.isSafeInteger(input.deltaCents) || input.deltaCents === 0) {
      return createFailure({
        code: 'INVALID_AMOUNT',
        message: 'Enter an amount to add or take out',
      });
    }

    const [envelope] = await this.db
      .select()
      .from(envelopes)
      .where(
        and(
          eq(envelopes.id, input.envelopeId),
          eq(envelopes.householdId, input.householdId),
          isNull(envelopes.deletedAt),
        ),
      )
      .limit(1);

    if (!envelope) {
      return createFailure({ code: 'NOT_FOUND', message: 'Envelope not found' });
    }
    if (!isPersistentEnvelope(envelope)) {
      return createFailure({
        code: 'NOT_PERSISTENT',
        message:
          'Only savings, emergency fund, sinking fund and baby step envelopes hold a balance',
      });
    }

    const ctx = resolveSyncedRepoCtx(this.deps);
    const now = ctx.clock();
    const contributionId = ctx.genId ? ctx.genId() : randomUUID();

    // A fund cannot hold less than nothing. Both the DERIVED balance read
    // (not a stored column, so it stays honest against spend transactions and
    // earlier adjustments alike) and the "would this go negative?" check
    // happen INSIDE the same unit of work as the ledger insert, the way
    // `ensureOpeningBalances` re-checks existence inside its transaction.
    // Read outside, they were a snapshot two quick "take out R500"s could
    // both pass — each seeing the pre-adjustment balance, both inserting, and
    // the fund landing below zero with no failure surfaced.
    const outcome = runInUnitOfWork(this.db, (uow) => {
      const savedBefore = readSavedCentsWithin(uow.db, input.householdId, input.envelopeId);
      const savedCentsAfter = savedBefore + input.deltaCents;
      if (savedCentsAfter < 0) {
        // Nothing has been written yet, so returning here commits an empty
        // transaction rather than needing a throw to roll anything back.
        return { allowed: false as const };
      }

      insertRowWithinUow(
        uow,
        'envelope_contributions',
        buildContributionRow({
          id: contributionId,
          householdId: input.householdId,
          envelopeId: input.envelopeId,
          amountCents: input.deltaCents,
          periodStart: input.periodStart,
          source: 'adjustment',
          now,
        }),
        ctx,
      );

      return { allowed: true as const, savedBefore, savedCentsAfter };
    });

    if (!outcome.allowed) {
      return createFailure({
        code: 'NEGATIVE_BALANCE',
        message: 'That would take the fund below zero',
      });
    }
    const { savedBefore, savedCentsAfter } = outcome;

    // The ledger write above has already committed — audit logging is a
    // secondary concern that must not fail an otherwise-successful
    // adjustment. It is also the ONLY place the reason is kept (see the class
    // doc): local to this device, never synced.
    await bestEffortAudit(this.audit, {
      householdId: input.householdId,
      entityType: 'envelope_contribution',
      entityId: contributionId,
      action: 'create',
      previousValue: { savedCents: savedBefore },
      newValue: {
        savedCents: savedCentsAfter,
        envelopeId: input.envelopeId,
        deltaCents: input.deltaCents,
        note,
      },
    });

    return createSuccess({ contributionId, savedCentsAfter });
  }
}
