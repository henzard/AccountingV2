import { UpdateDebtUseCase } from '../UpdateDebtUseCase';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';
import type { DebtEntity } from '../DebtEntity';

jest.mock('../../shared/bestEffortAudit', () => ({
  bestEffortAudit: jest.fn().mockResolvedValue(undefined),
}));

function makeFakeRepo(): SyncedRepo & {
  insert: jest.Mock;
  update: jest.Mock;
  softDelete: jest.Mock;
  increment: jest.Mock;
} {
  return {
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  };
}

const mockDb = {} as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

const mockDebt: DebtEntity = {
  id: 'debt-1',
  householdId: 'h1',
  creditorName: 'FNB Credit Card',
  debtType: 'credit_card' as const,
  outstandingBalanceCents: 100000,
  initialBalanceCents: 200000,
  interestRatePercent: 21.5,
  minimumPaymentCents: 2500,
  sortOrder: 100000,
  isPaidOff: false,
  totalPaidCents: 100000,
  createdAt: '2026-01-01',
  updatedAt: '2026-06-01',
};

const input = {
  householdId: 'h1',
  debtId: 'debt-1',
  outstandingBalanceCents: 80000,
  interestRatePercent: 21.5,
  minimumPaymentCents: 2500,
  creditorName: 'FNB Credit Card',
};

