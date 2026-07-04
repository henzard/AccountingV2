import { ReconcileEmergencyFundTypeUseCase } from '../ReconcileEmergencyFundTypeUseCase';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';

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
    ...overrides,
  };
}

function makeDb(envelopeRows: Record<string, unknown>[]) {
  const whereFnSelect = jest.fn().mockResolvedValue(envelopeRows);
  const fromFnSelect = jest.fn().mockReturnValue({ where: whereFnSelect });
  const selectFn = jest.fn().mockReturnValue({ from: fromFnSelect });
  return { select: selectFn };
}

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

describe('ReconcileEmergencyFundTypeUseCase', () => {
  const HOUSEHOLD_ID = 'h1';

  it('single EMF → no-op, flipped=0', async () => {
    const rows = [makeEnvelopeRow({ id: 'e1' })];
    const db = makeDb(rows);
    const repo = makeFakeRepo();
    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(0);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('no EMF envelopes → no-op, flipped=0', async () => {
    const db = makeDb([]);
    const repo = makeFakeRepo();
    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(0);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('two active EMFs → oldest preserved, other flipped to savings (one oplog op)', async () => {
    const older = makeEnvelopeRow({ id: 'e-older', createdAt: '2025-01-01T00:00:00.000Z' });
    const newer = makeEnvelopeRow({ id: 'e-newer', createdAt: '2026-01-01T00:00:00.000Z' });
    const db = makeDb([newer, older]); // intentionally out of order
    const repo = makeFakeRepo();

    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(1);

    // Should have updated exactly once (the newer one), via the synced repo
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      'e-newer',
      HOUSEHOLD_ID,
      expect.objectContaining({ envelope_type: 'savings' }),
      expect.anything(),
    );
  });

  it('two active EMFs + one archived → archived skipped, only the non-oldest active flipped', async () => {
    const older = makeEnvelopeRow({ id: 'e-older', createdAt: '2025-01-01T00:00:00.000Z' });
    const newer = makeEnvelopeRow({ id: 'e-newer', createdAt: '2026-01-01T00:00:00.000Z' });
    // Archived one — should not be returned (filtered in the WHERE clause)
    // We simulate the DB already filtering it out
    const db = makeDb([newer, older]);
    const repo = makeFakeRepo();

    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(1);
    expect(repo.update).toHaveBeenCalledTimes(1);
  });

  it('three active EMFs → oldest kept, two others flipped', async () => {
    const rows = [
      makeEnvelopeRow({ id: 'e-3', createdAt: '2027-01-01T00:00:00.000Z' }),
      makeEnvelopeRow({ id: 'e-1', createdAt: '2025-01-01T00:00:00.000Z' }),
      makeEnvelopeRow({ id: 'e-2', createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const db = makeDb(rows);
    const repo = makeFakeRepo();
    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(2);
    expect(repo.update).toHaveBeenCalledTimes(2);
  });

  it('sets updatedAt to current time on flipped envelopes', async () => {
    const older = makeEnvelopeRow({ id: 'e-older', createdAt: '2025-01-01T00:00:00.000Z' });
    const newer = makeEnvelopeRow({ id: 'e-newer', createdAt: '2026-01-01T00:00:00.000Z' });
    const db = makeDb([newer, older]);
    const repo = makeFakeRepo();

    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    await uc.execute(HOUSEHOLD_ID);

    expect(repo.update).toHaveBeenCalledWith(
      'e-newer',
      HOUSEHOLD_ID,
      expect.objectContaining({ updated_at: '2026-04-12T10:00:00.000Z' }),
      expect.anything(),
    );
  });

  it('preserves oldest when all have identical names', async () => {
    const e1 = makeEnvelopeRow({ id: 'e-1', name: 'EF', createdAt: '2024-06-01T00:00:00.000Z' });
    const e2 = makeEnvelopeRow({ id: 'e-2', name: 'EF', createdAt: '2025-06-01T00:00:00.000Z' });
    const db = makeDb([e2, e1]);
    const repo = makeFakeRepo();

    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(1);
    expect(repo.update).toHaveBeenCalledWith(
      'e-2',
      HOUSEHOLD_ID,
      expect.anything(),
      expect.anything(),
    );
  });

  it('updates each flipped envelope individually via the synced repo', async () => {
    const rows = [
      makeEnvelopeRow({ id: 'e-oldest', createdAt: '2023-01-01T00:00:00.000Z' }),
      makeEnvelopeRow({ id: 'e-mid', createdAt: '2024-01-01T00:00:00.000Z' }),
      makeEnvelopeRow({ id: 'e-newest', createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const db = makeDb(rows);
    const repo = makeFakeRepo();

    const uc = new ReconcileEmergencyFundTypeUseCase(db as any, { repo });
    await uc.execute(HOUSEHOLD_ID);

    const updatedIds = repo.update.mock.calls.map((call) => call[0]);
    expect(updatedIds).toContain('e-mid');
    expect(updatedIds).toContain('e-newest');
    expect(updatedIds).not.toContain('e-oldest');
  });
});
