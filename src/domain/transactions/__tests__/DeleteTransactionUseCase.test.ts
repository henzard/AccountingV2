import { DeleteTransactionUseCase } from '../DeleteTransactionUseCase';
import type { TransactionEntity } from '../TransactionEntity';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-sync-1' }));

const mockDelete = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
const mockUpdate = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
});
const mockInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
const mockSelect = jest.fn().mockReturnValue({
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockResolvedValue([]),
});
const mockDb = {
  delete: mockDelete,
  update: mockUpdate,
  insert: mockInsert,
  select: mockSelect,
} as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

const tx: TransactionEntity = {
  id: 't1',
  householdId: 'h1',
  envelopeId: 'e1',
  amountCents: 3000,
  payee: 'Woolworths',
  description: null,
  transactionDate: '2026-04-10',
  isBusinessExpense: false,
  spendingTriggerNote: null,
  createdAt: '2026-04-10T10:00:00.000Z',
  updatedAt: '2026-04-10T10:00:00.000Z',
};

describe('DeleteTransactionUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes transaction row', async () => {
    const uc = new DeleteTransactionUseCase(mockDb, mockAudit, tx);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('decrements envelope spentCents', async () => {
    const uc = new DeleteTransactionUseCase(mockDb, mockAudit, tx);
    await uc.execute();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('logs audit event with action=delete', async () => {
    const uc = new DeleteTransactionUseCase(mockDb, mockAudit, tx);
    await uc.execute();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', entityId: 't1' }),
    );
  });
});
