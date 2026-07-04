import { randomUUID } from 'expo-crypto';
import { sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import type { SyncedRepoCtx } from '../../data/uow/createSyncedRepo';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
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
    const actualApplied = Math.min(
      this.input.paymentAmountCents,
      this.input.currentDebt.outstandingBalanceCents,
    );
    const newBalance = this.input.currentDebt.outstandingBalanceCents - actualApplied;
    const isPaidOff = newBalance === 0;
    const ctx = resolveSyncedRepoCtx(this.deps);

    // `createSyncedRepo`'s generic `increment` helper writes/appends exactly
    // ONE field per call, which doesn't fit a debt payment: it must move
    // TWO columns (outstanding_balance_cents down, total_paid_cents up)
    // together. This use case therefore drives `runInUnitOfWork` directly
    // (the same primitive `createSyncedRepo` is built on) rather than going
    // through that helper — see `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md`
    // §"Debt payment" and `.superpowers/sdd/task-1-report.md` for the design
    // rationale (server's `sync_push` `increment` branch is single-field-only
    // and can't be changed in this local-only task).
    runInUnitOfWork(this.db, (uow) => {
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
      uow.db.run(sql`
        UPDATE debts
        SET outstanding_balance_cents = MAX(0, outstanding_balance_cents - ${actualApplied}),
            total_paid_cents = total_paid_cents + ${actualApplied},
            is_paid_off = (MAX(0, outstanding_balance_cents - ${actualApplied}) = 0),
            updated_at = ${now}
        WHERE id = ${this.input.debtId} AND household_id = ${this.input.householdId}
      `);

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
      // is_paid_off is a plain derived boolean (not a money field, no
      // increment/lost-update concern) — a normal `update` op carries it and
      // `updated_at` to the server.
      uow.appendOp({
        opId: resolveOpId(ctx),
        householdId: this.input.householdId,
        tableName: 'debts',
        rowId: this.input.debtId,
        opType: 'update',
        payload: { is_paid_off: isPaidOff, updated_at: now },
        actorUserId: ctx.actorUserId,
        deviceId: ctx.deviceId,
        clientCreatedAt: now,
      });
    });

    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'debt',
      entityId: this.input.debtId,
      action: 'payment',
      previousValue: {
        outstandingBalanceCents: this.input.currentDebt.outstandingBalanceCents,
        totalPaidCents: this.input.currentDebt.totalPaidCents,
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
      totalPaidCents: this.input.currentDebt.totalPaidCents + actualApplied,
      isPaidOff,
      updatedAt: now,
    };

    return createSuccess(updated);
  }
}
