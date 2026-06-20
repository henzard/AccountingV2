import { ArchiveEnvelopeUseCase } from '../ArchiveEnvelopeUseCase';
import type { ISyncEnqueuer } from '../../ports/ISyncEnqueuer';
import type { EnvelopeEntity } from '../EnvelopeEntity';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-18T12:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

function makeDb() {
  const whereFn = jest.fn().mockResolvedValue(undefined);
  const setFn = jest.fn().mockReturnValue({ where: whereFn });
  const updateFn = jest.fn().mockReturnValue({ set: setFn });
  return {
    update: updateFn,
    insert: jest.fn(),
    select: jest.fn(),
    delete: jest.fn(),
    _setFn: setFn,
    _whereFn: whereFn,
  };
}

function makeAudit() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function makeEnqueuer(): ISyncEnqueuer & { enqueue: jest.Mock } {
  return { enqueue: jest.fn().mockResolvedValue(undefined) };
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
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const envelope = makeEnvelope();

    const uc = new ArchiveEnvelopeUseCase(db as any, audit as any, envelope, enqueuer);
    const result = await uc.execute();

    expect(result.success).toBe(true);
  });

  it('sets isArchived=true, isSynced=false, and updatedAt', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const envelope = makeEnvelope();

    const uc = new ArchiveEnvelopeUseCase(db as any, audit as any, envelope, enqueuer);
    await uc.execute();

    expect(db._setFn).toHaveBeenCalledWith({
      isArchived: true,
      updatedAt: '2026-06-18T12:00:00.000Z',
      isSynced: false,
    });
  });

  it('scopes update WHERE clause to envelope id AND householdId', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const envelope = makeEnvelope({ id: 'env-abc', householdId: 'h-xyz' });

    const uc = new ArchiveEnvelopeUseCase(db as any, audit as any, envelope, enqueuer);
    await uc.execute();

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db._whereFn).toHaveBeenCalledTimes(1);
  });

  it('logs audit event with correct fields', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const envelope = makeEnvelope({ id: 'env-audit', householdId: 'h-audit' });

    const uc = new ArchiveEnvelopeUseCase(db as any, audit as any, envelope, enqueuer);
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

  it('enqueues sync with correct table, id, and action', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const envelope = makeEnvelope({ id: 'env-sync' });

    const uc = new ArchiveEnvelopeUseCase(db as any, audit as any, envelope, enqueuer);
    await uc.execute();

    expect(enqueuer.enqueue).toHaveBeenCalledTimes(1);
    expect(enqueuer.enqueue).toHaveBeenCalledWith('envelopes', 'env-sync', 'UPDATE');
  });

  it('calls db.update before audit.log before enqueuer.enqueue (order matters)', async () => {
    const callOrder: string[] = [];
    const db = makeDb();
    db.update = jest.fn().mockImplementation(() => {
      callOrder.push('db.update');
      return { set: db._setFn };
    });
    const audit = {
      log: jest.fn().mockImplementation(async () => {
        callOrder.push('audit.log');
      }),
    };
    const enqueuer = {
      enqueue: jest.fn().mockImplementation(async () => {
        callOrder.push('enqueue');
      }),
    };
    const envelope = makeEnvelope();

    const uc = new ArchiveEnvelopeUseCase(db as any, audit as any, envelope, enqueuer);
    await uc.execute();

    expect(callOrder).toEqual(['db.update', 'audit.log', 'enqueue']);
  });

  it('works with different envelope types (savings)', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const envelope = makeEnvelope({ envelopeType: 'savings', id: 'env-sav' });

    const uc = new ArchiveEnvelopeUseCase(db as any, audit as any, envelope, enqueuer);
    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(enqueuer.enqueue).toHaveBeenCalledWith('envelopes', 'env-sav', 'UPDATE');
  });

  it('works with emergency_fund envelope type', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const enqueuer = makeEnqueuer();
    const envelope = makeEnvelope({ envelopeType: 'emergency_fund', id: 'env-emf' });

    const uc = new ArchiveEnvelopeUseCase(db as any, audit as any, envelope, enqueuer);
    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'env-emf' }));
  });
});
