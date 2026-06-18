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

  beforeEach(() => {
    jest.clearAllMocks();
  });

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

describe('PendingSyncTable.incrementRetry', () => {
  it('increments retryCount and updates lastAttemptedAt when row exists', async () => {
    const existingRow = {
      id: 'sync-1',
      tableName: 'envelopes',
      recordId: 'env-1',
      operation: 'INSERT',
      retryCount: 2,
      lastAttemptedAt: null,
      createdAt: '2026-06-01T00:00:00.000Z',
    };

    const setMock = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    const updateMock = jest.fn().mockReturnValue({ set: setMock });
    const getMock = jest.fn().mockResolvedValue(existingRow);
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            get: getMock,
          }),
        }),
      }),
      update: updateMock,
    } as any;

    const table = new PendingSyncTable(db);
    await table.incrementRetry('sync-1');
    expect(getMock).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(pendingSync);
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 3 }));
  });

  it('does nothing when row does not exist', async () => {
    const getMock = jest.fn().mockResolvedValue(undefined);
    const updateMock = jest.fn();
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            get: getMock,
          }),
        }),
      }),
      update: updateMock,
    } as any;

    const table = new PendingSyncTable(db);
    await table.incrementRetry('non-existent');
    expect(updateMock).not.toHaveBeenCalled();
  });
});
