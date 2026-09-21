import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
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
import { uuidv5, APP_NAMESPACE } from '../../infrastructure/crypto/uuidv5';
import {
  validateTransactionAmountCents,
  validateTransactionDate,
  validateTargetEnvelope,
} from '../transactions/transactionValidation';

/**
 * SYNC-SLIP. The DETERMINISTIC id of the `generation`-th confirmation's
 * `index`-th line transaction for a slip. House style matches
 * `periodContributionId` (`PersistentContributions.ts`).
 *
 * Why deterministic: `slip_queue` is HOUSEHOLD-wide, so two phones can both
 * open the same extracted slip and confirm it before either has synced. The
 * idempotency guard inside the write transaction only sees LOCAL rows, so it
 * cannot stop that — and with `randomUUID()` line ids the two devices
 * produced two disjoint id sets, both of which then synced, permanently
 * DOUBLE-COUNTING the household's spend. Uniqueness exists only on
 * `transactions.id` (`slip_id` is merely indexed, migration 0008), so the
 * id is the only lever that makes the existing convergence machinery apply.
 *
 * With the same id on both devices, `private.apply_one_op` (migration 0016)
 * does the rest: an identical duplicate insert answers `applied`, and one
 * whose values differ answers `row_exists`, which `SyncEngine` treats as
 * SUPERSEDED — it marks the op pushed (no dead letter, no retry loop, the
 * household keeps draining) and then `refreshSupersededRow` copies the
 * SERVER's authoritative row down over the local one. See the
 * `ROW_EXISTS_REJECT_CODE` comment in `SyncEngine.ts`, which names exactly
 * this pattern ("Several client writes use deterministic uuidv5 ids
 * precisely so two devices doing the same thing produce the same row").
 *
 * `generation` exists so that a LEGITIMATE re-confirmation — the user
 * deleted this slip's transactions and scanned/confirmed it again — does not
 * reuse the tombstoned rows' primary keys. A soft delete leaves the row in
 * place, so reusing the id would make the local `INSERT` throw on the
 * primary key and fail the whole confirm. It is derived from state BOTH
 * devices share once synced (the number of rows already carrying this
 * `slip_id`, in ANY state), so it is 0 on both racing devices for a first
 * confirmation and the convergence above still applies.
 */
export function slipLineTransactionId(
  householdId: string,
  slipId: string,
  generation: number,
  index: number,
): string {
  return uuidv5(`slip:${householdId}:${slipId}:gen:${generation}:line:${index}`, APP_NAMESPACE);
}

/**
 * SLIP-ROUND. How far the signed sum of a slip's line items may fall from the
 * slip's own printed total before it is worth warning the user about.
 *
 * South African cash totals are rounded to the nearest 10c (there is no 1c or
 * 5c coin in circulation), so a cash slip's printed TOTAL legitimately
 * differs from the sum of its line items by up to 9c. The `extract-slip`
 * prompt deliberately tells the model NOT to invent a cash-rounding line and
 * NOT to fudge item amounts to make them add up — an honest extraction of
 * such a slip is therefore a few cents out by construction, and an exact
 * comparison warned on every single one, training the user to ignore the
 * warning entirely.
 *
 * Strictly LESS than 10c is tolerated (the whole rounding band); 10c or more
 * in either direction is a real discrepancy — a missed, duplicated or
 * mis-read line — and still warns.
 */