describe('UpdateDebtUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('validation - balance', () => {
    it('returns INVALID_BALANCE when outstandingBalanceCents is not a safe integer', async () => {
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, {
        ...input,
        outstandingBalanceCents: Number.MAX_SAFE_INTEGER + 1,
      });
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_BALANCE');
    });

    it('returns INVALID_BALANCE when outstandingBalanceCents is negative', async () => {
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, {
        ...input,
        outstandingBalanceCents: -1,
      });
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_BALANCE');
    });

    it('allows zero balance for statement update', async () => {
      const repo = makeFakeRepo();
      const uc = new UpdateDebtUseCase(
        mockDb,
        mockAudit,
        mockDebt,
        {
          ...input,
          outstandingBalanceCents: 0,
        },
        { repo },
      );
      const result = await uc.execute();
      // Should succeed (not return INVALID_BALANCE) and call repo.update
      expect(result.success).toBe(true);
      expect(repo.update).toHaveBeenCalled();
    });
  });

  describe('validation - rate', () => {
    it('returns INVALID_RATE when interestRatePercent is negative', async () => {
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, {
        ...input,
        interestRatePercent: -1,
      });
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_RATE');
    });

    it('returns INVALID_RATE when interestRatePercent exceeds 100', async () => {
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, {
        ...input,
        interestRatePercent: 101,
      });
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_RATE');
    });

    it('returns INVALID_RATE when interestRatePercent is NaN', async () => {
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, {
        ...input,
        interestRatePercent: NaN,
      });
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_RATE');
    });

    it('allows zero interest rate', async () => {
      const repo = makeFakeRepo();
      const uc = new UpdateDebtUseCase(
        mockDb,
        mockAudit,
        mockDebt,
        { ...input, interestRatePercent: 0 },
        { repo },
      );
      const result = await uc.execute();
      // Should not return INVALID_RATE — zero is valid.
      if (!result.success) {
        expect(result.error.code).not.toBe('INVALID_RATE');
      }
    });
  });

  describe('validation - minimum payment', () => {
    it('returns INVALID_PAYMENT when minimumPaymentCents is 0', async () => {
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, {
        ...input,
        minimumPaymentCents: 0,
      });
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_PAYMENT');
    });

    it('returns INVALID_PAYMENT when minimumPaymentCents is negative', async () => {
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, {
        ...input,
        minimumPaymentCents: -1,
      });
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_PAYMENT');
    });

    it('returns INVALID_PAYMENT when minimumPaymentCents is not a safe integer', async () => {
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, {
        ...input,
        minimumPaymentCents: Number.MAX_SAFE_INTEGER + 1,
      });
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_PAYMENT');
    });
  });

  describe('validation - creditor name', () => {
    it('returns INVALID_NAME when creditorName is empty string', async () => {
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, {
        ...input,
        creditorName: '',
      });
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    });

    it('returns INVALID_NAME when creditorName is only whitespace', async () => {
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, {
        ...input,
        creditorName: '   ',
      });
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    });

    it('trims creditor name when valid', async () => {
      const repo = makeFakeRepo();
      const uc = new UpdateDebtUseCase(
        mockDb,
        mockAudit,
        mockDebt,
        { ...input, creditorName: '  Updated Bank  ' },
        { repo },
      );
      const result = await uc.execute();
      if (result.success) {
        expect(result.data.creditorName).toBe('Updated Bank');
      }
    });
  });

  describe('write behavior', () => {
    it('writes exactly one update op with absolute values (not increments)', async () => {
      const repo = makeFakeRepo();
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, input, { repo });
      const result = await uc.execute();
      expect(result.success).toBe(true);
      expect(repo.update).toHaveBeenCalledTimes(1);
      expect(repo.insert).not.toHaveBeenCalled();
      expect(repo.increment).not.toHaveBeenCalled();

      const [debtId, householdId, fields] = repo.update.mock.calls[0];
      expect(debtId).toBe('debt-1');
      expect(householdId).toBe('h1');
      expect(fields.outstanding_balance_cents).toBe(80000); // New absolute value
      expect(fields.interest_rate_percent).toBe(21.5);
      expect(fields.minimum_payment_cents).toBe(2500);
      expect(fields.creditor_name).toBe('FNB Credit Card');
    });

    it('does not touch total_paid_cents', async () => {
      const repo = makeFakeRepo();
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, input, { repo });
      await uc.execute();

      const [, , fields] = repo.update.mock.calls[0];
      expect(fields.total_paid_cents).toBeUndefined();
    });

    it('sets is_paid_off = 1 when balance is zero', async () => {
      const repo = makeFakeRepo();
      const uc = new UpdateDebtUseCase(
        mockDb,
        mockAudit,
        mockDebt,
        { ...input, outstandingBalanceCents: 0 },
        { repo },
      );
      const result = await uc.execute();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isPaidOff).toBe(true);
      }

      const [, , fields] = repo.update.mock.calls[0];
      expect(fields.is_paid_off).toBe(1);
    });

    it('sets is_paid_off = 0 when balance is nonzero', async () => {
      const repo = makeFakeRepo();
      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, input, { repo });
      await uc.execute();

      const [, , fields] = repo.update.mock.calls[0];
      expect(fields.is_paid_off).toBe(0);
    });

    it('returns DEBT_NOT_FOUND when repo write throws row-not-matched error', async () => {
      const repo = makeFakeRepo();
      repo.update.mockImplementation(() => {
        throw new Error(
          'createSyncedRepo: no row in "debts" matched id=debt-1 household_id=h1 — 0 rows affected, refusing to append an oplog op',
        );
      });

      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, input, { repo });
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DEBT_NOT_FOUND');
      }
    });

    it('re-throws non-row-matched errors', async () => {
      const repo = makeFakeRepo();
      const customError = new Error('Custom DB error');
      repo.update.mockImplementation(() => {
        throw customError;
      });

      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, input, { repo });
      await expect(uc.execute()).rejects.toThrow('Custom DB error');
    });
  });

  describe('audit logging', () => {
    it('calls bestEffortAudit with previous and new values', async () => {
      const repo = makeFakeRepo();
      const { bestEffortAudit: mockBestEffortAudit } = jest.requireMock(
        '../../shared/bestEffortAudit',
      ) as { bestEffortAudit: jest.Mock };

      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, input, { repo });
      await uc.execute();

      expect(mockBestEffortAudit).toHaveBeenCalledTimes(1);
      const [, auditCall] = mockBestEffortAudit.mock.calls[0];
      expect(auditCall.householdId).toBe('h1');
      expect(auditCall.entityType).toBe('debt');
      expect(auditCall.entityId).toBe('debt-1');
      expect(auditCall.action).toBe('update');
      expect(auditCall.previousValue).toEqual({
        id: 'debt-1',
        outstandingBalanceCents: 100000,
        interestRatePercent: 21.5,
        minimumPaymentCents: 2500,
        creditorName: 'FNB Credit Card',
        isPaidOff: false,
      });
      expect(auditCall.newValue).toEqual({
        id: 'debt-1',
        outstandingBalanceCents: 80000,
        interestRatePercent: 21.5,
        minimumPaymentCents: 2500,
        creditorName: 'FNB Credit Card',
        isPaidOff: false,
      });
    });

    it('returns success even when bestEffortAudit is called', async () => {
      const repo = makeFakeRepo();
      const { bestEffortAudit: mockBestEffortAudit } = jest.requireMock(
        '../../shared/bestEffortAudit',
      ) as { bestEffortAudit: jest.Mock };
      // bestEffortAudit never throws (it handles errors internally), so
      // the use case will succeed and the audit will be logged.
      mockBestEffortAudit.mockResolvedValue(undefined);

      const uc = new UpdateDebtUseCase(mockDb, mockAudit, mockDebt, input, { repo });
      const result = await uc.execute();
      expect(result.success).toBe(true);
      expect(mockBestEffortAudit).toHaveBeenCalledTimes(1);
    });
  });

  describe('happy path', () => {
    it('updates all fields and returns updated DebtEntity', async () => {
      const repo = makeFakeRepo();
      const uc = new UpdateDebtUseCase(
        mockDb,
        mockAudit,
        mockDebt,
        {
          householdId: 'h1',
          debtId: 'debt-1',
          outstandingBalanceCents: 50000,
          interestRatePercent: 18.5,
          minimumPaymentCents: 3000,
          creditorName: 'New Bank Name',
        },
        { repo },
      );

      const result = await uc.execute();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.outstandingBalanceCents).toBe(50000);
        expect(result.data.interestRatePercent).toBe(18.5);
        expect(result.data.minimumPaymentCents).toBe(3000);
        expect(result.data.creditorName).toBe('New Bank Name');
        expect(result.data.isPaidOff).toBe(false);
        // These should remain unchanged from the current entity:
        expect(result.data.id).toBe(mockDebt.id);
        expect(result.data.householdId).toBe(mockDebt.householdId);
        expect(result.data.initialBalanceCents).toBe(mockDebt.initialBalanceCents);
        expect(result.data.totalPaidCents).toBe(mockDebt.totalPaidCents);
        expect(result.data.debtType).toBe(mockDebt.debtType);
      }
    });
  });
});
