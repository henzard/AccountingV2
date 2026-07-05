jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

import { UpdateEnvelopeUseCase } from './UpdateEnvelopeUseCase';
import { ArchiveEnvelopeUseCase } from './ArchiveEnvelopeUseCase';
import type { EnvelopeEntity } from './EnvelopeEntity';
import type { SyncedRepo } from '../../data/uow/createSyncedRepo';

const mockDb = {} as any;
const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

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

const existing: EnvelopeEntity = {
  id: 'env-1',
  householdId: 'hh-1',
  name: 'Groceries',
  allocatedCents: 300000,
  spentCents: 50000,
  envelopeType: 'spending',
  isSavingsLocked: false,
  isArchived: false,
  periodStart: '2026-03-25',
  targetAmountCents: null,
  targetDate: null,
  createdAt: '2026-03-25T00:00:00.000Z',
  updatedAt: '2026-03-25T00:00:00.000Z',
};

describe('UpdateEnvelopeUseCase', () => {
  it('updates name and amount and returns updated envelope', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      audit as any,
      existing,
      { name: 'Food', allocatedCents: 400000 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Food');
      expect(result.data.allocatedCents).toBe(400000);
      expect(result.data.spentCents).toBe(50000); // unchanged
      expect(result.data.id).toBe('env-1'); // unchanged
    }
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalled();
  });

  it('writes via the synced repo with snake_case fields, scoped to id + householdId, no envelope increment', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: 'Food', allocatedCents: 400000 },
      { repo },
    );
    await uc.execute();
    expect(repo.increment).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
    const [id, householdId, fields] = repo.update.mock.calls[0];
    expect(id).toBe('env-1');
    expect(householdId).toBe('hh-1');
    expect(fields).toEqual(
      expect.objectContaining({
        name: 'Food',
        allocated_cents: 400000,
      }),
    );
    expect(JSON.stringify(fields)).not.toMatch(/spent_cents|spentCents|is_synced|isSynced/);
  });

  it('trims whitespace from name', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: '  Food  ', allocatedCents: 400000 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Food');
  });

  it('rejects empty name', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: '', allocatedCents: 400000 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects zero amount', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: 'Food', allocatedCents: 0 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('logs audit event with previous and new values', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      audit as any,
      existing,
      { name: 'Food', allocatedCents: 400000 },
      { repo },
    );
    await uc.execute();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        entityId: 'env-1',
      }),
    );
  });

  it('returns ENVELOPE_NOT_FOUND when the repo update matches 0 rows', async () => {
    const repo = makeFakeRepo();
    repo.update.mockImplementation(() => {
      throw new Error('createSyncedRepo: no row in "envelopes" matched id=env-1 household_id=hh-1');
    });
    const audit = makeAudit();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      audit as any,
      existing,
      { name: 'Food', allocatedCents: 400000 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rethrows (does NOT report ENVELOPE_NOT_FOUND) when repo.update fails for a non-not-found reason', async () => {
    const repo = makeFakeRepo();
    repo.update.mockImplementation(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });
    const audit = makeAudit();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      audit as any,
      existing,
      { name: 'Food', allocatedCents: 400000 },
      { repo },
    );

    await expect(uc.execute()).rejects.toThrow('SQLITE_BUSY: database is locked');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('uses a default synced repo (createSyncedRepo over db) when none is injected', async () => {
    const dbWithRun = {
      transaction: jest.fn((fn: any) => fn({ run: jest.fn().mockReturnValue({ changes: 1 }) })),
    } as any;
    const uc = new UpdateEnvelopeUseCase(dbWithRun, makeAudit() as any, existing, {
      name: 'Food',
      allocatedCents: 400000,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('applies explicit targetAmountCents and targetDate overrides', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: 'Food', allocatedCents: 400000, targetAmountCents: 50000, targetDate: '2026-12-01' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetAmountCents).toBe(50000);
      expect(result.data.targetDate).toBe('2026-12-01');
    }
  });
});

describe('UpdateEnvelopeUseCase — income envelope guard', () => {
  const incomeEnvelope: EnvelopeEntity = {
    ...existing,
    id: 'income-1',
    envelopeType: 'income',
    spentCents: 0,
  };

  it('rejects spentCents != 0 on income envelope with INVALID_INCOME_MUTATION', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      incomeEnvelope,
      { name: 'Salary', allocatedCents: 100000, spentCents: 500 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_INCOME_MUTATION');
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('accepts update with spentCents = 0 on income envelope', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      incomeEnvelope,
      { name: 'Salary', allocatedCents: 100000, spentCents: 0 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('accepts update without spentCents field on income envelope (no-op default)', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      incomeEnvelope,
      { name: 'Salary', allocatedCents: 100000 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });
});

describe('ArchiveEnvelopeUseCase', () => {
  it('sets isArchived to true and calls repo.update', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, existing, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      'env-1',
      'hh-1',
      expect.objectContaining({ is_archived: 1 }),
      expect.any(Object),
    );
  });

  it('logs audit event with action=archive', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, existing, { repo });
    await uc.execute();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'archive',
        entityId: 'env-1',
      }),
    );
  });
});
