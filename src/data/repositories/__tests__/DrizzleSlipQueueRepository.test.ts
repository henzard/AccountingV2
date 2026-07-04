import { DrizzleSlipQueueRepository } from '../DrizzleSlipQueueRepository';
import type { SyncedRepo } from '../../uow/createSyncedRepo';

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

describe('DrizzleSlipQueueRepository', () => {
  it('creates a row via the synced repo (one oplog op) and reads it back', async () => {
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
      select: jest.fn().mockReturnValue(selectChain),
    } as any;

    const repo = makeFakeRepo();
    const slipRepo = new DrizzleSlipQueueRepository(db, { repo });
    await slipRepo.create({
      id: 's1',
      householdId: 'h1',
      createdBy: 'u1',
      imageUris: ['a/b/0.jpg'],
      status: 'processing',
      createdAt: 'now',
      updatedAt: 'now',
    });

    expect(repo.insert).toHaveBeenCalledTimes(1);
    const [row] = repo.insert.mock.calls[0];
    expect(row).toEqual(
      expect.objectContaining({
        id: 's1',
        household_id: 'h1',
        created_by: 'u1',
        image_uris: '["a/b/0.jpg"]',
        status: 'processing',
      }),
    );
    const readBack = await slipRepo.get('s1');
    expect(readBack?.id).toBe('s1');
    expect(readBack?.imageUris).toEqual(['a/b/0.jpg']);
  });
});
