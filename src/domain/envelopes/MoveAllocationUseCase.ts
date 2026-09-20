import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { getEnvelopeSpentCents } from '../../data/local/balances/EnvelopeBalanceQuery';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import { updateRowWithinUow } from '../../data/uow/createSyncedRepo';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { bestEffortAudit } from '../shared/bestEffortAudit';
import { getEnvelopeScope } from './EnvelopeEntity';
import type { EnvelopeType } from './EnvelopeEntity';

export interface MoveAllocationInput {
  householdId: string;
  /** ISO date (YYYY-MM-DD) both envelopes must belong to. */
  periodStart: string;
  fromEnvelopeId: string;
  toEnvelopeId: string;
  amountCents: number;
}

export interface MoveAllocationOutput {
  fromEnvelopeId: string;
  toEnvelopeId: string;
  amountCents: number;
  /** `from.allocatedCents` AFTER the move. */
  fromAllocatedCents: number;
  /** `to.allocatedCents` AFTER the move. */
  toAllocatedCents: number;
}

/**
 * "Cover it from another envelope" (VAL2-9): moves `amountCents` of
 * ALLOCATION — not spend — from one PERIOD-scoped envelope to another in the
 * same household and the same `periodStart`. Real envelope budgeting means an
 * overspend on one envelope can be covered by re-allocating unspent money
 * from a sibling envelope instead of just warning-and-proceeding.
 *
 * Both column writes (`from.allocated_cents -= amountCents`,
 * `to.allocated_cents += amountCents`) are absolute-value UPDATEs — not
 * `increment` ops — issued through `updateRowWithinUow` inside ONE
 * `runInUnitOfWork` transaction (the same primitive `ConfirmSlipUseCase` and
 * `StartNewPeriodUseCase` use to batch several writes atomically): either
 * both land and both oplog `update` rows are appended, or a failure on the
 * second write rolls the first back too. Nothing here writes a new synced
 * column or table — both envelopes already replicate `allocated_cents`
 * (§11: 1.1.130 devices pull-block on any unknown column/table).
 */
export class MoveAllocationUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(input: MoveAllocationInput): Promise<Result<MoveAllocationOutput>> {
    const { householdId, periodStart, fromEnvelopeId, toEnvelopeId, amountCents } = input;

    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return createFailure({
        code: 'INVALID_AMOUNT',
        message: 'Amount to move must be a positive whole number of cents',
      });
    }
    if (fromEnvelopeId === toEnvelopeId) {
      return createFailure({
        code: 'SAME_ENVELOPE',
        message: 'Cannot move an allocation to the same envelope it came from',
      });
    }

    const rows = await this.db
      .select()
      .from(envelopes)
      .where(
        and(
          eq(envelopes.householdId, householdId),
          isNull(envelopes.deletedAt),
          inArray(envelopes.id, [fromEnvelopeId, toEnvelopeId]),
        ),
      );

    const from = rows.find((row) => row.id === fromEnvelopeId);
    const to = rows.find((row) => row.id === toEnvelopeId);

    if (!from || !to) {
      return createFailure({
        code: 'ENVELOPE_NOT_FOUND',
        message: 'One or both envelopes do not exist in this household',
      });
    }
    if (from.isArchived || to.isArchived) {
      return createFailure({
        code: 'ENVELOPE_ARCHIVED',
        message: 'Cannot move an allocation to or from an archived envelope',
      });
    }
    if (from.envelopeType === 'income' || to.envelopeType === 'income') {
      return createFailure({
        code: 'INVALID_ENVELOPE_TYPE',
        message: 'Cannot move an allocation to or from an income envelope',
      });
    }
    if (
      getEnvelopeScope({ envelopeType: from.envelopeType as EnvelopeType }) !== 'period' ||
      getEnvelopeScope({ envelopeType: to.envelopeType as EnvelopeType }) !== 'period'
    ) {
      return createFailure({
        code: 'INVALID_ENVELOPE_SCOPE',
        message: 'Both envelopes must be period-scoped budget envelopes',
      });
    }
    if (from.periodStart !== periodStart || to.periodStart !== periodStart) {
      return createFailure({
        code: 'PERIOD_MISMATCH',
        message: 'Both envelopes must belong to the given budget period',
      });
    }

    // Unspent is derived, not stored: `allocated_cents - spend`, where spend
    // is the transaction-ledger sum `getEnvelopeSpentCents` already computes
    // for every reader of envelope balances (read-only — this use case never
    // writes spend).
    const spentByEnvelopeId = await getEnvelopeSpentCents(this.db, householdId, periodStart);
    const fromSpentCents = spentByEnvelopeId.get(from.id) ?? 0;
    const fromUnspentCents = from.allocatedCents - fromSpentCents;
    if (amountCents > fromUnspentCents) {
      return createFailure({
        code: 'INSUFFICIENT_UNSPENT',
        message: 'The source envelope does not have enough unspent money to cover that amount',
        context: { fromUnspentCents },
      });
    }

    const ctx = resolveSyncedRepoCtx(this.deps);
    const now = ctx.clock();
    const fromAllocatedCents = from.allocatedCents - amountCents;
    const toAllocatedCents = to.allocatedCents + amountCents;

    try {
      runInUnitOfWork(this.db, (uow) => {
        updateRowWithinUow(
          uow,
          'envelopes',
          from.id,
          householdId,
          { allocated_cents: fromAllocatedCents, updated_at: now },
          ctx,
        );
        updateRowWithinUow(
          uow,
          'envelopes',
          to.id,
          householdId,
          { allocated_cents: toAllocatedCents, updated_at: now },
          ctx,
        );
      });
    } catch {
      // Either write failing (row vanished mid-flight, a duplicate op_id
      // collision, a constraint violation, ...) rolls the WHOLE transaction
      // back — neither allocated_cents column moved, so this is surfaced as
      // an ordinary Result failure rather than an uncaught throw.
      return createFailure({
        code: 'MOVE_FAILED',
        message: 'Could not move the allocation — no money was moved',
      });
    }

    // Both writes above have already committed atomically by this point —
    // audit logging is a secondary, best-effort concern that must not fail
    // this otherwise-successful move (see bestEffortAudit).
    await bestEffortAudit(this.audit, {
      householdId,
      entityType: 'envelope',
      entityId: from.id,
      action: 'move_allocation',
      previousValue: {
        fromEnvelopeId: from.id,
        toEnvelopeId: to.id,
        fromAllocatedCents: from.allocatedCents,
        toAllocatedCents: to.allocatedCents,
      },
      newValue: {
        fromEnvelopeId: from.id,
        toEnvelopeId: to.id,
        fromAllocatedCents,
        toAllocatedCents,
        amountCents,
      },
    });

    return createSuccess({
      fromEnvelopeId: from.id,
      toEnvelopeId: to.id,
      amountCents,
      fromAllocatedCents,
      toAllocatedCents,
    });
  }
}
