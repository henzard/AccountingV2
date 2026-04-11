import { LogDebtPaymentUseCase } from '../LogDebtPaymentUseCase';
import type { DebtEntity } from '../DebtEntity';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-sync-1' }));

const mockUpdate = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
});
const mockInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
const mockDb = { update: mockUpdate, insert: mockInsert } as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

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
  isSynced: false,
};

describe('LogDebtPaymentUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns INVALID_PAYMENT when paymentAmountCents is 0', async () => {
    const uc = new LogDebtPaymentUseCase(mockDb, mockAudit, {
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
    const uc = new LogDebtPaymentUseCase(mockDb, mockAudit, {
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
    const uc = new LogDebtPaymentUseCase(mockDb, mockAudit, {
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
    const uc = new LogDebtPaymentUseCase(mockDb, mockAudit, {
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
    const uc = new LogDebtPaymentUseCase(mockDb, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 5000,
      currentDebt,
    });
    await uc.execute();
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
  });
});
