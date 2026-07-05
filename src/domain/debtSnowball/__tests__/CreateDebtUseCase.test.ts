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

// CreateDebtUseCase no longer queries the db to derive sortOrder (H8 fix —
// see CreateDebtUseCase.ts) — it derives sortOrder from the input balance
// directly, so `this.db` is only ever passed through to `resolveSyncedRepo`,
// which is overridden by the injected fake `repo` in every test below.
const mockDb = {} as any;
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
    expect(row.sort_order).toBe(100000);
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

  // H8 (exhaustive audit): sortOrder used to be the household's existing
  // debt COUNT, i.e. pure insertion order — a R500,000 bond entered BEFORE a
  // R2,000 credit card would get sortOrder 0 (the snowball focus) and the
  // card sortOrder 1, inverting the Ramsey "smallest balance first" method
  // both DebtEntity.sortOrder and SnowballPayoffProjector document. Proves
  // sortOrder now tracks balance ascending regardless of entry order.
  it('assigns sortOrder from balance so smallest-balance-first ordering holds regardless of entry order', async () => {
    const bondRepo = makeFakeRepo();
    const bondUc = new CreateDebtUseCase(
      mockDb,
      mockAudit,
      {
        ...input,
        creditorName: 'Home Bond',
        debtType: 'bond' as const,
        outstandingBalanceCents: 50_000_000, // R500,000, entered FIRST
      },
      { repo: bondRepo },
    );
    await bondUc.execute();
    const [bondRow] = bondRepo.insert.mock.calls[0];

    const cardRepo = makeFakeRepo();
    const cardUc = new CreateDebtUseCase(
      mockDb,
      mockAudit,
      {
        ...input,
        creditorName: 'Credit Card',
        outstandingBalanceCents: 200_000, // R2,000, entered SECOND
      },
      { repo: cardRepo },
    );
    await cardUc.execute();
    const [cardRow] = cardRepo.insert.mock.calls[0];

    // The smaller-balance debt (entered second) must sort BEFORE the
    // larger-balance debt (entered first) — the opposite of the pre-fix
    // insertion-count behavior, and what SnowballPayoffProjector's ascending
    // sortOrder sort relies on to give the extra payment to the right debt.
    expect(cardRow.sort_order).toBeLessThan(bondRow.sort_order);
    expect(cardRow.sort_order).toBe(200_000);
    expect(bondRow.sort_order).toBe(50_000_000);
  });
});
