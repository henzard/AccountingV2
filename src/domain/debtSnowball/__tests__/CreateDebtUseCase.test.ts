import { CreateDebtUseCase } from '../CreateDebtUseCase';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-debt-1' }));

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

const mockSelect = jest.fn().mockReturnValue({
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue([{ count: 0 }]),
  }),
});
const mockDb = { select: mockSelect } as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

const input = {
  householdId: 'h1',
  creditorName: 'FNB Credit Card',
  debtType: 'credit_card' as const,
  outstandingBalanceCents: 100000,
  interestRatePercent: 22.5,
  minimumPaymentCents: 2500,
};

describe('CreateDebtUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns INVALID_BALANCE when outstandingBalanceCents is 0', async () => {
    const uc = new CreateDebtUseCase(mockDb, mockAudit, { ...input, outstandingBalanceCents: 0 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_BALANCE');
  });

  it('returns INVALID_PAYMENT when minimumPaymentCents is 0', async () => {
    const uc = new CreateDebtUseCase(mockDb, mockAudit, { ...input, minimumPaymentCents: 0 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYMENT');
  });

  it('returns INVALID_RATE when interestRatePercent is negative', async () => {
    const uc = new CreateDebtUseCase(mockDb, mockAudit, { ...input, interestRatePercent: -1 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_RATE');
  });

  it('inserts debt via the synced repo (exactly one oplog op, not pending_sync) and logs audit', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateDebtUseCase(mockDb, mockAudit, input, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.increment).not.toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledTimes(1);

    const [row] = repo.insert.mock.calls[0];
    expect(row.id).toBe('uuid-debt-1');
    expect(row.household_id).toBe('h1');
    expect(row.creditor_name).toBe('FNB Credit Card');
    expect(row.outstanding_balance_cents).toBe(100000);
    expect(row.is_paid_off).toBe(0);
  });

  it('returns entity with initialBalanceCents equal to outstandingBalanceCents', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateDebtUseCase(mockDb, mockAudit, input, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.initialBalanceCents).toBe(100000);
      expect(result.data.totalPaidCents).toBe(0);
      expect(result.data.isPaidOff).toBe(false);
    }
  });
});
