import { ImportCSVUseCase } from '../ImportCSVUseCase';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';
import type { CSVTransactionRow } from '../ImportCSVUseCase';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-' + Math.random().toString(36).substring(7)),
}));

function makeSelectMock(envelopeRows: unknown[], transactionRows: unknown[] = []) {
  let callCount = 0;
  return jest.fn().mockImplementation(() => {
    const whereResult = {
      limit: jest.fn().mockResolvedValue(envelopeRows),
    };
    // Make whereResult thenable so it can be awaited directly
    Object.assign(whereResult, {
      then: (resolve: any) => {
        const result = callCount++ === 0 ? envelopeRows : transactionRows;
        return Promise.resolve(result).then(resolve);
      },
    });
    return {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue(whereResult),
      }),
    };
  });
}

const mockDb = {
  select: makeSelectMock([{ id: 'env-1', envelopeType: 'spending' }]),
} as any;

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

function makeFakeRepo(): SyncedRepo & { insert: jest.Mock } {
  return {
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  };
}

const sampleRows: CSVTransactionRow[] = [
  { date: '2026-09-15', description: 'Pick n Pay', amount: 12550, payee: 'Pick n Pay' },
  { date: '2026-09-16', description: 'Shell Fuel', amount: 8500, payee: 'Shell' },
];

