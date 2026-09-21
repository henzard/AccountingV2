import { DeleteMeterReadingUseCase } from '../DeleteMeterReadingUseCase';
import type { MeterReadingEntity } from '../MeterReadingEntity';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-sync-1' }));

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

const reading: MeterReadingEntity = {
  id: 'r1',
  householdId: 'h1',
  meterType: 'electricity',
  readingValue: 1800,
  readingDate: '2026-04-10',
  costCents: 52500,
  vehicleId: null,
  notes: null,
  createdAt: '2026-04-10T10:00:00.000Z',
  updatedAt: '2026-04-10T10:00:00.000Z',
};

describe('DeleteMeterReadingUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('soft-deletes the meter reading row via the synced repo', async () => {
    const repo = makeFakeRepo();
    const uc = new DeleteMeterReadingUseCase(mockDb, mockAudit, reading, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.softDelete).toHaveBeenCalledTimes(1);
    expect(repo.softDelete).toHaveBeenCalledWith('r1', 'h1', expect.any(Object));
  });

  it('does NOT touch any other row (no update/increment call)', async () => {
    const repo = makeFakeRepo();
    const uc = new DeleteMeterReadingUseCase(mockDb, mockAudit, reading, { repo });
    await uc.execute();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.increment).not.toHaveBeenCalled();
  });

  it('logs audit event with action=delete', async () => {
    const repo = makeFakeRepo();
    const uc = new DeleteMeterReadingUseCase(mockDb, mockAudit, reading, { repo });
    await uc.execute();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', entityId: 'r1', entityType: 'meter_reading' }),
    );
  });

  it('returns METER_READING_NOT_FOUND when the repo softDelete matches 0 rows (missing, other household, or already deleted)', async () => {
    const repo = makeFakeRepo();
    repo.softDelete.mockImplementation(() => {
      throw new Error('createSyncedRepo: no row in "meter_readings" matched id=r1 household_id=h1');
    });
    const uc = new DeleteMeterReadingUseCase(mockDb, mockAudit, reading, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('METER_READING_NOT_FOUND');
    }
    // Must not log an audit event for a delete that never happened.
    expect(mockAudit.log).not.toHaveBeenCalled();
  });

  it('uses a default synced repo (createSyncedRepo over db) when none is injected', async () => {
    const dbWithRun = {
      transaction: jest.fn((fn: any) => fn({ run: jest.fn().mockReturnValue({ changes: 1 }) })),
    } as any;
    const uc = new DeleteMeterReadingUseCase(dbWithRun, mockAudit, reading);
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('succeeds (does not fail execute or soft-delete twice) when audit.log throws after the ledger commit', async () => {
    const repo = makeFakeRepo();
    const failingAudit = { log: jest.fn().mockRejectedValue(new Error('audit db unavailable')) };
    const uc = new DeleteMeterReadingUseCase(mockDb, failingAudit as any, reading, { repo });

    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(repo.softDelete).toHaveBeenCalledTimes(1);
  });
});
