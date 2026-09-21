import { randomUUID } from 'expo-crypto';
import { sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import { assertRunMatchedRow, isRowNotMatchedError } from '../../data/uow/createSyncedRepo';
import type { SyncedRepoCtx } from '../../data/uow/createSyncedRepo';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { bestEffortAudit } from '../shared/bestEffortAudit';
import type { DebtEntity } from './DebtEntity';

export interface LogDebtPaymentInput {
  householdId: string;
  debtId: string;
  paymentAmountCents: number;
  currentDebt: DebtEntity;
}

/** Same "use ctx.genId if given, else a real uuid" rule `createSyncedRepo` uses internally. */
function resolveOpId(ctx: SyncedRepoCtx): string {
  return ctx.genId ? ctx.genId() : randomUUID();
}

/**
 * Thrown inside the unit of work when the row's CURRENT balance is already 0,
 * so the transaction rolls back and no ops are appended. Translated to the
 * `DEBT_ALREADY_PAID_OFF` failure below — `LogPaymentScreen` surfaces
 * `error.message` and undoes the envelope transaction it may have created
 * just before, exactly as it already does for `DEBT_NOT_FOUND`.
 */
class DebtAlreadyPaidOffError extends Error {
  constructor() {
    super('This debt is already paid off');
    this.name = 'DebtAlreadyPaidOffError';
  }
}

export class LogDebtPaymentUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: LogDebtPaymentInput,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<DebtEntity>> {
    if (this.input.paymentAmountCents <= 0) {
      return createFailure({
        code: 'INVALID_PAYMENT',
        message: 'Payment amount must be greater than zero',
      });
    }

    const now = new Date().toISOString();
    const ctx = resolveSyncedRepoCtx(this.deps);

    // Assigned inside the unit of work from the row's LIVE values — see the
    // re-read below. Read after the commit for the audit entry and the
    // returned entity.
    let actualApplied = 0;
    let liveBalanceBefore = 0;
    let liveTotalPaidBefore = 0;

    // `createSyncedRepo`'s generic `increment` helper writes/appends exactly
    // ONE field per call, which doesn't fit a debt payment: it must move
    // TWO columns (outstanding_balance_cents down, total_paid_cents up)
    // together. This use case therefore drives `runInUnitOfWork` directly
    // (the same primitive `createSyncedRepo` is built on) rather than going
    // through that helper — see `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md`
    // §"Debt payment" and `.superpowers/sdd/task-1-report.md` for the design
    // rationale (server's `sync_push` `increment` branch is single-field-only
    // and can't be changed in this local-only task).
    //
    // Slice 5 task 6: this used to append a THIRD op — a plain `update` op
    // carrying the client-computed `is_paid_off` — alongside the two
    // `increment` ops below. That op is gone. The Task-1 review flagged a
    // divergence risk: sync_push applies ops independently (no whole-batch
    // atomicity), so a transient rejection of the balance-decrement op while
    // this client-computed `is_paid_off` op still applied could show a debt
    // as "paid off" against a nonzero remote balance until DLQ retry. Fixed
    // by deriving `is_paid_off` server-side instead (a `BEFORE INSERT OR
    // UPDATE` trigger on `public.debts`, `supabase/migrations/0001_baseline.sql`
    // §9g) from whatever `outstanding_balance_cents` the row actually holds —
    // it can no longer independently diverge, and the client has one fewer
    // op to push per payment.
    try {
      runInUnitOfWork(this.db, (uow) => {
        // Re-read the LIVE balance inside the transaction, immediately before
        // computing `actualApplied`. The in-statement `MAX(0, ...)` below and
        // the server's `greatest(0, ...)` both self-heal the BALANCE against a
        // stale `this.input.currentDebt` snapshot — but `total_paid_cents` is
        // pushed with `clamp: 'none'` and has no such floor, so a delta sized
        // from a stale snapshot over-credits it (balance stops at 0, total
        // paid keeps climbing). Sizing BOTH deltas from the row as it actually
        // is at write time is what keeps the two columns consistent: a second
        // submission from the same screen state after a slow/failed first one,
        // or a debt the puller moved while the screen sat open, now credits
        // only what is really owed.
        const live = uow.db.get<{
          outstanding_balance_cents: number;
          total_paid_cents: number;
        }>(sql`
          SELECT outstanding_balance_cents, total_paid_cents
          FROM debts
          WHERE id = ${this.input.debtId} AND household_id = ${this.input.householdId}
        `);
        // A missing/other-household row falls through with the snapshot's
        // figures: the UPDATE below matches no row and
        // `assertRunMatchedRow` turns it into DEBT_NOT_FOUND, unchanged.
        liveBalanceBefore = live?.outstanding_balance_cents ?? 0;
        liveTotalPaidBefore = live?.total_paid_cents ?? 0;
        if (live != null && liveBalanceBefore <= 0) {
          // Nothing left to pay: appending a +payment `total_paid_cents` op
          // here would credit money against a settled debt. Roll back with no
          // ops at all.
          throw new DebtAlreadyPaidOffError();
        }
        actualApplied = live
          ? Math.min(this.input.paymentAmountCents, liveBalanceBefore)
          : Math.min(this.input.paymentAmountCents, this.input.currentDebt.outstandingBalanceCents);

        // ONE SQL statement recomputes outstanding_balance_cents,
        // total_paid_cents, AND is_paid_off from the row's CURRENT (pre-update)
        // values — not from `this.input.currentDebt`, which may be a stale
        // snapshot. This closes the deep-review-flagged race where two
        // concurrent/double-tapped payments each computed `newBalance` from the
        // same stale snapshot and the second write clobbered the first's
        // balance decrement (see docs/reviews/2026-07-02-deep-review-findings.md,
        // "[C] Domain: debt snowball" — "LogDebtPaymentUseCase: balance update
        // is a stale-snapshot lost-update"). SQLite evaluates every `SET`
        // expression against the original row, so `is_paid_off`'s
        // sub-expression sees the same pre-update `outstanding_balance_cents`
        // the balance expression does.
        const updateResult = uow.db.run(sql`
          UPDATE debts
          SET outstanding_balance_cents = MAX(0, outstanding_balance_cents - ${actualApplied}),
              total_paid_cents = total_paid_cents + ${actualApplied},
              is_paid_off = (MAX(0, outstanding_balance_cents - ${actualApplied}) = 0),
              updated_at = ${now}
          WHERE id = ${this.input.debtId} AND household_id = ${this.input.householdId}
        `);
        // A missing/other-household debt must not append increment ops for a
        // row that was never updated — throw so the unit of work rolls back.
        assertRunMatchedRow('debts', this.input.debtId, this.input.householdId, updateResult);

        // Two `increment` ops — one per money column — appended in this SAME
        // local transaction, so a payment either applies both column changes
        // or neither (fixing the "two non-transactional writes" half of the
        // deep-review finding). Each op is independently well-formed for the
        // server's existing single-field `increment` RPC branch.
        uow.appendOp({
          opId: resolveOpId(ctx),
          householdId: this.input.householdId,
          tableName: 'debts',
          rowId: this.input.debtId,
          opType: 'increment',
          payload: {
            field: 'outstanding_balance_cents',
            delta: -actualApplied,
            clamp: 'floor_zero',
          },
          actorUserId: ctx.actorUserId,
          deviceId: ctx.deviceId,
          clientCreatedAt: now,
        });
        uow.appendOp({
          opId: resolveOpId(ctx),
          householdId: this.input.householdId,
          tableName: 'debts',
          rowId: this.input.debtId,
          opType: 'increment',
          payload: {
            field: 'total_paid_cents',
            delta: actualApplied,
            clamp: 'none',
          },
          actorUserId: ctx.actorUserId,
          deviceId: ctx.deviceId,
          clientCreatedAt: now,
        });
      });
    } catch (err) {
      if (isRowNotMatchedError(err)) {
        return createFailure({ code: 'DEBT_NOT_FOUND', message: 'Debt no longer exists' });
      }
      if (err instanceof DebtAlreadyPaidOffError) {
        return createFailure({ code: 'DEBT_ALREADY_PAID_OFF', message: err.message });
      }
      throw err;
    }

    const newBalance = liveBalanceBefore - actualApplied;
    const isPaidOff = newBalance === 0;

    await bestEffortAudit(this.audit, {
      householdId: this.input.householdId,
      entityType: 'debt',
      entityId: this.input.debtId,
      action: 'payment',
      // The row's live pre-payment figures, not the screen's snapshot — the
      // audit trail should record what the write actually moved.
      previousValue: {
        outstandingBalanceCents: liveBalanceBefore,
        totalPaidCents: liveTotalPaidBefore,
      },
      newValue: {
        paymentAmountCents: this.input.paymentAmountCents,
        outstandingBalanceCents: newBalance,
        isPaidOff,
      },
    });

    const updated: DebtEntity = {
      ...this.input.currentDebt,
      outstandingBalanceCents: newBalance,
      totalPaidCents: liveTotalPaidBefore + actualApplied,
      isPaidOff,
      updatedAt: now,
    };

    return createSuccess(updated);
  }
}
