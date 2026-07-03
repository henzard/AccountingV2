import { DeleteTransactionUseCase } from '../DeleteTransactionUseCase';
import type { TransactionEntity } from '../TransactionEntity';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-sync-1' }));

const mockDb = {} as any;
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

  it('soft-deletes the transaction row via the synced repo', async () => {
    const repo = makeFakeRepo();
    const uc = new DeleteTransactionUseCase(mockDb, mockAudit, tx, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.softDelete).toHaveBeenCalledTimes(1);
    expect(repo.softDelete).toHaveBeenCalledWith('t1', 'h1', expect.any(Object));
  });

  it('does NOT touch the envelope (no update/increment call)', async () => {
    const repo = makeFakeRepo();
    const uc = new DeleteTransactionUseCase(mockDb, mockAudit, tx, { repo });
    await uc.execute();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.increment).not.toHaveBeenCalled();
  });

  it('logs audit event with action=delete', async () => {
    const repo = makeFakeRepo();
    const uc = new DeleteTransactionUseCase(mockDb, mockAudit, tx, { repo });
    await uc.execute();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', entityId: 't1' }),
    );
  });

  it('returns TRANSACTION_NOT_FOUND when the repo softDelete matches 0 rows (race/double-delete)', async () => {
    const repo = makeFakeRepo();
    repo.softDelete.mockImplementation(() => {
      throw new Error('createSyncedRepo: no row in "transactions" matched id=t1 household_id=h1');
    });
    const uc = new DeleteTransactionUseCase(mockDb, mockAudit, tx, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TRANSACTION_NOT_FOUND');
    }
    // Must not log an audit event for a delete that never happened.
    expect(mockAudit.log).not.toHaveBeenCalled();
  });

  it('uses a default synced repo (createSyncedRepo over db) when none is injected', async () => {
    const dbWithRun = {
      transaction: jest.fn((fn: any) => fn({ run: jest.fn().mockReturnValue({ changes: 1 }) })),
    } as any;
    const uc = new DeleteTransactionUseCase(dbWithRun, mockAudit, tx);
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('succeeds (does not fail execute or soft-delete twice) when audit.log throws after the ledger commit', async () => {
    const repo = makeFakeRepo();
    const failingAudit = { log: jest.fn().mockRejectedValue(new Error('audit db unavailable')) };
    const uc = new DeleteTransactionUseCase(mockDb, failingAudit as any, tx, { repo });

    const result = await uc.execute();

    expect(result.success).toBe(true);
    // The soft-delete is the source of truth and already committed by the
    // time audit.log runs — exactly one call, even though audit failed.
    expect(repo.softDelete).toHaveBeenCalledTimes(1);
  });
});
