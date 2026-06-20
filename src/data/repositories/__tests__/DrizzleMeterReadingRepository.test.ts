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
  it('insert calls db.insert with correct data shape and isSynced:false', async () => {
    const valuesFn = jest.fn().mockResolvedValue(undefined);
    const insertFn = jest.fn().mockReturnValue({ values: valuesFn });
    const db = { insert: insertFn } as any;
    const repo = new DrizzleMeterReadingRepository(db);

    await repo.insert(reading);

    expect(insertFn).toHaveBeenCalled();
    expect(valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mr1',
        householdId: 'h1',
        meterType: 'electricity',
        readingValue: 1234.5,
        readingDate: '2024-06-01',
        costCents: 45000,
        isSynced: false,
      }),
    );
  });

  it('findById returns null when no row found', async () => {
    const limitFn = jest.fn().mockResolvedValue([]);
    const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    const db = { select: selectFn } as any;
    const repo = new DrizzleMeterReadingRepository(db);

    const result = await repo.findById('mr1', 'h1');

    expect(result).toBeNull();
  });

  it('findById maps row to entity with nullable fields', async () => {
    const row = { ...reading, costCents: null, vehicleId: null, notes: null };
    const limitFn = jest.fn().mockResolvedValue([row]);
    const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    const db = { select: selectFn } as any;
    const repo = new DrizzleMeterReadingRepository(db);

    const result = await repo.findById('mr1', 'h1');

    expect(result?.id).toBe('mr1');
    expect(result?.costCents).toBeNull();
    expect(result?.meterType).toBe('electricity');
  });

  it('findByHousehold returns readings ordered by date', async () => {
    const rows = [reading, { ...reading, id: 'mr2', readingDate: '2024-05-01' }];
    const orderByFn = jest.fn().mockResolvedValue(rows);
    const whereFn = jest.fn().mockReturnValue({ orderBy: orderByFn });
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    const db = { select: selectFn } as any;
    const repo = new DrizzleMeterReadingRepository(db);

    const result = await repo.findByHousehold('h1');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('mr1');
    expect(orderByFn).toHaveBeenCalled();
    expect(whereFn).toHaveBeenCalled();
  });

  it('findByHousehold filters by meterType when provided', async () => {
    const orderByFn = jest.fn().mockResolvedValue([reading]);
    const whereFn = jest.fn().mockReturnValue({ orderBy: orderByFn });
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    const db = { select: selectFn } as any;
    const repo = new DrizzleMeterReadingRepository(db);

    const result = await repo.findByHousehold('h1', 'electricity');

    expect(result).toHaveLength(1);
    expect(whereFn).toHaveBeenCalledTimes(1);
    const filterPredicate = whereFn.mock.calls[0][0];
    expect(filterPredicate).toBeDefined();
  });

  it('findByDate returns null when no matching reading exists', async () => {
    const limitFn = jest.fn().mockResolvedValue([]);
    const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    const db = { select: selectFn } as any;
    const repo = new DrizzleMeterReadingRepository(db);

    const result = await repo.findByDate('h1', 'electricity', '2024-06-01');

    expect(result).toBeNull();
  });

  it('findByDate returns entity when matching reading exists', async () => {
    const limitFn = jest.fn().mockResolvedValue([reading]);
    const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    const db = { select: selectFn } as any;
    const repo = new DrizzleMeterReadingRepository(db);

    const result = await repo.findByDate('h1', 'electricity', '2024-06-01');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('mr1');
    expect(result?.readingDate).toBe('2024-06-01');
  });
});
