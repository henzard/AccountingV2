import { DrizzleSlipQueueRepository } from '../DrizzleSlipQueueRepository';

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

    const repo = new DrizzleSlipQueueRepository(db);
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
