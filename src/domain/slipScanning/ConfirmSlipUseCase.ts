import { and, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { randomUUID } from 'expo-crypto';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import type { ISlipQueueRepository } from '../ports/ISlipQueueRepository';
import { createSuccess, createFailure } from '../shared/types';
import type { Result } from '../shared/types';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import { insertRowWithinUow, updateRowWithinUow } from '../../data/uow/createSyncedRepo';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { logger } from '../../infrastructure/logging/Logger';

export type ConfirmSlipItem = {
  description: string;
  amountCents: number;
  envelopeId: string;
};

export type ConfirmSlipInput = {
  slipId: string;
  householdId: string;
  transactionDate: string;
  items: ConfirmSlipItem[];
};

/**
 * Confirms a scanned slip: writes one `transactions` row per item and flips
 * the slip to 'completed' — as ONE atomic, all-or-nothing write.
 *
 * --- The carried CRITICAL this replaces (spec §4.5) -------------------------
 * The old implementation looped items inside
 * `await this.db.transaction(async (tx) => {...})`, calling an async
 * `CreateTransactionUseCase.execute()` per item. drizzle's expo-sqlite
 * `db.transaction` runs its callback in SYNC mode — it does NOT await an
 * async callback. COMMIT fired at the callback's first `await` (the first
 * `await usecase.execute()`), before later items had run at all. A 2-item
 * slip whose second item failed left the FIRST item's transaction
 * permanently committed: a silent, non-atomic partial write. Every existing
 * test mocked `db.transaction` as a function that itself awaits the async
 * callback, which hid the bug (see `tests/realsql/confirmSlipAtomicity.test.ts`
 * for the real-driver proof).
 *
 * --- The fix -----------------------------------------------------------------
 * 1. Idempotency/status guard (below): a slip already 'completed' is a
 *    no-op success — a double-tap or retried confirm never duplicates the
 *    item transactions.
 * 2. Every read/validation happens FIRST, fully async, with NO open
 *    transaction — envelope existence/type checks for every item, up front.
 *    If any item is invalid, nothing has been written yet.
 * 3. Every entity write — N transaction-row inserts plus the slip's status
 *    flip — happens inside ONE synchronous `runInUnitOfWork` callback, using
 *    the low-level `insertRowWithinUow`/`updateRowWithinUow` primitives
 *    directly (NOT `CreateTransactionUseCase.execute()`, which is async and
 *    would reintroduce the exact bug this fixes). A throw from any item
 *    rolls back the WHOLE transaction — true all-or-nothing, proven against
 *    the real better-sqlite3 driver.
 */
export interface ConfirmSlipUseCaseDeps extends SyncWriteDeps {
  /** Optional — when supplied, one best-effort audit-log row is written per confirmed item after the atomic write commits. */
  audit?: AuditLogger;
}

export class ConfirmSlipUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly repo: ISlipQueueRepository,
    private readonly deps: ConfirmSlipUseCaseDeps = {},
  ) {}

  async execute(input: ConfirmSlipInput): Promise<Result<{ transactionIds: string[] }>> {
    if (input.items.length === 0) {
      return createFailure({
        code: 'SLIP_EMPTY_ITEMS',
        message: 'Slip has no items to confirm',
      });
    }

    // --- Step 1: idempotency / status guard --------------------------------
    // A double-tap or a retried confirm call must never create a second set
    // of transactions for the same slip. Once a slip is 'completed' its item
    // transactions already exist — treat a repeat confirm as a no-op success
    // rather than duplicating writes.
    const slip = await this.repo.get(input.slipId);
    if (!slip) {
      return createFailure({ code: 'SLIP_NOT_FOUND', message: 'Slip does not exist' });
    }
    if (slip.status === 'completed') {
      return createSuccess({ transactionIds: [] });
    }

    // --- Step 2: validation/reads — ALL async, OUTSIDE any transaction -----
    for (const item of input.items) {
      if (item.amountCents <= 0) {
        return createFailure({
          code: 'INVALID_AMOUNT',
          message: 'Amount must be greater than zero',
          context: { envelopeId: item.envelopeId },
        });
      }

      const [targetEnvelope] = await this.db
        .select()
        .from(envelopes)
        .where(and(eq(envelopes.id, item.envelopeId), eq(envelopes.householdId, input.householdId)))
        .limit(1);

      if (!targetEnvelope) {
        return createFailure({
          code: 'ENVELOPE_NOT_FOUND',
          message: 'Envelope does not exist',
          context: { envelopeId: item.envelopeId },
        });
      }
      if (targetEnvelope.envelopeType === 'income') {
        return createFailure({
          code: 'INVALID_ENVELOPE_TYPE',
          message: 'Cannot create a transaction against an income envelope',
          context: { envelopeId: item.envelopeId },
        });
      }
    }

    // --- Step 3: ONE synchronous write transaction — all-or-nothing --------
    const ctx = resolveSyncedRepoCtx(this.deps);
    const now = ctx.clock();
    const transactionIds = input.items.map(() => randomUUID());

    try {
      runInUnitOfWork(this.db, (uow) => {
        input.items.forEach((item, i) => {
          const row: Record<string, unknown> = {
            id: transactionIds[i],
            household_id: input.householdId,
            envelope_id: item.envelopeId,
            amount_cents: item.amountCents,
            payee: null,
            description: item.description,
            transaction_date: input.transactionDate,
            // 0/1, not a JS boolean: this row is written via a raw
            // `INSERT INTO` (insertRowWithinUow), which binds each value
            // directly to the driver — better-sqlite3 (used by the realsql
            // test tier) rejects a bound JS boolean outright ("SQLite3 can
            // only bind numbers, strings, bigints, buffers, and null").
            is_business_expense: 0,
            spending_trigger_note: null,
            slip_id: input.slipId,
            created_at: now,
            updated_at: now,
          };
          insertRowWithinUow(uow, 'transactions', row, ctx);
        });

        updateRowWithinUow(
          uow,
          'slip_queue',
          input.slipId,
          input.householdId,
          { status: 'completed', updated_at: now },
          ctx,
        );
      });
    } catch (err) {
      // Rolled back — no item transaction and no slip status change were
      // committed. Marking the slip 'failed' is a separate, SUBSEQUENT write
      // (its own transaction) so the user can retry cleanly; it does not
      // affect the atomicity guarantee above, which already ensured nothing
      // partial was left behind.
      await this.repo.update(input.slipId, {
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return createFailure({
        code: 'SLIP_PARTIAL_SAVE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // Best-effort audit trail, mirroring CreateTransactionUseCase: the ledger
    // write above has already committed, so a failure here must never
    // surface as a use case failure — the caller would otherwise retry a
    // write that actually succeeded, producing a duplicate confirm.
    if (this.deps.audit) {
      for (let i = 0; i < input.items.length; i += 1) {
        const item = input.items[i];
        try {
          await this.deps.audit.log({
            householdId: input.householdId,
            entityType: 'transaction',
            entityId: transactionIds[i],
            action: 'create',
            previousValue: null,
            newValue: {
              id: transactionIds[i],
              envelopeId: item.envelopeId,
              amountCents: item.amountCents,
              transactionDate: input.transactionDate,
            },
          });
        } catch (err) {
          logger.error('ConfirmSlipUseCase: audit.log failed after ledger commit', err, {
            transactionId: transactionIds[i],
            householdId: input.householdId,
          });
        }
      }
    }

    return createSuccess({ transactionIds });
  }
}
