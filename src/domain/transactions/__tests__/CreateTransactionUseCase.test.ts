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

  // REFUNDS: a negative amountCents is a refund / reversal / store credit and
  // is written to the ledger verbatim. This case previously asserted the
  // opposite; the domain rule deliberately changed from "greater than zero"
  // to "non-zero" (see transactionValidation).
  it('inserts a NEGATIVE amountCents verbatim (a refund)', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, amountCents: -2500 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amountCents).toBe(-2500);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.insert.mock.calls[0][0]).toMatchObject({ amount_cents: -2500 });
  });

  it('still rejects a refund against an income envelope', async () => {
    mockDb.select = makeSelectMock([{ id: 'e1', envelopeType: 'income' }]);
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, amountCents: -2500 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_ENVELOPE_TYPE');
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('rejects an absurdly large negative amount just like an absurdly large positive one', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, amountCents: -(Number.MAX_SAFE_INTEGER + 10) },
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
        is_business_expense: 0,
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

  // New validations for amountCents, transactionDate, and envelope state
  it('returns INVALID_AMOUNT when amountCents is NaN', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, amountCents: NaN },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('returns INVALID_AMOUNT when amountCents is fractional', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, amountCents: 12.5 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('returns INVALID_DATE when transactionDate has invalid format', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, transactionDate: '2026-13-40' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_DATE');
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('returns INVALID_DATE when transactionDate is not a valid calendar date', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, transactionDate: '2026-02-30' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_DATE');
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('returns FUTURE_DATE when transactionDate is more than 1 day in the future', async () => {
    const repo = makeFakeRepo();
    // Get tomorrow's date and add 2 days to create a date 2+ days in the future
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const futureDateStr = futureDate.toISOString().split('T')[0];

    const uc = new CreateTransactionUseCase(
      mockDb,
      mockAudit,
      { ...input, transactionDate: futureDateStr },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('FUTURE_DATE');
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('returns ENVELOPE_ARCHIVED when target envelope is archived', async () => {
    const repo = makeFakeRepo();
    mockDb.select = makeSelectMock([
      { id: 'e1', envelopeType: 'spending', isArchived: true, deletedAt: null },
    ]);
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_ARCHIVED');
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('returns ENVELOPE_ARCHIVED when target envelope is soft-deleted', async () => {
    const repo = makeFakeRepo();
    mockDb.select = makeSelectMock([
      { id: 'e1', envelopeType: 'spending', isArchived: false, deletedAt: '2026-01-01T00:00:00Z' },
    ]);
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_ARCHIVED');
    expect(repo.insert).not.toHaveBeenCalled();
  });
});
