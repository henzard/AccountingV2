import { DrizzleMeterReadingRepository } from '../DrizzleMeterReadingRepository';
import type { MeterReadingEntity } from '../../../domain/meterReadings/MeterReadingEntity';

const reading: MeterReadingEntity = {
  id: 'mr1',
  householdId: 'h1',
  meterType: 'electricity',
  readingValue: 1234.5,
  readingDate: '2024-06-01',
  costCents: 45000,
  vehicleId: null,
  notes: null,
  createdAt: '2024-06-01T08:00:00.000Z',
  updatedAt: '2024-06-01T08:00:00.000Z',
  isSynced: false,
};

describe('DrizzleMeterReadingRepository', () => {
  it('insert calls db.insert with isSynced:false', async () => {
    const insertValues = jest.fn().mockResolvedValue(undefined);
    const db = { insert: jest.fn().mockReturnValue({ values: insertValues }) } as any;
    const repo = new DrizzleMeterReadingRepository(db);
    await repo.insert(reading);
    expect(db.insert).toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mr1', isSynced: false }),
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
    const repo = new DrizzleMeterReadingRepository(db);
    const result = await repo.findById('mr1', 'h1');
    expect(result).toBeNull();
  });

  it('findById maps row to entity with nullable fields', async () => {
    const row = { ...reading, costCents: null, vehicleId: null, notes: null };
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([row]),
      }),
    } as any;
    const repo = new DrizzleMeterReadingRepository(db);
    const result = await repo.findById('mr1', 'h1');
    expect(result?.id).toBe('mr1');
    expect(result?.costCents).toBeNull();
    expect(result?.meterType).toBe('electricity');
  });
});
