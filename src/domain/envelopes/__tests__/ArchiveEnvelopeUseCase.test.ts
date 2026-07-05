import { ArchiveEnvelopeUseCase } from '../ArchiveEnvelopeUseCase';
import type { EnvelopeEntity } from '../EnvelopeEntity';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-18T12:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

const mockDb = {} as any;

function makeAudit() {
  return { log: jest.fn().mockResolvedValue(undefined) };
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

function makeEnvelope(overrides: Partial<EnvelopeEntity> = {}): EnvelopeEntity {
  return {
    id: 'env-1',
    householdId: 'h-1',
    name: 'Groceries',
    allocatedCents: 50000,
    spentCents: 12000,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-06-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ArchiveEnvelopeUseCase', () => {
  it('returns success on valid archive', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const envelope = makeEnvelope();

    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, envelope, { repo });
    const result = await uc.execute();

    expect(result.success).toBe(true);
  });

  it('sets is_archived=true and updated_at via the synced repo', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const envelope = makeEnvelope();

    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, envelope, { repo });
    await uc.execute();

    expect(repo.update).toHaveBeenCalledWith(
      'env-1',
      'h-1',
      {
        is_archived: 1,
        updated_at: '2026-06-18T12:00:00.000Z',
      },
      expect.any(Object),
    );
  });

  it('scopes the write to envelope id AND householdId', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const envelope = makeEnvelope({ id: 'env-abc', householdId: 'h-xyz' });

    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, envelope, { repo });
    await uc.execute();

    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      'env-abc',
      'h-xyz',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('does not touch spent_cents anywhere (no increment call, no spent_cents field)', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const envelope = makeEnvelope();

    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, envelope, { repo });
    await uc.execute();

    expect(repo.increment).not.toHaveBeenCalled();
    const [, , fields] = repo.update.mock.calls[0];
    expect(JSON.stringify(fields)).not.toMatch(/spent_cents|spentCents/);
  });

  it('logs audit event with correct fields', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const envelope = makeEnvelope({ id: 'env-audit', householdId: 'h-audit' });

    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, envelope, { repo });
    await uc.execute();

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith({
      householdId: 'h-audit',
      entityType: 'envelope',
      entityId: 'env-audit',
      action: 'archive',
      previousValue: { isArchived: false },
      newValue: { isArchived: true },
    });
  });

  it('calls repo.update before audit.log (order matters)', async () => {
    const callOrder: string[] = [];
    const repo = makeFakeRepo();
    repo.update.mockImplementation(() => {
      callOrder.push('repo.update');
    });
    const audit = {
      log: jest.fn().mockImplementation(async () => {
        callOrder.push('audit.log');
      }),
    };
    const envelope = makeEnvelope();

    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, envelope, { repo });
    await uc.execute();

    expect(callOrder).toEqual(['repo.update', 'audit.log']);
  });

  it('works with different envelope types (savings)', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const envelope = makeEnvelope({ envelopeType: 'savings', id: 'env-sav' });

    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, envelope, { repo });
    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(repo.update).toHaveBeenCalledWith(
      'env-sav',
      'h-1',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('works with emergency_fund envelope type', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const envelope = makeEnvelope({ envelopeType: 'emergency_fund', id: 'env-emf' });

    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, envelope, { repo });
    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'env-emf' }));
  });

  it('returns ENVELOPE_NOT_FOUND when the repo update matches 0 rows', async () => {
    const repo = makeFakeRepo();
    repo.update.mockImplementation(() => {
      throw new Error('createSyncedRepo: no row in "envelopes" matched id=env-1 household_id=h-1');
    });
    const audit = makeAudit();
    const envelope = makeEnvelope();

    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, envelope, { repo });
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('uses a default synced repo (createSyncedRepo over db) when none is injected', async () => {
    const dbWithRun = {
      transaction: jest.fn((fn: any) => fn({ run: jest.fn().mockReturnValue({ changes: 1 }) })),
    } as any;
    const audit = makeAudit();
    const envelope = makeEnvelope();
    const uc = new ArchiveEnvelopeUseCase(dbWithRun, audit as any, envelope);
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });
});
