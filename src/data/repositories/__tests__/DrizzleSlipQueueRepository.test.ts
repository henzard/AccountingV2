// Mock PendingSyncEnqueuerAdapter before importing the repo, to avoid pulling
// in PendingSyncEnqueuer → expo-crypto (out-of-scope in Jest test environment).
jest.mock('../PendingSyncEnqueuerAdapter', () => ({
  PendingSyncEnqueuerAdapter: jest.fn().mockImplementation(() => ({
    enqueue: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { DrizzleSlipQueueRepository } from '../DrizzleSlipQueueRepository';

// Provide a no-op enqueuer to bypass the default adapter when needed.
const noopEnqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) };

describe('DrizzleSlipQueueRepository', () => {
  it('creates a row and reads it back', async () => {
    const insertChain = { values: jest.fn().mockResolvedValue(undefined) };
    const selectChain = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: 's1',
          householdId: 'h1',
          createdBy: 'u1',
          imageUris: '["a/b/0.jpg"]',
          status: 'processing',
          errorMessage: null,
          merchant: null,
          slipDate: null,
          totalCents: null,
          rawResponseJson: null,
          imagesDeletedAt: null,
          openaiCostCents: 0,
          createdAt: 'now',
          updatedAt: 'now',
        },
      ]),
    };
    const db = {
      insert: jest.fn().mockReturnValue(insertChain),
      select: jest.fn().mockReturnValue(selectChain),
    } as any;

    const repo = new DrizzleSlipQueueRepository(db, noopEnqueuer);
    await repo.create({
      id: 's1',
      householdId: 'h1',
      createdBy: 'u1',
      imageUris: ['a/b/0.jpg'],
      status: 'processing',
      createdAt: 'now',
      updatedAt: 'now',
    });

    expect(db.insert).toHaveBeenCalled();
    const row = await repo.get('s1');
    expect(row?.id).toBe('s1');
    expect(row?.imageUris).toEqual(['a/b/0.jpg']);
  });
});
