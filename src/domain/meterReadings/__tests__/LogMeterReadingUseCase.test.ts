import { LogMeterReadingUseCase } from '../LogMeterReadingUseCase';
import type { IMeterReadingRepository } from '../../ports/IMeterReadingRepository';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-meter-1' }));

const mockInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
const mockSelect = jest.fn().mockReturnValue({
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockResolvedValue([]),
});
const mockDb = { insert: mockInsert, select: mockSelect } as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;
const mockEnqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) } as any;

function makeMockRepo(existing: any = null): IMeterReadingRepository {
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
    const repo = makeMockRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, readingValue: 0 },
      mockEnqueuer,
      repo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('returns failure when readingValue is negative', async () => {
    const repo = makeMockRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, readingValue: -10 },
      mockEnqueuer,
      repo,
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
      isSynced: true,
    };
    const repo = makeMockRepo(existingReading);
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input, mockEnqueuer, repo);
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('DUPLICATE_READING');
    }
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('inserts reading and logs audit on success', async () => {
    const repo = makeMockRepo();
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input, mockEnqueuer, repo);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
  });

  it('returns entity with correct id and fields', async () => {
    const repo = makeMockRepo();
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input, mockEnqueuer, repo);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('uuid-meter-1');
      expect(result.data.meterType).toBe('electricity');
      expect(result.data.readingValue).toBe(1500);
      expect(result.data.costCents).toBe(52500);
      expect(result.data.isSynced).toBe(false);
    }
  });
});
