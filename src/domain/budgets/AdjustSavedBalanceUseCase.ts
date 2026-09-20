import { randomUUID } from 'expo-crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { getPersistentEnvelopeSavedCents } from '../../data/local/balances/EnvelopeBalanceQuery';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
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

    // A fund cannot hold less than nothing. Checking the DERIVED balance (not
    // a stored column) keeps this honest against spend transactions and
    // earlier adjustments alike.
    const savedBefore =
      (await getPersistentEnvelopeSavedCents(this.db, input.householdId)).get(input.envelopeId) ??
      0;
    const savedCentsAfter = savedBefore + input.deltaCents;
    if (savedCentsAfter < 0) {
      return createFailure({
        code: 'NEGATIVE_BALANCE',
        message: 'That would take the fund below zero',
      });
    }

    const ctx = resolveSyncedRepoCtx(this.deps);
    const now = ctx.clock();
    const contributionId = ctx.genId ? ctx.genId() : randomUUID();

    const repo = resolveSyncedRepo(this.db, 'envelope_contributions', this.deps);
    repo.insert(
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
