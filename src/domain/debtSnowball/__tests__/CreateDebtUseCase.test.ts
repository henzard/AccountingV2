import { CreateDebtUseCase } from '../CreateDebtUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-debt-1' }));

const mockInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
const mockSelect = jest.fn().mockReturnValue({
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue([{ count: 0 }]),
  }),
});
const mockDb = { insert: mockInsert, select: mockSelect } as any;
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

  it('inserts debt and logs audit on success', async () => {
    const uc = new CreateDebtUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(2); // 1 for debts, 1 for pending_sync_queue
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
  });

  it('returns entity with initialBalanceCents equal to outstandingBalanceCents', async () => {
    const uc = new CreateDebtUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.initialBalanceCents).toBe(100000);
      expect(result.data.totalPaidCents).toBe(0);
      expect(result.data.isPaidOff).toBe(false);
    }
  });
});
