import { CreateTransactionUseCase } from '../CreateTransactionUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

const mockInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
const mockUpdate = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
});
const mockDb = { insert: mockInsert, update: mockUpdate } as any;
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
  beforeEach(() => jest.clearAllMocks());

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
    expect(mockInsert).toHaveBeenCalledTimes(1);
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
});
