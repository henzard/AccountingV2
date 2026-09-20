import { LogDebtPaymentUseCase } from '../LogDebtPaymentUseCase';
import type { DebtEntity } from '../DebtEntity';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-sync-1' }));
jest.mock('../../shared/bestEffortAudit', () => ({
  bestEffortAudit: jest.fn().mockResolvedValue(undefined),
}));

const currentDebt: DebtEntity = {
  id: 'd1',
  householdId: 'h1',
  creditorName: 'FNB',
  debtType: 'credit_card',
  outstandingBalanceCents: 100000,
  initialBalanceCents: 100000,
  interestRatePercent: 22.5,
  minimumPaymentCents: 2500,
  sortOrder: 0,
  isPaidOff: false,
  totalPaidCents: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

/**
 * `LogDebtPaymentUseCase` drives `runInUnitOfWork` directly (not
 * `createSyncedRepo`) — see the file's own doc comment for why a debt
 * payment needs two `increment` ops (one per money column) instead of the
 * generic single-field `increment` helper. `is_paid_off` is no longer
 * pushed as a third op — the server derives it from
 * `outstanding_balance_cents` via a trigger (slice 5 task 6,
 * `supabase/migrations/0001_baseline.sql` §9g). This fake `db` mimics just
 * enough of `PortableDb` for `runInUnitOfWork` to work: `.transaction(fn)`
 * calls `fn(tx)` synchronously and returns its result, and `tx.run(...)`
 * records every raw-SQL statement issued inside the transaction.
 */
function makeUowDb(changes = 1) {
  const runCalls: unknown[] = [];
  const tx = {
    run: jest.fn((query: unknown) => {
      runCalls.push(query);
      return { changes };
    }),
  };
  const db = { transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)) };
  return { db: db as any, runCalls };
}

describe('LogDebtPaymentUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns INVALID_PAYMENT when paymentAmountCents is 0', async () => {
    const { db } = makeUowDb();
    const uc = new LogDebtPaymentUseCase(db, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 0,
      currentDebt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYMENT');
  });

  it('decrements outstanding balance and increments totalPaidCents', async () => {
    const { db } = makeUowDb();
    const uc = new LogDebtPaymentUseCase(db, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 5000,
      currentDebt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outstandingBalanceCents).toBe(95000);
      expect(result.data.totalPaidCents).toBe(5000);
      expect(result.data.isPaidOff).toBe(false);
    }
  });

  it('marks debt as isPaidOff when payment covers full balance', async () => {
    const { db } = makeUowDb();
    const uc = new LogDebtPaymentUseCase(db, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 100000,
      currentDebt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outstandingBalanceCents).toBe(0);
      expect(result.data.isPaidOff).toBe(true);
    }
  });

  it('clamps balance to 0 when payment exceeds outstanding', async () => {
    const { db } = makeUowDb();
    const uc = new LogDebtPaymentUseCase(db, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 200000,
      currentDebt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outstandingBalanceCents).toBe(0);
      expect(result.data.isPaidOff).toBe(true);
    }
  });

  it('logs audit with payment details', async () => {
    const { db } = makeUowDb();
    const { bestEffortAudit: mockBestEffortAudit } = jest.requireMock(
      '../../shared/bestEffortAudit',
    ) as { bestEffortAudit: jest.Mock };
    const uc = new LogDebtPaymentUseCase(db, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 5000,
      currentDebt,
    });
    await uc.execute();
    expect(mockBestEffortAudit).toHaveBeenCalledTimes(1);
  });

  it('runs the whole payment as ONE db.transaction (atomic, no pending_sync)', async () => {
    const { db } = makeUowDb();
    const uc = new LogDebtPaymentUseCase(db, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 5000,
      currentDebt,
    });
    await uc.execute();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('clamps actualApplied to outstanding balance when payment exceeds it', async () => {
    const { db } = makeUowDb();
    const uc = new LogDebtPaymentUseCase(db, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 200000, // currentDebt.outstandingBalanceCents = 100000
      currentDebt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      // Only the actual outstanding amount should be applied, not the full 200000
      expect(result.data.totalPaidCents).toBe(100000);
    }
  });

  it('returns DEBT_NOT_FOUND and appends no ops when the UPDATE matches no row', async () => {
    const { db, runCalls } = makeUowDb(0);
    const uc = new LogDebtPaymentUseCase(db, mockAudit, {
      householdId: 'h1',
      debtId: 'missing',
      paymentAmountCents: 5000,
      currentDebt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('DEBT_NOT_FOUND');
    // Only the UPDATE ran — no oplog inserts followed it.
    expect(runCalls).toHaveLength(1);
  });

  it('returns success even when audit fails', async () => {
    const { db } = makeUowDb();
    const { bestEffortAudit: mockBestEffortAudit } = jest.requireMock(
      '../../shared/bestEffortAudit',
    ) as { bestEffortAudit: jest.Mock };
    // bestEffortAudit never throws, so just verify it's called and result is still success
    const uc = new LogDebtPaymentUseCase(db, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 5000,
      currentDebt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(mockBestEffortAudit).toHaveBeenCalled();
  });
});
