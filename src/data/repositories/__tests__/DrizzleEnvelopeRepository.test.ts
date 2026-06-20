import { DrizzleEnvelopeRepository } from '../DrizzleEnvelopeRepository';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

const makeEntity = (overrides: Partial<EnvelopeEntity> = {}): EnvelopeEntity => ({
  id: 'env-1',
  householdId: 'hh-1',
  name: 'Groceries',
  allocatedCents: 500_00,
  spentCents: 120_00,
  envelopeType: 'spending',
  isSavingsLocked: false,
  isArchived: false,
  periodStart: '2026-06-01',
  targetAmountCents: null,
  targetDate: null,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  ...overrides,
});

const makeRow = (entity: EnvelopeEntity) => ({
  ...entity,
  targetAmountCents: entity.targetAmountCents ?? undefined,
  targetDate: entity.targetDate ?? undefined,
});

function buildSelectMock(rows: any[]) {
  const limitFn = jest.fn().mockResolvedValue(rows);
  const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
  const fromFn = jest.fn().mockReturnValue({ where: whereFn });
  const selectFn = jest.fn().mockReturnValue({ from: fromFn });
  return { selectFn, fromFn, whereFn, limitFn };
}

function buildSelectNoLimitMock(rows: any[]) {
  const whereFn = jest.fn().mockResolvedValue(rows);
  const fromFn = jest.fn().mockReturnValue({ where: whereFn });
  const selectFn = jest.fn().mockReturnValue({ from: fromFn });
  return { selectFn, fromFn, whereFn };
}

describe('DrizzleEnvelopeRepository', () => {
  describe('findById', () => {
    it('returns entity when row is found', async () => {
      const entity = makeEntity();
      const row = makeRow(entity);
      const { selectFn, limitFn } = buildSelectMock([row]);
      const db = { select: selectFn } as any;
      const repo = new DrizzleEnvelopeRepository(db);

      const result = await repo.findById('env-1', 'hh-1');

      expect(result).toEqual(entity);
      expect(selectFn).toHaveBeenCalled();
      expect(limitFn).toHaveBeenCalledWith(1);
    });

    it('returns null when row is not found', async () => {
      const { selectFn } = buildSelectMock([]);
      const db = { select: selectFn } as any;
      const repo = new DrizzleEnvelopeRepository(db);

      const result = await repo.findById('nonexistent', 'hh-1');

      expect(result).toBeNull();
    });

    it('propagates database errors', async () => {
      const limitFn = jest.fn().mockRejectedValue(new Error('DB Error'));
      const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
      const fromFn = jest.fn().mockReturnValue({ where: whereFn });
      const selectFn = jest.fn().mockReturnValue({ from: fromFn });
      const db = { select: selectFn } as any;
      const repo = new DrizzleEnvelopeRepository(db);

      await expect(repo.findById('env-1', 'hh-1')).rejects.toThrow('DB Error');
    });
  });

  describe('findByHousehold', () => {
    it('returns all envelopes for a household', async () => {
      const entities = [makeEntity(), makeEntity({ id: 'env-2', name: 'Transport' })];
      const rows = entities.map(makeRow);
      const { selectFn, whereFn } = buildSelectNoLimitMock(rows);
      const db = { select: selectFn } as any;
      const repo = new DrizzleEnvelopeRepository(db);

      const result = await repo.findByHousehold('hh-1');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Groceries');
      expect(result[1].name).toBe('Transport');
      expect(whereFn).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when no envelopes exist', async () => {
      const { selectFn, whereFn } = buildSelectNoLimitMock([]);
      const db = { select: selectFn } as any;
      const repo = new DrizzleEnvelopeRepository(db);

      const result = await repo.findByHousehold('hh-1');

      expect(result).toEqual([]);
      expect(whereFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('insert', () => {
    it('inserts entity with isSynced false', async () => {
      const valuesFn = jest.fn().mockResolvedValue(undefined);
      const insertFn = jest.fn().mockReturnValue({ values: valuesFn });
      const db = { insert: insertFn } as any;
      const repo = new DrizzleEnvelopeRepository(db);
      const entity = makeEntity();

      await repo.insert(entity);

      expect(insertFn).toHaveBeenCalled();
      expect(valuesFn).toHaveBeenCalledWith(
        expect.objectContaining({ ...entity, isSynced: false }),
      );
    });

    it('propagates database errors on insert', async () => {
      const valuesFn = jest.fn().mockRejectedValue(new Error('Insert failed'));
      const insertFn = jest.fn().mockReturnValue({ values: valuesFn });
      const db = { insert: insertFn } as any;
      const repo = new DrizzleEnvelopeRepository(db);

      await expect(repo.insert(makeEntity())).rejects.toThrow('Insert failed');
    });
  });

  describe('update', () => {
    it('updates entity fields with isSynced false', async () => {
      const whereFn = jest.fn().mockResolvedValue(undefined);
      const setFn = jest.fn().mockReturnValue({ where: whereFn });
      const updateFn = jest.fn().mockReturnValue({ set: setFn });
      const db = { update: updateFn } as any;
      const repo = new DrizzleEnvelopeRepository(db);
      const entity = makeEntity({ name: 'Updated' });

      await repo.update(entity);

      expect(updateFn).toHaveBeenCalled();
      expect(setFn).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated', isSynced: false }),
      );
    });

    it('propagates database errors on update', async () => {
      const whereFn = jest.fn().mockRejectedValue(new Error('Update failed'));
      const setFn = jest.fn().mockReturnValue({ where: whereFn });
      const updateFn = jest.fn().mockReturnValue({ set: setFn });
      const db = { update: updateFn } as any;
      const repo = new DrizzleEnvelopeRepository(db);

      await expect(repo.update(makeEntity())).rejects.toThrow('Update failed');
    });
  });

  describe('delete', () => {
    it('deletes by id and householdId', async () => {
      const whereFn = jest.fn().mockResolvedValue(undefined);
      const deleteFn = jest.fn().mockReturnValue({ where: whereFn });
      const db = { delete: deleteFn } as any;
      const repo = new DrizzleEnvelopeRepository(db);

      await repo.delete('env-1', 'hh-1');

      expect(deleteFn).toHaveBeenCalled();
      expect(whereFn).toHaveBeenCalled();
    });

    it('propagates database errors on delete', async () => {
      const whereFn = jest.fn().mockRejectedValue(new Error('Delete failed'));
      const deleteFn = jest.fn().mockReturnValue({ where: whereFn });
      const db = { delete: deleteFn } as any;
      const repo = new DrizzleEnvelopeRepository(db);

      await expect(repo.delete('env-1', 'hh-1')).rejects.toThrow('Delete failed');
    });
  });
});