describe('ImportCSVUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.select = makeSelectMock([{ id: 'env-1', envelopeType: 'spending' }]);
  });

  it('imports transactions successfully', async () => {
    const repo = makeFakeRepo();
    const uc = new ImportCSVUseCase(
      mockDb,
      mockAudit,
      {
        householdId: 'hh-1',
        envelopeId: 'env-1',
        rows: sampleRows,
      },
      { repo },
    );

    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(2);
      expect(result.data.skipped).toBe(0);
      expect(result.data.errors).toHaveLength(0);
    }
    expect(repo.insert).toHaveBeenCalledTimes(2);
  });

  it('skips duplicate transactions based on hash', async () => {
    const repo = makeFakeRepo();

    // Compute what the hashes will be for the sample rows
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createTransactionHash } = require('../transactionHash');
    const hash1 = createTransactionHash(
      sampleRows[0].date,
      sampleRows[0].amount,
      sampleRows[0].payee!,
    );
    const hash2 = createTransactionHash(
      sampleRows[1].date,
      sampleRows[1].amount,
      sampleRows[1].payee!,
    );

    // First call: envelope validation (returns envelope with .limit())
    // Second call: existing hash check (returns hashes, awaited directly from .where())
    const existingHashes = [{ transactionHash: hash1 }, { transactionHash: hash2 }];

    mockDb.select = jest
      .fn()
      .mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'env-1', envelopeType: 'spending' }]),
          }),
        }),
      }))
      .mockImplementationOnce(() => {
        const whereResult = {
          limit: jest.fn(), // Not used in this query
        };
        Object.assign(whereResult, {
          then: (resolve: any) => Promise.resolve(existingHashes).then(resolve),
        });
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue(whereResult),
          }),
        };
      });

    const uc = new ImportCSVUseCase(
      mockDb,
      mockAudit,
      {
        householdId: 'hh-1',
        envelopeId: 'env-1',
        rows: sampleRows,
      },
      { repo },
    );

    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      // Both transactions should be skipped since we return existing hashes
      expect(result.data.skipped).toBe(2);
      expect(result.data.imported).toBe(0);
    }
  });

  it('validates target envelope exists', async () => {
    mockDb.select = makeSelectMock([]); // Empty envelope result
    const repo = makeFakeRepo();

    const uc = new ImportCSVUseCase(
      mockDb,
      mockAudit,
      {
        householdId: 'hh-1',
        envelopeId: 'env-missing',
        rows: sampleRows,
      },
      { repo },
    );

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    }
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('rejects import to income envelope', async () => {
    mockDb.select = makeSelectMock([{ id: 'env-1', envelopeType: 'income' }]);
    const repo = makeFakeRepo();

    const uc = new ImportCSVUseCase(
      mockDb,
      mockAudit,
      {
        householdId: 'hh-1',
        envelopeId: 'env-1',
        rows: sampleRows,
      },
      { repo },
    );

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_ENVELOPE_TYPE');
    }
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('maps transactions to envelopes via keyword matching', async () => {
    mockDb.select = jest
      .fn()
      .mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'env-default', envelopeType: 'spending' }]),
          }),
        }),
      }))
      .mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { id: 'env-groceries', envelopeType: 'spending' },
            { id: 'env-fuel', envelopeType: 'spending' },
          ]),
        }),
      }))
      .mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]), // No existing hashes
        }),
      }));

    const repo = makeFakeRepo();

    const uc = new ImportCSVUseCase(
      mockDb,
      mockAudit,
      {
        householdId: 'hh-1',
        envelopeId: 'env-default',
        rows: [
          { date: '2026-09-15', description: 'Pick n Pay Groceries', amount: 12550 },
          { date: '2026-09-16', description: 'Shell Fuel Station', amount: 8500 },
          { date: '2026-09-17', description: 'Random Store', amount: 5000 },
        ],
        keywordMapping: {
          groceries: 'env-groceries',
          fuel: 'env-fuel',
        },
      },
      { repo },
    );

    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(3);
    }

    expect(repo.insert).toHaveBeenCalledTimes(3);

    const firstCall = repo.insert.mock.calls[0][0];
    expect(firstCall.envelope_id).toBe('env-groceries');

    const secondCall = repo.insert.mock.calls[1][0];
    expect(secondCall.envelope_id).toBe('env-fuel');

    const thirdCall = repo.insert.mock.calls[2][0];
    expect(thirdCall.envelope_id).toBe('env-default');
  });

  it('validates mapped envelopes exist', async () => {
    mockDb.select = jest
      .fn()
      .mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'env-default', envelopeType: 'spending' }]),
          }),
        }),
      }))
      .mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]), // Mapped envelope not found
        }),
      }));

    const repo = makeFakeRepo();

    const uc = new ImportCSVUseCase(
      mockDb,
      mockAudit,
      {
        householdId: 'hh-1',
        envelopeId: 'env-default',
        rows: sampleRows,
        keywordMapping: {
          groceries: 'env-missing',
        },
      },
      { repo },
    );

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
      expect(result.error.message).toContain('env-missing');
    }
  });

  it('rejects rows with zero or negative amounts', async () => {
    const repo = makeFakeRepo();

    const uc = new ImportCSVUseCase(
      mockDb,
      mockAudit,
      {
        householdId: 'hh-1',
        envelopeId: 'env-1',
        rows: [
          { date: '2026-09-15', description: 'Valid', amount: 12550 },
          { date: '2026-09-16', description: 'Zero', amount: 0 },
          { date: '2026-09-17', description: 'Negative', amount: -100 },
        ],
      },
      { repo },
    );

    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(1);
      expect(result.data.errors).toHaveLength(2);
      expect(result.data.errors[0].reason).toContain('greater than zero');
    }
  });

  it('handles empty rows array', async () => {
    const repo = makeFakeRepo();

    const uc = new ImportCSVUseCase(
      mockDb,
      mockAudit,
      {
        householdId: 'hh-1',
        envelopeId: 'env-1',
        rows: [],
      },
      { repo },
    );

    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(0);
      expect(result.data.skipped).toBe(0);
      expect(result.data.errors).toHaveLength(0);
    }
  });

  it('includes transaction_hash in inserted rows', async () => {
    const repo = makeFakeRepo();

    const uc = new ImportCSVUseCase(
      mockDb,
      mockAudit,
      {
        householdId: 'hh-1',
        envelopeId: 'env-1',
        rows: [{ date: '2026-09-15', description: 'Test', amount: 10000 }],
      },
      { repo },
    );

    await uc.execute();

    expect(repo.insert).toHaveBeenCalledTimes(1);
    const insertedRow = repo.insert.mock.calls[0][0];
    expect(insertedRow.transaction_hash).toBeTruthy();
    expect(typeof insertedRow.transaction_hash).toBe('string');
    expect(insertedRow.transaction_hash.length).toBe(16);
  });

  it('logs to audit trail with csv_import source', async () => {
    const repo = makeFakeRepo();

    const uc = new ImportCSVUseCase(
      mockDb,
      mockAudit,
      {
        householdId: 'hh-1',
        envelopeId: 'env-1',
        rows: [{ date: '2026-09-15', description: 'Test', amount: 10000 }],
      },
      { repo },
    );

    await uc.execute();

    expect(mockAudit.log).toHaveBeenCalledTimes(1);
    const auditCall = mockAudit.log.mock.calls[0][0];
    expect(auditCall.action).toBe('create');
    expect(auditCall.entityType).toBe('transaction');
    expect(auditCall.newValue.source).toBe('csv_import');
  });

  it('continues importing after audit failure', async () => {
    const repo = makeFakeRepo();
    const failingAudit = { log: jest.fn().mockRejectedValue(new Error('audit unavailable')) };

    const uc = new ImportCSVUseCase(
      mockDb,
      failingAudit as any,
      {
        householdId: 'hh-1',
        envelopeId: 'env-1',
        rows: [{ date: '2026-09-15', description: 'Test', amount: 10000 }],
      },
      { repo },
    );

    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(1);
    }
    expect(repo.insert).toHaveBeenCalledTimes(1);
  });
});
