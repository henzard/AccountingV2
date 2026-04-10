jest.mock('expo-crypto', () => ({ randomUUID: () => 'new-env-uuid' }));

import { CreateEnvelopeUseCase } from './CreateEnvelopeUseCase';

const makeDb = () => ({
  insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
});
const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

const validInput = {
  householdId: 'hh-1',
  name: 'Groceries',
  allocatedCents: 300000,
  envelopeType: 'spending' as const,
  periodStart: '2026-03-25',
};

describe('CreateEnvelopeUseCase', () => {
  it('creates envelope and returns it', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const uc = new CreateEnvelopeUseCase(db as any, audit as any, validInput);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('new-env-uuid');
      expect(result.data.name).toBe('Groceries');
      expect(result.data.allocatedCents).toBe(300000);
      expect(result.data.spentCents).toBe(0);
    }
    expect(db.insert).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalled();
  });

  it('trims whitespace from name', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, {
      ...validInput,
      name: '  Groceries  ',
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Groceries');
  });

  it('returns failure when name is empty', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, {
      ...validInput,
      name: '   ',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns failure when allocatedCents is zero', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, {
      ...validInput,
      allocatedCents: 0,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('sets isSavingsLocked true for savings type', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, {
      ...validInput,
      envelopeType: 'savings' as const,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(true);
  });

  it('sets isSavingsLocked true for emergency_fund type', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, {
      ...validInput,
      envelopeType: 'emergency_fund' as const,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(true);
  });

  it('sets isSavingsLocked false for spending type', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, validInput);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(false);
  });
});
