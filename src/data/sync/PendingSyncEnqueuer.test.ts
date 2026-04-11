jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

import { PendingSyncEnqueuer } from './PendingSyncEnqueuer';

describe('PendingSyncEnqueuer', () => {
  it('inserts a pending_sync row with correct fields', async () => {
    const insertedRows: unknown[] = [];
    const mockDb = {
      insert: () => ({
        values: (row: unknown) => {
          insertedRows.push(row);
          return Promise.resolve();
        },
      }),
    } as any;

    const enqueuer = new PendingSyncEnqueuer(mockDb);
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
    const insertedRows: unknown[] = [];
    const mockDb = {
      insert: () => ({ values: (row: unknown) => { insertedRows.push(row); return Promise.resolve(); } }),
    } as any;

    const enqueuer = new PendingSyncEnqueuer(mockDb);
    await enqueuer.enqueue('transactions', 'tx-1', 'DELETE');

    expect((insertedRows[0] as any).operation).toBe('DELETE');
  });
});
