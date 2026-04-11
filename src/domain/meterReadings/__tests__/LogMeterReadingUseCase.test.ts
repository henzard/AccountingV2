import { LogMeterReadingUseCase } from '../LogMeterReadingUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-meter-1' }));

const mockInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
const mockDb = { insert: mockInsert } as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

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
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, { ...input, readingValue: 0 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('returns failure when readingValue is negative', async () => {
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, { ...input, readingValue: -10 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('inserts reading and logs audit on success', async () => {
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(2); // 1 for meter_readings, 1 for pending_sync_queue
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
  });

  it('returns entity with correct id and fields', async () => {
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input);
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
