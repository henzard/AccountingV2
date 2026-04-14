import { DrizzleHouseholdRepository } from '../DrizzleHouseholdRepository';
import type { HouseholdRow } from '../../../domain/ports/IHouseholdRepository';

const household: HouseholdRow = {
  id: 'h1',
  name: 'The Smiths',
  paydayDay: 25,
  userLevel: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  isSynced: false,
};

describe('DrizzleHouseholdRepository', () => {
  it('insert calls db.insert with isSynced:false', async () => {
    const insertValues = jest.fn().mockResolvedValue(undefined);
    const db = { insert: jest.fn().mockReturnValue({ values: insertValues }) } as any;
    const repo = new DrizzleHouseholdRepository(db);
    await repo.insert(household);
    expect(db.insert).toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'h1', isSynced: false }),
    );
  });

  it('findById returns null when no row found', async () => {
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      }),
    } as any;
    const repo = new DrizzleHouseholdRepository(db);
    const result = await repo.findById('h1');
    expect(result).toBeNull();
  });

  it('findById maps row to HouseholdRow', async () => {
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([household]),
      }),
    } as any;
    const repo = new DrizzleHouseholdRepository(db);
    const result = await repo.findById('h1');
    expect(result?.id).toBe('h1');
    expect(result?.paydayDay).toBe(25);
  });
});
