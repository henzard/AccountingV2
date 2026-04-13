import { CreateTransactionUseCase } from '../CreateTransactionUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

const mockInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
const mockUpdate = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
});
// Helper: build a mockSelect that returns envelopeRows on first call, [] on subsequent calls
function makeSelectMock(envelopeRows: unknown[]) {
  let callCount = 0;
  return jest.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(envelopeRows) }),
        }),
      };
    }
    return {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };
  });
}
const mockSelect = makeSelectMock([{ id: 'e1', envelopeType: 'spending' }]);
const mockDb = { insert: mockInsert, update: mockUpdate, select: mockSelect } as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

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
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, { ...input, amountCents: 0 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('returns failure when amountCents is negative', async () => {
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, { ...input, amountCents: -100 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('inserts transaction and updates spentCents on success', async () => {
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(2); // 1 for transaction, 1 for pending_sync_queue
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
  });

  it('returns transaction entity with correct id and fields', async () => {
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('uuid-1');
      expect(result.data.amountCents).toBe(5000);
      expect(result.data.envelopeId).toBe('e1');
    }
  });

  it('returns INVALID_ENVELOPE_TYPE when target envelope is an income envelope', async () => {
    // Simulate envelope lookup returning an income envelope
    mockDb.select = makeSelectMock([{ id: 'e1', envelopeType: 'income' }]);
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_ENVELOPE_TYPE');
    }
    // No insert or update should have occurred
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns ENVELOPE_NOT_FOUND when envelope lookup returns empty', async () => {
    // Simulate envelope lookup returning nothing (stale id / race)
    mockDb.select = makeSelectMock([]);
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    }
    // No insert or update should have occurred
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns ENVELOPE_NOT_FOUND when envelope belongs to a different household', async () => {
    // The envelope exists in the DB but the query is scoped to (envelopeId AND householdId).
    // When those don't match, the DB returns no rows — simulated here as an empty result.
    mockDb.select = makeSelectMock([]);
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, {
      ...input,
      householdId: 'h-other', // different household than envelope's owner
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    }
    // Must not insert a transaction or update spentCents
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('persists slipId when provided', async () => {
    const insertValues = jest.fn().mockResolvedValue(undefined);
    mockDb.insert = jest.fn().mockReturnValue({ values: insertValues });
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, { ...input, slipId: 'slip-1' });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    // Verify slipId was included in the insert values
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ slipId: 'slip-1' }));
  });
});
