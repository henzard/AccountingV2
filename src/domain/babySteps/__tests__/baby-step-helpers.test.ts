import { SeedBabyStepsUseCase } from '../SeedBabyStepsUseCase';
import { StampCelebratedUseCase } from '../StampCelebratedUseCase';
import { ToggleManualStepUseCase } from '../ToggleManualStepUseCase';
import { ReconcileEmergencyFundTypeUseCase } from '../ReconcileEmergencyFundTypeUseCase';
import type { ISyncEnqueuer } from '../../ports/ISyncEnqueuer';

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

function makeEnqueuer(): ISyncEnqueuer & { enqueue: jest.Mock } {
  return { enqueue: jest.fn().mockResolvedValue(undefined) };
}

// ---------------------------------------------------------------------------
// SeedBabyStepsUseCase
// ---------------------------------------------------------------------------

describe('SeedBabyStepsUseCase', () => {
  function makeDb(existingStepNumbers: number[] = []) {
    const conflicting = new Set(existingStepNumbers);
    const inserted: unknown[] = [];

    const onConflictDoNothing = jest.fn().mockImplementation(function (this: { _row: any }) {
      return Promise.resolve();
    });

    const valuesFn = jest.fn().mockImplementation((row: any) => {
      const key = row.stepNumber;
      if (!conflicting.has(key)) {
        conflicting.add(key);
        inserted.push(row);
      }
      return { onConflictDoNothing };
    });

    const insertFn = jest.fn().mockReturnValue({ values: valuesFn });

    return { insert: insertFn, _inserted: inserted };
  }

  it('creates 7 rows on empty DB', async () => {
    const db = makeDb();
    const uc = new SeedBabyStepsUseCase(db as any);
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    expect(db._inserted).toHaveLength(7);
    const steps = db._inserted.map((r: any) => r.stepNumber).sort();
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('is idempotent — no new rows when all 7 exist', async () => {
    const db = makeDb([1, 2, 3, 4, 5, 6, 7]);
    const uc = new SeedBabyStepsUseCase(db as any);
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    expect(db._inserted).toHaveLength(0);
  });

  it('fills only missing steps', async () => {
    const db = makeDb([1, 2, 3, 4, 6, 7]);
    const uc = new SeedBabyStepsUseCase(db as any);
    await uc.execute('hh-1');

    expect(db._inserted).toHaveLength(1);
    expect((db._inserted[0] as any).stepNumber).toBe(5);
  });

  it('marks steps 4, 5, 7 as manual', async () => {
    const db = makeDb();
    const uc = new SeedBabyStepsUseCase(db as any);
    await uc.execute('hh-1');

    const byStep = Object.fromEntries(db._inserted.map((r: any) => [r.stepNumber, r]));
    expect(byStep[4].isManual).toBe(true);
    expect(byStep[5].isManual).toBe(true);
    expect(byStep[7].isManual).toBe(true);
    expect(byStep[1].isManual).toBe(false);
    expect(byStep[2].isManual).toBe(false);
    expect(byStep[3].isManual).toBe(false);
    expect(byStep[6].isManual).toBe(false);
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

    const whereFnUpdate = jest.fn().mockResolvedValue(undefined);
    const setFn = jest.fn().mockReturnValue({ where: whereFnUpdate });
    const updateFn = jest.fn().mockReturnValue({ set: setFn });

    return { select: selectFn, update: updateFn, _setFn: setFn, _updateFn: updateFn };
  }

  it('stamps celebrated_at when not yet celebrated', async () => {
    const db = makeDb({ id: 'bs-1', celebratedAt: null });
    const uc = new StampCelebratedUseCase(db as any);
    const result = await uc.execute('hh-1', 1);

    expect(result.success).toBe(true);
    expect(db._updateFn).toHaveBeenCalledTimes(1);
    expect(db._setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        celebratedAt: '2026-06-19T10:00:00.000Z',
        isSynced: false,
      }),
    );
  });

  it('idempotent — no-op if already celebrated', async () => {
    const db = makeDb({ id: 'bs-1', celebratedAt: '2026-06-01T00:00:00.000Z' });
    const uc = new StampCelebratedUseCase(db as any);
    const result = await uc.execute('hh-1', 1);

    expect(result.success).toBe(true);
    expect(db._updateFn).not.toHaveBeenCalled();
  });

  it('returns STEP_NOT_FOUND when row does not exist', async () => {
    const db = makeDb(null);
    const uc = new StampCelebratedUseCase(db as any);
    const result = await uc.execute('hh-1', 3);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('STEP_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// ToggleManualStepUseCase
// ---------------------------------------------------------------------------

describe('ToggleManualStepUseCase', () => {
  function makeDb() {
    const whereFn = jest.fn().mockResolvedValue(undefined);
    const setFn = jest.fn().mockReturnValue({ where: whereFn });
    const updateFn = jest.fn().mockReturnValue({ set: setFn });
    return { update: updateFn, _setFn: setFn };
  }

  it('accepts manual step 4 toggled on', async () => {
    const db = makeDb();
    const uc = new ToggleManualStepUseCase(db as any);
    const result = await uc.execute('hh-1', 4, true);

    expect(result.success).toBe(true);
    expect(db._setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        isCompleted: true,
        completedAt: '2026-06-19T10:00:00.000Z',
        isSynced: false,
      }),
    );
  });

  it('accepts manual step 4 toggled off', async () => {
    const db = makeDb();
    const uc = new ToggleManualStepUseCase(db as any);
    const result = await uc.execute('hh-1', 4, false);

    expect(result.success).toBe(true);
    expect(db._setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        isCompleted: false,
        completedAt: null,
      }),
    );
  });

  it('accepts manual steps 5 and 7', async () => {
    const db = makeDb();
    const uc = new ToggleManualStepUseCase(db as any);

    const r5 = await uc.execute('hh-1', 5, true);
    expect(r5.success).toBe(true);

    const r7 = await uc.execute('hh-1', 7, true);
    expect(r7.success).toBe(true);
  });

  it('rejects non-manual step 2', async () => {
    const db = makeDb();
    const uc = new ToggleManualStepUseCase(db as any);
    const result = await uc.execute('hh-1', 2, true);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_STEP_NUMBER');
  });

  it('rejects non-manual step 1', async () => {
    const db = makeDb();
    const uc = new ToggleManualStepUseCase(db as any);
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
      isSynced: true,
    };
  }

  function makeDb(rows: Record<string, unknown>[]) {
    const updates: Array<{ set: Record<string, unknown> }> = [];

    const whereFnSelect = jest.fn().mockResolvedValue(rows);
    const fromFnSelect = jest.fn().mockReturnValue({ where: whereFnSelect });
    const selectFn = jest.fn().mockReturnValue({ from: fromFnSelect });

    const whereFnUpdate = jest.fn().mockResolvedValue(undefined);
    const setFn = jest.fn().mockImplementation((setVal: Record<string, unknown>) => {
      updates.push({ set: setVal });
      return { where: whereFnUpdate };
    });
    const updateFn = jest.fn().mockReturnValue({ set: setFn });

    return { select: selectFn, update: updateFn, _updates: updates };
  }

  it('1 EMF → no-op, flipped=0', async () => {
    const db = makeDb([makeEnvelopeRow('e1', '2026-01-01T00:00:00Z')]);
    const enqueuer = makeEnqueuer();
    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, enqueuer);
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('0 EMFs → no-op, flipped=0', async () => {
    const db = makeDb([]);
    const enqueuer = makeEnqueuer();
    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, enqueuer);
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(0);
  });

  it('2+ EMFs → oldest kept, others flipped to savings', async () => {
    const older = makeEnvelopeRow('e-older', '2025-01-01T00:00:00Z');
    const newer = makeEnvelopeRow('e-newer', '2026-03-01T00:00:00Z');
    const db = makeDb([newer, older]);
    const enqueuer = makeEnqueuer();

    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, enqueuer);
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(1);
    expect(db._updates[0]?.set.envelopeType).toBe('savings');
    expect(db._updates[0]?.set.isSynced).toBe(false);
    expect(enqueuer.enqueue).toHaveBeenCalledWith('envelopes', 'e-newer', 'UPDATE');
  });

  it('3 EMFs → 2 flipped, oldest preserved', async () => {
    const rows = [
      makeEnvelopeRow('e3', '2027-01-01T00:00:00Z'),
      makeEnvelopeRow('e1', '2024-01-01T00:00:00Z'),
      makeEnvelopeRow('e2', '2025-06-01T00:00:00Z'),
    ];
    const db = makeDb(rows);
    const enqueuer = makeEnqueuer();

    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, enqueuer);
    const result = await uc.execute('hh-1');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(2);
    expect(enqueuer.enqueue).toHaveBeenCalledTimes(2);
    expect(enqueuer.enqueue).not.toHaveBeenCalledWith('envelopes', 'e1', 'UPDATE');
  });
});
