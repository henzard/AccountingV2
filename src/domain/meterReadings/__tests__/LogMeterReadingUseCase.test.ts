import { LogMeterReadingUseCase } from '../LogMeterReadingUseCase';
import type { IMeterReadingRepository } from '../../ports/IMeterReadingRepository';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-meter-1' }));

const mockDb = {} as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

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

function makeMockMeterRepo(existing: any = null): IMeterReadingRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByHousehold: jest.fn().mockResolvedValue([]),
    findByDate: jest.fn().mockResolvedValue(existing),
    insert: jest.fn().mockResolvedValue(undefined),
  };
}

const input = {
  householdId: 'h1',
  meterType: 'electricity' as const,
  readingValue: 1500,
  readingDate: '2026-04-01',
  costCents: 52500,
  vehicleId: null,
  notes: null,
};

describe('LogMeterReadingUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns failure when readingValue is 0', async () => {
    const meterRepo = makeMockMeterRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, readingValue: 0 },
      {},
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('returns failure when readingValue is negative', async () => {
    const meterRepo = makeMockMeterRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, readingValue: -10 },
      {},
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('returns DUPLICATE_READING when same meter type and date exists', async () => {
    const existingReading = {
      id: 'existing-1',
      householdId: 'h1',
      meterType: 'electricity',
      readingValue: 1400,
      readingDate: '2026-04-01',
      costCents: 50000,
      vehicleId: null,
      notes: null,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    };
    const meterRepo = makeMockMeterRepo(existingReading);
    const repo = makeFakeRepo();
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input, { repo }, meterRepo);
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('DUPLICATE_READING');
    }
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('inserts reading via the synced repo (exactly one oplog op) and logs audit', async () => {
    const meterRepo = makeMockMeterRepo();
    const repo = makeFakeRepo();
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input, { repo }, meterRepo);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.update).not.toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledTimes(1);

    const [row] = repo.insert.mock.calls[0];
    expect(row.household_id).toBe('h1');
    expect(row.meter_type).toBe('electricity');
    expect(row.reading_value).toBe(1500);
  });

  it('returns entity with correct id and fields', async () => {
    const meterRepo = makeMockMeterRepo();
    const repo = makeFakeRepo();
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input, { repo }, meterRepo);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('uuid-meter-1');
      expect(result.data.meterType).toBe('electricity');
      expect(result.data.readingValue).toBe(1500);
      expect(result.data.costCents).toBe(52500);
    }
  });
});
