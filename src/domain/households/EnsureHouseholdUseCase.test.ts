jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

import { EnsureHouseholdUseCase } from './EnsureHouseholdUseCase';

describe('EnsureHouseholdUseCase', () => {
  it('returns existing household when a membership row exists', async () => {
    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ householdId: 'hh-1', role: 'owner' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  { id: 'hh-1', name: 'My Household', paydayDay: 25, userLevel: 1 },
                ]),
            }),
          }),
        }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
          then: jest.fn(), // make it thenable for await
        }),
      }),
    };
    const uc = new EnsureHouseholdUseCase(db as any, 'user-1');
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('hh-1');
  });

  it('returns failure when user has no household (new user — create/join choice deferred to UI)', async () => {
    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce({
          from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
        })
        .mockReturnValueOnce({
          from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
        }),
      insert: jest.fn(),
    };
    const uc = new EnsureHouseholdUseCase(db as any, 'new-user-id');
    const result = await uc.execute();
    expect(result.success).toBe(false);
    // Must NOT have inserted anything — household creation is now explicit via UI
    expect(db.insert).not.toHaveBeenCalled();
  });
});
