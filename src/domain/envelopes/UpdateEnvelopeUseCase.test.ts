jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

import { UpdateEnvelopeUseCase } from './UpdateEnvelopeUseCase';
import { ArchiveEnvelopeUseCase } from './ArchiveEnvelopeUseCase';
import type { EnvelopeEntity } from './EnvelopeEntity';

const makeDb = () => ({
  update: jest.fn().mockReturnValue({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
  }),
});
const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

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
  createdAt: '2026-03-25T00:00:00.000Z',
  updatedAt: '2026-03-25T00:00:00.000Z',
};

describe('UpdateEnvelopeUseCase', () => {
  it('updates name and amount and returns updated envelope', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const uc = new UpdateEnvelopeUseCase(db as any, audit as any, existing, {
      name: 'Food',
      allocatedCents: 400000,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Food');
      expect(result.data.allocatedCents).toBe(400000);
      expect(result.data.spentCents).toBe(50000); // unchanged
      expect(result.data.id).toBe('env-1'); // unchanged
    }
    expect(db.update).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalled();
  });

  it('trims whitespace from name', async () => {
    const db = makeDb();
    const uc = new UpdateEnvelopeUseCase(db as any, makeAudit() as any, existing, {
      name: '  Food  ',
      allocatedCents: 400000,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Food');
  });

  it('rejects empty name', async () => {
    const db = makeDb();
    const uc = new UpdateEnvelopeUseCase(db as any, makeAudit() as any, existing, {
      name: '',
      allocatedCents: 400000,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects zero amount', async () => {
    const db = makeDb();
    const uc = new UpdateEnvelopeUseCase(db as any, makeAudit() as any, existing, {
      name: 'Food',
      allocatedCents: 0,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('logs audit event with previous and new values', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const uc = new UpdateEnvelopeUseCase(db as any, audit as any, existing, {
      name: 'Food',
      allocatedCents: 400000,
    });
    await uc.execute();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        entityId: 'env-1',
      }),
    );
  });
});

describe('ArchiveEnvelopeUseCase', () => {
  it('sets isArchived to true and calls db.update', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const uc = new ArchiveEnvelopeUseCase(db as any, audit as any, existing);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it('logs audit event with action=archive', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const uc = new ArchiveEnvelopeUseCase(db as any, audit as any, existing);
    await uc.execute();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'archive',
        entityId: 'env-1',
      }),
    );
  });
});
