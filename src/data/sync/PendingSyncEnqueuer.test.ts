jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

import { PendingSyncEnqueuer } from './PendingSyncEnqueuer';

function makeDb(existingRows: unknown[] = []) {
  const insertedRows: unknown[] = [];
  const updatedRows: unknown[] = [];

  return {
    db: {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(existingRows),
      }),
      insert: () => ({
        values: (row: unknown) => {
          insertedRows.push(row);
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (data: unknown) => {
          updatedRows.push(data);
          return { where: jest.fn().mockResolvedValue(undefined) };
        },
      }),
    },
    insertedRows,
    updatedRows,
  };
}

describe('PendingSyncEnqueuer', () => {
  it('inserts a pending_sync row with correct fields when no existing entry', async () => {
    const { db, insertedRows } = makeDb([]);

    const enqueuer = new PendingSyncEnqueuer(db as any);
    await enqueuer.enqueue('envelopes', 'abc-123', 'INSERT');

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0] as any;
    expect(row.tableName).toBe('envelopes');
    expect(row.recordId).toBe('abc-123');
    expect(row.operation).toBe('INSERT');
    expect(row.retryCount).toBe(0);
    expect(row.lastAttemptedAt).toBeNull();
    expect(typeof row.id).toBe('string');
    expect(typeof row.createdAt).toBe('string');
  });

  it('accepts DELETE operation', async () => {
    const { db, insertedRows } = makeDb([]);

    const enqueuer = new PendingSyncEnqueuer(db as any);
    await enqueuer.enqueue('transactions', 'tx-1', 'DELETE');

    expect((insertedRows[0] as any).operation).toBe('DELETE');
  });

  it('deduplicates: 5 consecutive enqueues of same recordId produce one entry', async () => {
    // Simulate that after first insert, subsequent selects return the existing row
    let callCount = 0;
    const insertedRows: unknown[] = [];
    const updatedRows: unknown[] = [];

    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(callCount === 0 ? [] : [{ id: 'existing-row-id' }]),
      })),
      insert: () => ({
        values: (row: unknown) => {
          callCount++;
          insertedRows.push(row);
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (data: unknown) => {
          updatedRows.push(data);
          return { where: jest.fn().mockResolvedValue(undefined) };
        },
      }),
    } as any;

    const enqueuer = new PendingSyncEnqueuer(mockDb);
    // First call inserts
    await enqueuer.enqueue('envelopes', 'rec-1', 'INSERT');
    // Subsequent calls should update (dedup)
    await enqueuer.enqueue('envelopes', 'rec-1', 'UPDATE');
    await enqueuer.enqueue('envelopes', 'rec-1', 'UPDATE');
    await enqueuer.enqueue('envelopes', 'rec-1', 'UPDATE');
    await enqueuer.enqueue('envelopes', 'rec-1', 'UPDATE');

    // Only 1 insert happened
    expect(insertedRows).toHaveLength(1);
    // 4 updates happened (dedup path)
    expect(updatedRows).toHaveLength(4);
  });
});
