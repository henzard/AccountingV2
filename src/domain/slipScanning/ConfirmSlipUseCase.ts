import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { randomUUID } from 'expo-crypto';
import type * as schema from '../../data/local/schema';
import { envelopes, transactions } from '../../data/local/schema';
import type { ISlipQueueRepository } from '../ports/ISlipQueueRepository';
import { createSuccess, createFailure } from '../shared/types';
import type { Result } from '../shared/types';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import { insertRowWithinUow, updateRowWithinUow } from '../../data/uow/createSyncedRepo';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { logger } from '../../infrastructure/logging/Logger';
import {
  validateTransactionAmountCents,
  validateTransactionDate,
  validateTargetEnvelope,
} from '../transactions/transactionValidation';

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

export type ConfirmSlipResult = {
  transactionIds: string[];
  /**
   * True when the SIGNED sum of the lines this confirm actually wrote —
   * discount/refund lines included, at their negative value — differs from
   * the slip's OCR-extracted `totalCents`. Surfaced so the caller can warn
   * the user (e.g. a missed or mis-split line item); it never blocks the
   * save. The compared set is exactly the set persisted (see REF-SLIP
   * below), so a slip carrying a discount line now reconciles instead of
   * being guaranteed a mismatch.
   */
  totalMismatch: boolean;
};

/**
 * Confirms a scanned slip: writes one `transactions` row per confirmed item
 * and flips the slip to 'completed' — as ONE atomic, all-or-nothing write.
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
 * --- DOM-1 fix (this pass) ---------------------------------------------------
 * `ExtractSlipUseCase` sets the slip's `status` to 'completed' the instant
 * extraction succeeds — BEFORE the user has confirmed or saved anything. The
 * old "a slip already 'completed' is a no-op" guard (both the Step-1 fast
 * path and the Step-3 conditional `status != 'completed'` completion UPDATE)
 * therefore matched on the very FIRST confirm attempt, every time — Save
 * always returned success with zero transactions written. "Already
 * confirmed" now means "this slip's item transactions already exist"
 * (`transactions.slip_id = this slip`, not soft-deleted), checked both as a
 * fast-path read (Step 1) and, atomically, as the FIRST statement inside the
 * write transaction (Step 3) — never `slip_queue.status`. No new status
 * value, no schema change: `transactions.slip_id` is an existing indexed
 * column (`idx_transactions_slip_id`, migration 0008_slip_scanning.sql). The
 * slip is still flipped to 'completed' at the end of Step 3 for bookkeeping,
 * but that write is no longer what makes a repeat confirm a no-op.
 *
 * --- The fix -----------------------------------------------------------------
 * 1. Idempotency guard: a slip whose item transactions already exist is a
 *    no-op success — a double-tap or retried confirm never duplicates them.
 *    The Step-1 read is only a fast path; the real guarantee is the
 *    existence check that runs as the first statement inside Step 3's write
 *    transaction, so even two overlapping confirms that both pass the
 *    Step-1 fast path (a TOCTOU race) produce exactly one set of
 *    transactions — see the in-line comment on that check for why this is
 *    safe without a unique index.
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
 *
 * --- DOM-12 fix ---------------------------------------------------------------
 * A single non-positive line (e.g. a discount/rebate row the OCR pulled out
 * as its own item) used to fail the WHOLE confirm with INVALID_AMOUNT.
 * Non-positive items were dropped rather than persisted, instead of blocking
 * every other, valid line on the slip. Each written transaction's `payee` is
 * now the slip's extracted merchant (previously always `null` despite the
 * merchant being available on the fetched slip row).
 *
 * --- REF-SLIP fix (this pass) -------------------------------------------------
 * DOM-12's "drop everything that isn't positive" was the right call only
 * while the ledger itself refused a negative row. It no longer does: a
 * transaction amount is any NON-ZERO safe integer and negative means money
 * back (`transactionValidation.validateTransactionAmountCents`), because
 * every balance is a signed `SUM(amount_cents)` (`EnvelopeBalanceQuery`) that
 * nets a negative row out. Slip scanning was the last path that could not
 * record one, and it was wrong twice over: a "DISCOUNT -5,00" / voucher /
 * same-slip return line was silently DROPPED (the user lost it), yet its
 * amount was still counted in the totals comparison — so such a slip was
 * GUARANTEED a bogus `totalMismatch` warning as well.
 *
 * Now: only a ZERO-amount line is dropped (a R0 line moves nothing and is
 * never what the user meant — the same rule the shared validator applies).
 * Every non-zero line, positive or negative, is validated by that shared
 * validator and written as a transaction in its own assigned envelope, and
 * the totals comparison sums EXACTLY the set that was written, signed. A
 * slip of [+100,00, −15,00] therefore writes two rows that net to 85,00 in
 * the envelope's derived spend and reconciles against an 85,00 slip total.
 * A slip whose lines net to zero or negative overall (a pure return slip)
 * confirms normally; nothing downstream of this use case treats the net as
 * a spend figure (the `slip_confirmed` household push carries an item COUNT,
 * not a total, and the over-budget push is raised by AddTransactionScreen,
 * not by this path).
 *
 * Every guarantee above is unchanged: the write is still one atomic
 * `runInUnitOfWork` callback, the in-transaction idempotency guard is still
 * the first statement inside it, ids are still generated up front, and one
 * oplog op is still appended per row — negative rows included.
 */
