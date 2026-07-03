jest.mock('expo-crypto', () => ({ randomUUID: () => 'new-env-uuid' }));

import { CreateEnvelopeUseCase } from './CreateEnvelopeUseCase';
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

const validInput = {
  householdId: 'hh-1',
  name: 'Groceries',
  allocatedCents: 300000,
  envelopeType: 'spending' as const,
  periodStart: '2026-03-25',
};

describe('CreateEnvelopeUseCase', () => {
  it('creates envelope and returns it', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const uc = new CreateEnvelopeUseCase(mockDb, audit as any, validInput, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('new-env-uuid');
      expect(result.data.name).toBe('Groceries');
      expect(result.data.allocatedCents).toBe(300000);
      expect(result.data.spentCents).toBe(0);
    }
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalled();
  });

  it('inserts a row via the synced repo with snake_case columns, no envelope mutation elsewhere', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateEnvelopeUseCase(mockDb, makeAudit() as any, validInput, { repo });
    await uc.execute();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.increment).not.toHaveBeenCalled();
    const [row, ctx] = repo.insert.mock.calls[0];
    expect(row).toEqual(
      expect.objectContaining({
        id: 'new-env-uuid',
        household_id: 'hh-1',
        name: 'Groceries',
        allocated_cents: 300000,
        spent_cents: 0,
        envelope_type: 'spending',
        is_archived: false,
        period_start: '2026-03-25',
        is_synced: false,
      }),
    );
    expect(ctx).toEqual(expect.any(Object));
  });

  it('trims whitespace from name', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      { ...validInput, name: '  Groceries  ' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Groceries');
  });

  it('returns failure when name is empty', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      { ...validInput, name: '   ' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('returns failure when allocatedCents is zero', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      { ...validInput, allocatedCents: 0 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('sets isSavingsLocked true for savings type', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      { ...validInput, envelopeType: 'savings' as const },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(true);
  });

  it('sets isSavingsLocked true for emergency_fund type', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      { ...validInput, envelopeType: 'emergency_fund' as const },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(true);
  });

  it('sets isSavingsLocked false for spending type', async () => {
    const repo = makeFakeRepo();
    const uc = new CreateEnvelopeUseCase(mockDb, makeAudit() as any, validInput, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(false);
  });

  it('uses a default synced repo (createSyncedRepo over db) when none is injected', async () => {
    const dbWithRun = {
      transaction: jest.fn((fn: any) => fn({ run: jest.fn().mockReturnValue({ changes: 1 }) })),
    };
    const uc = new CreateEnvelopeUseCase(dbWithRun as any, makeAudit() as any, validInput);
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });
});
