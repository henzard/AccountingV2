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

/**
 * Fake drizzle db exposing only the `select().from().where()` chain the
 * create-time EMF duplicate guard queries. `existingRows` stands in for
 * whatever the `envelopes` table would return for the household's active
 * (non-archived, non-deleted) `emergency_fund` rows.
 */
function makeQueryDb(existingRows: Record<string, unknown>[] = []) {
  const whereFn = jest.fn().mockResolvedValue(existingRows);
  const fromFn = jest.fn().mockReturnValue({ where: whereFn });
  const selectFn = jest.fn().mockReturnValue({ from: fromFn });
  return { select: selectFn, _whereFn: whereFn, _fromFn: fromFn, _selectFn: selectFn };
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
        envelope_type: 'spending',
        is_archived: 0,
        period_start: '2026-03-25',
      }),
    );
    expect(row).not.toHaveProperty('spent_cents');
    expect(row).not.toHaveProperty('is_synced');
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
    const db = makeQueryDb([]); // no existing active EMF in this household
    const uc = new CreateEnvelopeUseCase(
      db as any,
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

  describe('emergency_fund create-time duplicate guard', () => {
    const emfInput = {
      householdId: 'hh-1',
      name: 'Emergency Fund',
      allocatedCents: 500000,
      envelopeType: 'emergency_fund' as const,
      periodStart: '2026-03-25',
    };

    it('returns DUPLICATE_EMERGENCY_FUND and does not insert when an active emergency_fund already exists', async () => {
      const repo = makeFakeRepo();
      const audit = makeAudit();
      const db = makeQueryDb([{ id: 'existing-emf' }]);
      const uc = new CreateEnvelopeUseCase(db as any, audit as any, emfInput, { repo });

      const result = await uc.execute();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('DUPLICATE_EMERGENCY_FUND');
      expect(repo.insert).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('queries scoped to the household, active, non-deleted emergency_fund rows', async () => {
      const repo = makeFakeRepo();
      const db = makeQueryDb([]);
      const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, emfInput, { repo });

      await uc.execute();

      expect(db._selectFn).toHaveBeenCalledTimes(1);
      expect(db._fromFn).toHaveBeenCalledTimes(1);
      expect(db._whereFn).toHaveBeenCalledTimes(1);
    });

    it('does not query the db at all for non-emergency_fund envelope types', async () => {
      const repo = makeFakeRepo();
      const db = makeQueryDb([]);
      const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, validInput, { repo });

      const result = await uc.execute();

      expect(result.success).toBe(true);
      expect(db._selectFn).not.toHaveBeenCalled();
      expect(repo.insert).toHaveBeenCalledTimes(1);
    });

    it('allows creating multiple non-EMF persistent envelopes (e.g. sinking_fund) without querying', async () => {
      const repo = makeFakeRepo();
      const uc1 = new CreateEnvelopeUseCase(
        mockDb,
        makeAudit() as any,
        { ...validInput, name: 'Roof Fund', envelopeType: 'sinking_fund' as const },
        { repo },
      );
      const uc2 = new CreateEnvelopeUseCase(
        mockDb,
        makeAudit() as any,
        { ...validInput, name: 'Car Fund', envelopeType: 'sinking_fund' as const },
        { repo },
      );

      const result1 = await uc1.execute();
      const result2 = await uc2.execute();

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(repo.insert).toHaveBeenCalledTimes(2);
    });
  });
});
