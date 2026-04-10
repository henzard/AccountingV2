jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

import { PendingSyncTable } from './PendingSyncTable';
import { db } from '../local/db';
import { pendingSync } from '../local/schema';

jest.mock('../local/db', () => ({
  db: {
    insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
    delete: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockResolvedValue([]),
    }),
  },
}));

describe('PendingSyncTable', () => {
  const table = new PendingSyncTable(db as any);

  it('enqueues a record for sync', async () => {
    await table.enqueue({ tableName: 'envelopes', recordId: 'env-1', operation: 'INSERT' });
    expect(db.insert).toHaveBeenCalledWith(pendingSync);
  });

  it('dequeues a record by id', async () => {
    await table.dequeue('sync-row-id');
    expect(db.delete).toHaveBeenCalledWith(pendingSync);
  });

  it('returns pending items', async () => {
    const items = await table.getPending();
    expect(Array.isArray(items)).toBe(true);
  });
});
