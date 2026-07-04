import { SeedBabyStepsUseCase } from '../SeedBabyStepsUseCase';
import { StampCelebratedUseCase } from '../StampCelebratedUseCase';
import { ToggleManualStepUseCase } from '../ToggleManualStepUseCase';
import { ReconcileEmergencyFundTypeUseCase } from '../ReconcileEmergencyFundTypeUseCase';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-' + Math.random().toString(36).slice(2, 8)),
}));

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-19T10:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

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

// ---------------------------------------------------------------------------
// SeedBabyStepsUseCase
// ---------------------------------------------------------------------------

describe('SeedBabyStepsUseCase', () => {
  function makeDb(existingStepNumbers: number[] = []) {
    const whereFn = jest
      .fn()
      .mockResolvedValue(existingStepNumbers.map((stepNumber) => ({ stepNumber })));
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    return { select: selectFn };
  }

  it('creates 7 rows on empty DB', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new SeedBabyStepsUseCase(db as any, { repo });
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    expect(repo.insert).toHaveBeenCalledTimes(7);
    const steps = repo.insert.mock.calls.map((call) => call[0].step_number).sort();
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('is idempotent — no new rows when all 7 exist', async () => {
    const db = makeDb([1, 2, 3, 4, 5, 6, 7]);
    const repo = makeFakeRepo();
    const uc = new SeedBabyStepsUseCase(db as any, { repo });
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('fills only missing steps', async () => {
    const db = makeDb([1, 2, 3, 4, 6, 7]);
    const repo = makeFakeRepo();
    const uc = new SeedBabyStepsUseCase(db as any, { repo });
    await uc.execute('hh-1');

    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.insert.mock.calls[0][0].step_number).toBe(5);
  });

  it('marks steps 4, 5, 7 as manual', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new SeedBabyStepsUseCase(db as any, { repo });
    await uc.execute('hh-1');

    const byStep = Object.fromEntries(
      repo.insert.mock.calls.map((call) => [call[0].step_number, call[0]]),
    );
    expect(byStep[4].is_manual).toBe(1);
    expect(byStep[5].is_manual).toBe(1);
    expect(byStep[7].is_manual).toBe(1);
    expect(byStep[1].is_manual).toBe(0);
    expect(byStep[2].is_manual).toBe(0);
    expect(byStep[3].is_manual).toBe(0);
    expect(byStep[6].is_manual).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// StampCelebratedUseCase
// ---------------------------------------------------------------------------

describe('StampCelebratedUseCase', () => {
  function makeDb(existingRow: Record<string, unknown> | null) {
    const whereFnSelect = jest.fn().mockResolvedValue(existingRow ? [existingRow] : []);
    const fromFnSelect = jest.fn().mockReturnValue({ where: whereFnSelect });
    const selectFn = jest.fn().mockReturnValue({ from: fromFnSelect });
    return { select: selectFn };
  }

  it('stamps celebrated_at when not yet celebrated', async () => {
    const db = makeDb({ id: 'bs-1', celebratedAt: null });
    const repo = makeFakeRepo();
    const uc = new StampCelebratedUseCase(db as any, { repo });
    const result = await uc.execute('hh-1', 1);

    expect(result.success).toBe(true);
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      'bs-1',
      'hh-1',
      expect.objectContaining({ celebrated_at: '2026-06-19T10:00:00.000Z' }),
      expect.anything(),
    );
  });

  it('idempotent — no-op if already celebrated', async () => {
    const db = makeDb({ id: 'bs-1', celebratedAt: '2026-06-01T00:00:00.000Z' });
    const repo = makeFakeRepo();
    const uc = new StampCelebratedUseCase(db as any, { repo });
    const result = await uc.execute('hh-1', 1);

    expect(result.success).toBe(true);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('returns STEP_NOT_FOUND when row does not exist', async () => {
    const db = makeDb(null);
    const repo = makeFakeRepo();
    const uc = new StampCelebratedUseCase(db as any, { repo });
    const result = await uc.execute('hh-1', 3);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('STEP_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// ToggleManualStepUseCase
// ---------------------------------------------------------------------------

describe('ToggleManualStepUseCase', () => {
  function makeDb(existingRow: Record<string, unknown> | null = { id: 'bs-1' }) {
    const whereFn = jest.fn().mockResolvedValue(existingRow ? [existingRow] : []);
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    return { select: selectFn };
  }

  it('accepts manual step 4 toggled on', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new ToggleManualStepUseCase(db as any, { repo });
    const result = await uc.execute('hh-1', 4, true);

    expect(result.success).toBe(true);
    expect(repo.update).toHaveBeenCalledWith(
      'bs-1',
      'hh-1',
      expect.objectContaining({
        is_completed: 1,
        completed_at: '2026-06-19T10:00:00.000Z',
      }),
      expect.anything(),
    );
  });

  it('accepts manual step 4 toggled off', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new ToggleManualStepUseCase(db as any, { repo });
    const result = await uc.execute('hh-1', 4, false);

    expect(result.success).toBe(true);
    expect(repo.update).toHaveBeenCalledWith(
      'bs-1',
      'hh-1',
      expect.objectContaining({
        is_completed: 0,
        completed_at: null,
      }),
      expect.anything(),
    );
  });

  it('accepts manual steps 5 and 7', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new ToggleManualStepUseCase(db as any, { repo });

    const r5 = await uc.execute('hh-1', 5, true);
    expect(r5.success).toBe(true);

    const r7 = await uc.execute('hh-1', 7, true);
    expect(r7.success).toBe(true);
  });

  it('rejects non-manual step 2', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new ToggleManualStepUseCase(db as any, { repo });
    const result = await uc.execute('hh-1', 2, true);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_STEP_NUMBER');
  });

  it('rejects non-manual step 1', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new ToggleManualStepUseCase(db as any, { repo });
    const result = await uc.execute('hh-1', 1, true);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_STEP_NUMBER');
  });
});

// ---------------------------------------------------------------------------
// ReconcileEmergencyFundTypeUseCase
// ---------------------------------------------------------------------------

describe('ReconcileEmergencyFundTypeUseCase', () => {
  function makeEnvelopeRow(id: string, createdAt: string) {
    return {
      id,
      householdId: 'hh-1',
      name: 'Emergency Fund',
      allocatedCents: 100000,
      spentCents: 0,
      envelopeType: 'emergency_fund',
      isSavingsLocked: false,
      isArchived: false,
      periodStart: '2026-04-01',
      createdAt,
      updatedAt: createdAt,
    };
  }

  function makeDb(rows: Record<string, unknown>[]) {
    const whereFnSelect = jest.fn().mockResolvedValue(rows);
    const fromFnSelect = jest.fn().mockReturnValue({ where: whereFnSelect });
    const selectFn = jest.fn().mockReturnValue({ from: fromFnSelect });
    return { select: selectFn };
  }

  it('1 EMF → no-op, flipped=0', async () => {
    const db = makeDb([makeEnvelopeRow('e1', '2026-01-01T00:00:00Z')]);
    const repo = makeFakeRepo();
    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(0);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('0 EMFs → no-op, flipped=0', async () => {
    const db = makeDb([]);
    const repo = makeFakeRepo();
    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(0);
  });

  it('2+ EMFs → oldest kept, others flipped to savings', async () => {
    const older = makeEnvelopeRow('e-older', '2025-01-01T00:00:00Z');
    const newer = makeEnvelopeRow('e-newer', '2026-03-01T00:00:00Z');
    const db = makeDb([newer, older]);
    const repo = makeFakeRepo();

    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(1);
    expect(repo.update).toHaveBeenCalledWith(
      'e-newer',
      'hh-1',
      expect.objectContaining({ envelope_type: 'savings' }),
      expect.anything(),
    );
  });

  it('3 EMFs → 2 flipped, oldest preserved', async () => {
    const rows = [
      makeEnvelopeRow('e3', '2027-01-01T00:00:00Z'),
      makeEnvelopeRow('e1', '2024-01-01T00:00:00Z'),
      makeEnvelopeRow('e2', '2025-06-01T00:00:00Z'),
    ];
    const db = makeDb(rows);
    const repo = makeFakeRepo();

    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(2);
    expect(repo.update).toHaveBeenCalledTimes(2);
    const updatedIds = repo.update.mock.calls.map((call) => call[0]);
    expect(updatedIds).not.toContain('e1');
  });
});
