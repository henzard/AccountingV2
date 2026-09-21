import { LogMeterReadingUseCase } from '../LogMeterReadingUseCase';
import type { IMeterReadingRepository } from '../../ports/IMeterReadingRepository';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';
import { addDays, format } from 'date-fns';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-meter-1' }));
jest.mock('../../shared/bestEffortAudit', () => ({
  bestEffortAudit: jest.fn().mockResolvedValue(undefined),
}));

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
    findByHousehold: jest.fn().mockResolvedValue(existing ? [existing] : []),
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
    const { bestEffortAudit: mockBestEffortAudit } = jest.requireMock(
      '../../shared/bestEffortAudit',
    ) as { bestEffortAudit: jest.Mock };
    const meterRepo = makeMockMeterRepo();
    const repo = makeFakeRepo();
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input, { repo }, meterRepo);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.update).not.toHaveBeenCalled();
    expect(mockBestEffortAudit).toHaveBeenCalledTimes(1);

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

  // Validation tests for new requirements
  it('returns failure when readingValue is not finite', async () => {
    const meterRepo = makeMockMeterRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, readingValue: Infinity },
      {},
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('returns failure when readingValue is NaN', async () => {
    const meterRepo = makeMockMeterRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, readingValue: NaN },
      {},
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('returns failure when costCents is not a safe integer', async () => {
    const meterRepo = makeMockMeterRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, costCents: 52500.5 },
      {},
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('returns failure when costCents is negative', async () => {
    const meterRepo = makeMockMeterRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, costCents: -100 },
      {},
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('allows costCents to be null', async () => {
    const meterRepo = makeMockMeterRepo();
    const repo = makeFakeRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, costCents: null },
      { repo },
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('returns failure when reading date is in the future', async () => {
    const meterRepo = makeMockMeterRepo();
    // LOCAL calendar date, like the use case. Building "tomorrow" from
    // toISOString() (UTC) made this test fail between 00:00 and 02:00 SAST,
    // when UTC-tomorrow is still local-today.
    const futureDateString = format(addDays(new Date(), 2), 'yyyy-MM-dd');

    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, readingDate: futureDateString },
      {},
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('FUTURE_READING_DATE');
  });

  it('returns failure when reading is below previous reading', async () => {
    const previousReading = {
      id: 'prev-1',
      householdId: 'h1',
      meterType: 'electricity' as const,
      readingValue: 2000,
      readingDate: '2026-04-01',
      costCents: 50000,
      vehicleId: null,
      notes: null,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    };

    const meterRepo = {
      findById: jest.fn().mockResolvedValue(null),
      findByHousehold: jest.fn().mockResolvedValue([previousReading]),
      findByDate: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(undefined),
    } as unknown as IMeterReadingRepository;

    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, readingValue: 1500, readingDate: '2026-04-02' },
      {},
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('READING_BELOW_PREVIOUS');
  });

  it('returns failure when a back-dated reading is above the next later reading', async () => {
    const laterReading = {
      id: 'later-1',
      householdId: 'h1',
      meterType: 'electricity' as const,
      readingValue: 1500,
      readingDate: '2026-04-10',
      costCents: null,
      vehicleId: null,
      notes: null,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z',
    };
    const meterRepo = {
      findById: jest.fn().mockResolvedValue(null),
      findByHousehold: jest.fn().mockResolvedValue([laterReading]),
      findByDate: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(undefined),
    } as unknown as IMeterReadingRepository;

    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, readingValue: 1600, readingDate: '2026-04-02' },
      {},
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('READING_ABOVE_NEXT');
  });

  it('allows reading equal to previous reading', async () => {
    const previousReading = {
      id: 'prev-1',
      householdId: 'h1',
      meterType: 'electricity' as const,
      readingValue: 1500,
      readingDate: '2026-04-01',
      costCents: 50000,
      vehicleId: null,
      notes: null,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    };

    const meterRepo = {
      findById: jest.fn().mockResolvedValue(null),
      findByHousehold: jest.fn().mockResolvedValue([previousReading]),
      findByDate: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(undefined),
    } as unknown as IMeterReadingRepository;

    const repo = makeFakeRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, readingValue: 1500, readingDate: '2026-04-02' },
      { repo },
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('returns failure when duplicate reading exists for same vehicleId', async () => {
    const existingReading = {
      id: 'existing-1',
      householdId: 'h1',
      meterType: 'odometer' as const,
      readingValue: 10000,
      readingDate: '2026-04-01',
      costCents: null,
      vehicleId: 'v1',
      notes: null,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    };

    const meterRepo = {
      findById: jest.fn().mockResolvedValue(null),
      findByHousehold: jest.fn().mockResolvedValue([existingReading]),
      findByDate: jest.fn().mockResolvedValue(existingReading),
      insert: jest.fn().mockResolvedValue(undefined),
    } as unknown as IMeterReadingRepository;

    const repo = makeFakeRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, meterType: 'odometer', vehicleId: 'v1', readingDate: '2026-04-01' },
      { repo },
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('DUPLICATE_READING');
  });

  it('allows duplicate reading date if vehicleId differs', async () => {
    const existingReading = {
      id: 'existing-1',
      householdId: 'h1',
      meterType: 'odometer' as const,
      readingValue: 10000,
      readingDate: '2026-04-01',
      costCents: null,
      vehicleId: 'v1',
      notes: null,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    };

    const meterRepo = {
      findById: jest.fn().mockResolvedValue(null),
      findByHousehold: jest.fn().mockResolvedValue([existingReading]),
      findByDate: jest.fn().mockResolvedValue(existingReading),
      insert: jest.fn().mockResolvedValue(undefined),
    } as unknown as IMeterReadingRepository;

    const repo = makeFakeRepo();
    const uc = new LogMeterReadingUseCase(
      mockDb,
      mockAudit,
      { ...input, meterType: 'odometer', vehicleId: 'v2', readingDate: '2026-04-01' },
      { repo },
      meterRepo,
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('returns success even when audit fails', async () => {
    const { bestEffortAudit: mockBestEffortAudit } = jest.requireMock(
      '../../shared/bestEffortAudit',
    ) as { bestEffortAudit: jest.Mock };
    const meterRepo = makeMockMeterRepo();
    const repo = makeFakeRepo();
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input, { repo }, meterRepo);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(mockBestEffortAudit).toHaveBeenCalled();
  });

  // MTR-2: a replaced/new meter legitimately reads far below the old
  // meter's last value. Without an explicit opt-in flag, that reading can
  // never be logged. The flag must be the ONLY thing that changes the
  // outcome — never inferred, and never persisted onto the row.
  describe('meterReplaced flag', () => {
    const previousReading = {
      id: 'prev-1',
      householdId: 'h1',
      meterType: 'electricity' as const,
      readingValue: 5000,
      readingDate: '2026-04-01',
      costCents: 50000,
      vehicleId: null,
      notes: null,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    };

    function makeRepoWithPrevious(): IMeterReadingRepository {
      return {
        findById: jest.fn().mockResolvedValue(null),
        findByHousehold: jest.fn().mockResolvedValue([previousReading]),
        findByDate: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockResolvedValue(undefined),
      } as unknown as IMeterReadingRepository;
    }

    it('still rejects a normal below-previous reading when the flag is absent', async () => {
      const meterRepo = makeRepoWithPrevious();
      const uc = new LogMeterReadingUseCase(
        mockDb,
        mockAudit,
        { ...input, readingValue: 20, readingDate: '2026-04-02' },
        {},
        meterRepo,
      );
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('READING_BELOW_PREVIOUS');
    });

    it('still rejects a normal below-previous reading when the flag is explicitly false', async () => {
      const meterRepo = makeRepoWithPrevious();
      const uc = new LogMeterReadingUseCase(
        mockDb,
        mockAudit,
        { ...input, readingValue: 20, readingDate: '2026-04-02', meterReplaced: false },
        {},
        meterRepo,
      );
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('READING_BELOW_PREVIOUS');
    });

    it('accepts a below-previous reading when meterReplaced is true', async () => {
      const meterRepo = makeRepoWithPrevious();
      const repo = makeFakeRepo();
      const uc = new LogMeterReadingUseCase(
        mockDb,
        mockAudit,
        { ...input, readingValue: 20, readingDate: '2026-04-02', meterReplaced: true },
        { repo },
        meterRepo,
      );
      const result = await uc.execute();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.readingValue).toBe(20);
    });

    it('does not persist the meterReplaced flag onto the inserted row', async () => {
      const meterRepo = makeRepoWithPrevious();
      const repo = makeFakeRepo();
      const uc = new LogMeterReadingUseCase(
        mockDb,
        mockAudit,
        { ...input, readingValue: 20, readingDate: '2026-04-02', meterReplaced: true },
        { repo },
        meterRepo,
      );
      await uc.execute();
      const [row] = repo.insert.mock.calls[0];
      expect(row).not.toHaveProperty('meterReplaced');
      expect(row).not.toHaveProperty('meter_replaced');
    });

    it('still enforces the above-next-reading guard even when meterReplaced is true', async () => {
      const laterReading = {
        id: 'later-1',
        householdId: 'h1',
        meterType: 'electricity' as const,
        readingValue: 15,
        readingDate: '2026-04-10',
        costCents: null,
        vehicleId: null,
        notes: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
      };
      const meterRepo = {
        findById: jest.fn().mockResolvedValue(null),
        findByHousehold: jest.fn().mockResolvedValue([previousReading, laterReading]),
        findByDate: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockResolvedValue(undefined),
      } as unknown as IMeterReadingRepository;

      const uc = new LogMeterReadingUseCase(
        mockDb,
        mockAudit,
        { ...input, readingValue: 20, readingDate: '2026-04-02', meterReplaced: true },
        {},
        meterRepo,
      );
      const result = await uc.execute();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('READING_ABOVE_NEXT');
    });
  });
});