export interface ConfirmSlipUseCaseDeps extends SyncWriteDeps {
  /** Optional — when supplied, one best-effort audit-log row is written per confirmed item after the atomic write commits. */
  audit?: AuditLogger;
}

/**
 * Thrown INSIDE the atomic write callback when the pre-insert existence
 * check finds this slip's item transactions already committed — i.e. an
 * overlapping confirm won the race between our Step-1 read and this write.
 * Throwing rolls the whole unit of work back (so nothing here duplicates
 * it); `execute` catches it and returns the idempotent already-done result
 * rather than the failure path. Not an error the caller ever sees.
 */
class SlipAlreadyConfirmedError extends Error {}

export class ConfirmSlipUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly repo: ISlipQueueRepository,
    private readonly deps: ConfirmSlipUseCaseDeps = {},
  ) {}

  async execute(input: ConfirmSlipInput): Promise<Result<ConfirmSlipResult>> {
    if (input.items.length === 0) {
      return createFailure({
        code: 'SLIP_EMPTY_ITEMS',
        message: 'Slip has no items to confirm',
      });
    }

    const slip = await this.repo.get(input.slipId);
    if (!slip) {
      return createFailure({ code: 'SLIP_NOT_FOUND', message: 'Slip does not exist' });
    }

    // --- Step 1: idempotency guard (fast path) ------------------------------
    // A double-tap or a retried confirm call must never create a second set
    // of transactions for the same slip. See the DOM-1 fix note above for
    // why this checks `transactions.slip_id` rather than `slip_queue.status`
    // (which is already 'completed' by the time extraction finishes, long
    // before the user has confirmed anything). This read-then-act check is
    // only a fast-path/UX short-circuit though: it is NOT the real
    // guarantee. Two overlapping confirms can both find nothing here (a
    // TOCTOU race) — the actual protection is the equivalent existence check
    // re-run as the first statement inside Step 3's write transaction, which
    // lets exactly one of them win.
    const [existingTxn] = await this.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.slipId, input.slipId),
          eq(transactions.householdId, input.householdId),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1);
    if (existingTxn) {
      return createSuccess({ transactionIds: [], totalMismatch: false });
    }

    // --- Step 2: validation/reads — ALL async, OUTSIDE any transaction -----
    // REF-SLIP: drop ONLY zero-amount lines. A negative line is a discount /
    // voucher / same-slip return and is as real as a purchase — it is kept
    // and written as a negative transaction, exactly like the Refund toggle
    // on AddTransactionScreen produces. (DOM-12 used to drop those too,
    // losing the line AND mis-reporting the total.)
    const confirmableItems = input.items.filter((item) => item.amountCents !== 0);
    if (confirmableItems.length === 0) {
      return createFailure({
        code: 'SLIP_EMPTY_ITEMS',
        message: 'Slip has no items to confirm',
      });
    }

    // REG-12: this was the third transaction-create path (alongside
    // CreateTransactionUseCase and UpdateTransactionUseCase) with its own
    // hand-rolled envelope check that skipped the shared rules — it never
    // rejected an archived or soft-deleted target envelope, and never
    // validated the date or re-checked the amount with the shared safe-integer
    // rule. Every item now goes through the exact same
    // `transactionValidation` helpers the other two use, so all three paths
    // enforce identical rules and return the same error codes.
    const dateResult = validateTransactionDate(input.transactionDate);
    if (!dateResult.success) return dateResult;

    for (const item of confirmableItems) {
      // Accepts any non-zero safe integer, symmetrically — a −1 500 00c
      // refund line is rejected on exactly the same footing as a +1 500 00c
      // purchase line, and on no other.
      const amountResult = validateTransactionAmountCents(item.amountCents);
      if (!amountResult.success) return amountResult;

      const [targetEnvelope] = await this.db
        .select()
        .from(envelopes)
        .where(and(eq(envelopes.id, item.envelopeId), eq(envelopes.householdId, input.householdId)))
        .limit(1);

      const envelopeResult = validateTargetEnvelope(targetEnvelope);
      if (!envelopeResult.success) return envelopeResult;
    }

    // REF-SLIP: sum EXACTLY the set that gets written, signed — so a slip
    // with a discount line reconciles against its (already net) slip total
    // instead of warning. Dropped zero lines contribute nothing either way,
    // so including or excluding them cannot change this figure; summing the
    // written set is what keeps the two in lockstep if that ever changes.
    // A mismatch is a warning, never a failure.
    const itemsTotalCents = confirmableItems.reduce((sum, item) => sum + item.amountCents, 0);
    const totalMismatch = slip.totalCents != null && itemsTotalCents !== slip.totalCents;

    // --- Step 3: ONE synchronous write transaction — all-or-nothing --------
    const ctx = resolveSyncedRepoCtx(this.deps);
    const now = ctx.clock();
    const transactionIds = confirmableItems.map(() => randomUUID());

    try {
      runInUnitOfWork(this.db, (uow) => {
        // Atomic TOCTOU guard (DOM-1 fix): re-run the existence check as the
        // FIRST statement inside the write transaction. `runInUnitOfWork`
        // wraps this whole callback in ONE synchronous `db.transaction()`
        // call, and the callback itself never awaits — so two overlapping
        // `execute()` calls can never interleave their statements here.
        // Whichever call's transaction body runs first commits; the second
        // one then sees the first's already-inserted row and throws instead
        // of duplicating it. This gives the same guarantee the old
        // `status != 'completed'` guarded UPDATE gave, without depending on
        // `slip_queue.status` (which extraction already set to 'completed'
        // before either confirm ever ran).
        const existing = uow.db.get<{ id: string }>(sql`
          SELECT id FROM transactions
          WHERE slip_id = ${input.slipId}
            AND household_id = ${input.householdId}
            AND deleted_at IS NULL
          LIMIT 1
        `);
        if (existing != null) {
          throw new SlipAlreadyConfirmedError();
        }

        confirmableItems.forEach((item, i) => {
          const row: Record<string, unknown> = {
            id: transactionIds[i],
            household_id: input.householdId,
            envelope_id: item.envelopeId,
            // REF-SLIP: written SIGNED. `amount_cents` is an existing synced
            // column that already carries negative values from the Refund
            // toggle, so nothing about the wire format changes here — an
            // older build that pulls this row stores and sums it correctly.
            amount_cents: item.amountCents,
            // DOM-12: the merchant IS available (fetched on the slip in
            // Step 1) — write it as payee instead of always `null`.
            payee: slip.merchant,
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

        // Flip the slip to 'completed' for bookkeeping (extraction may
        // already have set this) — the existence check above, not this
        // status, is what now guards against a duplicate confirm, so this
        // write is unconditional: the row is guaranteed to exist (Step 1
        // already fetched it by this id/household).
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
      if (err instanceof SlipAlreadyConfirmedError) {
        // Another confirm already wrote this slip's transactions — ours
        // rolled back. Idempotent no-op success, exactly like the Step-1
        // fast-path guard. Do NOT mark the slip 'failed'.
        return createSuccess({ transactionIds: [], totalMismatch: false });
      }
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
      for (let i = 0; i < confirmableItems.length; i += 1) {
        const item = confirmableItems[i];
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

    return createSuccess({ transactionIds, totalMismatch });
  }
}
