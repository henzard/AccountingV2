import { CreateTransactionUseCase } from '../CreateTransactionUseCase';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

// Helper: build a mockSelect that returns envelopeRows on first call, [] on subsequent calls
function makeSelectMock(envelopeRows: unknown[]) {
  return jest.fn().mockImplementation(() => ({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(envelopeRows) }),
    }),
  }));
}
const mockDb = {
  select: makeSelectMock([{ id: 'e1', envelopeType: 'spending' }]),
} as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

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

const input = {
  householdId: 'h1',
  envelopeId: 'e1',
  amountCents: 5000,
  payee: 'Pick n Pay',
  description: null,
  transactionDate: '2026-04-10',
};

describe('CreateTransactionUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the select mock to the default envelope each test
    mockDb.select = makeSelectMock([{ id: 'e1', envelopeType: 'spending' }]);
  });

  it('returns failure when amountCents is 0', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, amountCents: 0 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('returns failure when amountCents is negative', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, amountCents: -100 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('inserts the transaction row via the synced repo and does NOT touch the envelope', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.increment).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
  });

  it('inserts a row with snake_case columns matching the transactions table, no spentCents anywhere', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input, { repo });
    await uc.execute();
    const [row] = repo.insert.mock.calls[0];
    expect(row).toEqual(
      expect.objectContaining({
        id: 'uuid-1',
        household_id: 'h1',
        envelope_id: 'e1',
        amount_cents: 5000,
        payee: 'Pick n Pay',
        description: null,
        transaction_date: '2026-04-10',
        is_business_expense: false,
        spending_trigger_note: null,
        slip_id: null,
      }),
    );
    expect(row).not.toHaveProperty('is_synced');
    expect(JSON.stringify(row)).not.toMatch(/spent_cents|spentCents/);
  });

  it('returns transaction entity with correct id and fields', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('uuid-1');
      expect(result.data.amountCents).toBe(5000);
      expect(result.data.envelopeId).toBe('e1');
    }
  });

  it('returns INVALID_ENVELOPE_TYPE when target envelope is an income envelope', async () => {
    const repo = makeFakeRepo();
    mockDb.select = makeSelectMock([{ id: 'e1', envelopeType: 'income' }]);
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_ENVELOPE_TYPE');
    }
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('returns ENVELOPE_NOT_FOUND when envelope lookup returns empty', async () => {
    const repo = makeFakeRepo();
    mockDb.select = makeSelectMock([]);
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    }
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('returns ENVELOPE_NOT_FOUND when envelope belongs to a different household', async () => {
    const repo = makeFakeRepo();
    mockDb.select = makeSelectMock([]);
    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, householdId: 'h-other' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    }
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('persists slipId when provided', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, slipId: 'slip-1' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    const [row] = repo.insert.mock.calls[0];
    expect(row).toEqual(expect.objectContaining({ slip_id: 'slip-1' }));
  });

  it('uses a default synced repo (createSyncedRepo over db) when none is injected', async () => {
    // No repo injected — the use case must fall back to a real createSyncedRepo(db, ...)
    // rather than throwing. We only assert it doesn't crash constructing one; the real
    // wiring is covered by the createSyncedRepo realsql tests.
    const dbWithRun = {
      ...mockDb,
      transaction: jest.fn((fn: any) => fn({ run: jest.fn().mockReturnValue({ changes: 1 }) })),
    };
    const uc = new CreateTransactionUseCase(dbWithRun, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('succeeds (does not fail execute or write twice) when audit.log throws after the ledger commit', async () => {
    const repo = makeFakeRepo();
    const failingAudit = { log: jest.fn().mockRejectedValue(new Error('audit db unavailable')) };
    const uc = new CreateTransactionUseCase(mockDb, failingAudit as any, input, { repo });

    const result = await uc.execute();

    expect(result.success).toBe(true);
    // The ledger write is the source of truth and already committed by the
    // time audit.log runs — exactly one insert, even though audit failed.
    expect(repo.insert).toHaveBeenCalledTimes(1);
  });
});
