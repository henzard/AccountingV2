import { ReconcileEmergencyFundTypeUseCase } from '../ReconcileEmergencyFundTypeUseCase';
import type { ISyncEnqueuer } from '../../ports/ISyncEnqueuer';

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-04-12T10:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

function makeEnvelopeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e-' + Math.random().toString(36).slice(2),
    householdId: 'h1',
    name: 'Emergency Fund',
    allocatedCents: 100_000,
    spentCents: 0,
    envelopeType: 'emergency_fund',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    isSynced: true,
    ...overrides,
  };
}

function makeDb(envelopeRows: Record<string, unknown>[]) {
  const updates: Array<{ id: string; set: Record<string, unknown> }> = [];

  const whereFnSelect = jest.fn().mockResolvedValue(envelopeRows);
  const fromFnSelect = jest.fn().mockReturnValue({ where: whereFnSelect });
  const selectFn = jest.fn().mockReturnValue({ from: fromFnSelect });

  const whereFnUpdate = jest.fn().mockImplementation((_cond) => {
    return Promise.resolve();
  });
  const setFn = jest.fn().mockImplementation((setVal: Record<string, unknown>) => {
    updates.push({ id: 'pending', set: setVal });
    return { where: whereFnUpdate };
  });
  const updateFn = jest.fn().mockReturnValue({ set: setFn });

  return { select: selectFn, update: updateFn, _updates: updates };
}

describe('ReconcileEmergencyFundTypeUseCase', () => {
  const HOUSEHOLD_ID = 'h1';

  function makeEnqueuer(): ISyncEnqueuer & { enqueue: jest.Mock } {
    return { enqueue: jest.fn().mockResolvedValue(undefined) };
  }

  it('single EMF → no-op, flipped=0', async () => {
    const rows = [makeEnvelopeRow({ id: 'e1' })];
    const db = makeDb(rows);
    const enqueuer = makeEnqueuer();
    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, enqueuer);
    const result = await uc.execute(HOUSEHOLD_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
    expect(enqueuer.enqueue).not.toHaveBeenCalled();
  });

  it('no EMF envelopes → no-op, flipped=0', async () => {
    const db = makeDb([]);
    const enqueuer = makeEnqueuer();
    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, enqueuer);
    const result = await uc.execute(HOUSEHOLD_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(0);
    expect(enqueuer.enqueue).not.toHaveBeenCalled();
  });

  it('two active EMFs → oldest preserved, other flipped to savings with isSynced=false', async () => {
    const older = makeEnvelopeRow({ id: 'e-older', createdAt: '2025-01-01T00:00:00.000Z' });
    const newer = makeEnvelopeRow({ id: 'e-newer', createdAt: '2026-01-01T00:00:00.000Z' });
    const db = makeDb([newer, older]); // intentionally out of order
    const enqueuer = makeEnqueuer();

    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, enqueuer);
    const result = await uc.execute(HOUSEHOLD_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(1);

    // Should have updated exactly once (the newer one)
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db._updates[0]?.set.envelopeType).toBe('savings');
    expect(db._updates[0]?.set.isSynced).toBe(false);

    // Enqueuer must be called once for the flipped envelope
    expect(enqueuer.enqueue).toHaveBeenCalledTimes(1);
    expect(enqueuer.enqueue).toHaveBeenCalledWith('envelopes', 'e-newer', 'UPDATE');
  });

  it('two active EMFs + one archived → archived skipped, only the non-oldest active flipped', async () => {
    const older = makeEnvelopeRow({ id: 'e-older', createdAt: '2025-01-01T00:00:00.000Z' });
    const newer = makeEnvelopeRow({ id: 'e-newer', createdAt: '2026-01-01T00:00:00.000Z' });
    // Archived one — should not be returned (filtered in the WHERE clause)
    // We simulate the DB already filtering it out
    const db = makeDb([newer, older]);
    const enqueuer = makeEnqueuer();

    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, enqueuer);
    const result = await uc.execute(HOUSEHOLD_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(1);
    expect(enqueuer.enqueue).toHaveBeenCalledTimes(1);
  });

  it('three active EMFs → oldest kept, two others flipped', async () => {
    const rows = [
      makeEnvelopeRow({ id: 'e-3', createdAt: '2027-01-01T00:00:00.000Z' }),
      makeEnvelopeRow({ id: 'e-1', createdAt: '2025-01-01T00:00:00.000Z' }),
      makeEnvelopeRow({ id: 'e-2', createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const db = makeDb(rows);
    const enqueuer = makeEnqueuer();
    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, enqueuer);
    const result = await uc.execute(HOUSEHOLD_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(2);
    expect(db.update).toHaveBeenCalledTimes(2);
    // Enqueuer called once per flipped envelope
    expect(enqueuer.enqueue).toHaveBeenCalledTimes(2);
  });
});
