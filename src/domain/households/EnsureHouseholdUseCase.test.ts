jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

import { EnsureHouseholdUseCase } from './EnsureHouseholdUseCase';

describe('EnsureHouseholdUseCase', () => {
  it('returns existing household when a membership row exists', async () => {
    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([{ householdId: 'hh-1', role: 'owner' }]) }),
          }),
        })
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([{ id: 'hh-1', name: 'My Household', paydayDay: 25, userLevel: 1 }]) }),
          }),
        }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
          then: jest.fn(), // make it thenable for await
        }),
      }),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const uc = new EnsureHouseholdUseCase(db as any, audit as any, 'user-1');
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('hh-1');
  });

  it('creates new household + membership when none exists', async () => {
    const insertedRows: unknown[] = [];
    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      insert: jest.fn().mockReturnValue({
        values: (row: unknown) => {
          insertedRows.push(row);
          return {
            onConflictDoNothing: () => Promise.resolve(undefined),
            then: (resolve: (v: undefined) => void) => { resolve(undefined); return Promise.resolve(undefined); },
          };
        },
      }),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const uc = new EnsureHouseholdUseCase(db as any, audit as any, 'user-1');
    const result = await uc.execute();
    expect(result.success).toBe(true);
    // Should have inserted household, household_members row, and 2 pending_sync rows
    expect(insertedRows.length).toBeGreaterThanOrEqual(2);
  });
});