export const TOTAL_MISMATCH_TOLERANCE_CENTS = 10;

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
   * the slip's OCR-extracted `totalCents` by `TOTAL_MISMATCH_TOLERANCE_CENTS`
   * or more. Surfaced so the caller can warn the user (e.g. a missed or
   * mis-split line item); it never blocks the save. The compared set is
   * exactly the set persisted (see REF-SLIP below), so a slip carrying a
   * discount line now reconciles instead of being guaranteed a mismatch, and
   * sub-10c cash rounding is tolerated (see SLIP-ROUND above).
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
 * the first statement inside it, and one oplog op is still appended per row
 * — negative rows included.
 *
 * --- SYNC-SLIP fix (this pass) ------------------------------------------------
 * The idempotency guard above is a LOCAL check, and `slip_queue` is
 * household-wide: two phones can both open the same extracted slip and
 * confirm it before either has synced, and neither one's guard can see the
 * other's rows. With `randomUUID()` line ids that produced two disjoint sets
 * of transactions, both of which synced — the household's spend for that
 * slip was permanently DOUBLE-COUNTED, with no server-side uniqueness to
 * catch it (`transactions` is unique on `id` only; `slip_id` is merely
 * indexed).
 *
 * The fix is `slipLineTransactionId` (see its own note): both devices derive
 * the SAME id for the same (household, slip, generation, line index), so the
 * convergence that already exists for every other deterministic-id write
 * applies. `generation` is read INSIDE the write transaction — the count of
 * rows already carrying this `slip_id` in any state, soft-deleted included —
 * rather than before it, because a count read outside the transaction could
 * be stale by the time the inserts run, and because it must be consistent
 * with the guard's own snapshot. The ids are therefore filled into
 * `transactionIds` inside the callback; the post-commit audit loop reads it
 * afterwards, which is safe precisely because it only ever runs after a
 * successful commit.
 *
 * What each cross-device case ends up as:
 *
 *  (a) TRUE RACE — both phones confirm the same line set offline. Neither
 *      has any row for the slip, so both compute generation 0 and identical
 *      ids. Whichever pushes first is applied. The second device's inserts
 *      carry the same ids and the same values, so `apply_one_op` answers
 *      `applied` for an identical duplicate (and `row_exists` for any line
 *      whose value differs, handled in (c)). ONE set of rows household-wide,
 *      spend counted once. This is the hole this fix closes.
 *
 *  (b) RE-CONFIRM AFTER DELETE — the user deletes the slip's transactions
 *      (soft delete: the rows stay, `deleted_at` set) and confirms again.
 *      The live-row guard no longer matches, so the confirm proceeds; the
 *      generation count DOES still see the tombstones, so it is now N, the
 *      ids are fresh, and the local inserts cannot collide with the
 *      tombstoned primary keys. A second device that has synced those
 *      tombstones computes the same N and the same fresh ids, so (a) still
 *      holds for the re-confirmation.
 *
 *  (c) DIVERGENT LINE SETS — both phones confirm, but one user removed or
 *      edited a line first, so index `i` names different content on each
 *      device. End state, stated plainly: the FIRST set to push wins on the
 *      server for every id it wrote. The second device's insert for such an
 *      id comes back `row_exists`, which `SyncEngine` treats as superseded —
 *      the op is marked PUSHED (never dead-lettered, never retried forever)
 *      and `refreshSupersededRow` overwrites that device's local row with
 *      the server's, so the two phones and the server agree. No row is left
 *      existing on one phone but not the server, and no op is dead-lettered.
 *      Two asymmetries follow from this and are accepted deliberately:
 *      a device that confirmed FEWER lines simply pulls the winner's extra
 *      lines; a device that confirmed MORE lines has its extra lines applied
 *      (their ids are new to the server), so the household ends on the UNION
 *      of the two line sets, converged and identical everywhere, rather than
 *      on a partial or duplicated ledger. That is strictly better than the
 *      double-count it replaces, and the user can delete a line they did not
 *      want; nothing silently diverges.
 *
 * Older builds keep working: the guard asks whether ANY live row carries
 * this `slip_id`, never what the id LOOKS like, so a slip confirmed by a
 * build that wrote random ids is still recognised as confirmed, and its
 * tombstones still count toward the generation.
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
    // SLIP-ROUND: a cash slip's printed total is rounded to the nearest 10c,
    // so anything inside that band is expected, not a discrepancy.
    const totalMismatch =
      slip.totalCents != null &&
      Math.abs(itemsTotalCents - slip.totalCents) >= TOTAL_MISMATCH_TOLERANCE_CENTS;

    // --- Step 3: ONE synchronous write transaction — all-or-nothing --------
    const ctx = resolveSyncedRepoCtx(this.deps);
    const now = ctx.clock();
    // SYNC-SLIP: filled INSIDE the write transaction, because the generation
    // each id is derived from is read there (see the SYNC-SLIP note above).
    // Read back afterwards only on the committed path — the audit loop and
    // the success result — never on a rollback, where it stays empty.
    const transactionIds: string[] = [];

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

        // SYNC-SLIP: the generation this confirmation writes under. Counts
        // rows in ANY state — a soft delete leaves the row (and therefore
        // its primary key) in place, so the tombstones of a previous
        // confirmation must push the next one onto fresh ids or its inserts
        // would collide. Deliberately NOT filtered by `deleted_at`, and
        // deliberately id-shape-blind, so an older build's random-id rows
        // count too. Zero on both devices of a first-confirmation race,
        // which is what makes their ids agree.
        const generationRow = uow.db.get<{ n: number }>(sql`
          SELECT COUNT(*) AS n FROM transactions
          WHERE slip_id = ${input.slipId}
            AND household_id = ${input.householdId}
        `);
        const generation = generationRow?.n ?? 0;
        // Reset-then-fill rather than assign: `transactionIds` is the array
        // the post-commit audit loop and the result read, and this callback
        // runs exactly once per successful commit.
        transactionIds.length = 0;
        for (let i = 0; i < confirmableItems.length; i += 1) {
          transactionIds.push(
            slipLineTransactionId(input.householdId, input.slipId, generation, i),
          );
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
