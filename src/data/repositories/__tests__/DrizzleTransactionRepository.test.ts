import { DrizzleTransactionRepository } from '../DrizzleTransactionRepository';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';

const makeEntity = (overrides: Partial<TransactionEntity> = {}): TransactionEntity => ({
  id: 'tx-1',
  householdId: 'hh-1',
  envelopeId: 'env-1',
  amountCents: 250_00,
  payee: 'Pick n Pay',
  description: 'Weekly groceries',
  transactionDate: '2026-06-10',
  isBusinessExpense: false,
  spendingTriggerNote: null,
  createdAt: '2026-06-10T08:00:00Z',
  updatedAt: '2026-06-10T08:00:00Z',
  ...overrides,
});

const makeRow = (entity: TransactionEntity) => ({
  ...entity,
  payee: entity.payee ?? undefined,
  description: entity.description ?? undefined,
  spendingTriggerNote: entity.spendingTriggerNote ?? undefined,
});

function buildSelectMock(rows: any[]) {
  const limitFn = jest.fn().mockResolvedValue(rows);
  const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
  const fromFn = jest.fn().mockReturnValue({ where: whereFn });
  const selectFn = jest.fn().mockReturnValue({ from: fromFn });
  return { selectFn, fromFn, whereFn, limitFn };
}

function buildSelectOrderedMock(rows: any[]) {
  const limitFn = jest.fn().mockResolvedValue(rows);
  const orderByFn = jest.fn().mockReturnValue({ limit: limitFn });
  const whereFn = jest.fn().mockReturnValue({ orderBy: orderByFn });
  const fromFn = jest.fn().mockReturnValue({ where: whereFn });
  const selectFn = jest.fn().mockReturnValue({ from: fromFn });
  return { selectFn, fromFn, whereFn, orderByFn, limitFn };
}

describe('DrizzleTransactionRepository', () => {
  describe('findById', () => {
    it('returns entity when row exists', async () => {
      const entity = makeEntity();
      const row = makeRow(entity);
      const { selectFn, limitFn } = buildSelectMock([row]);
      const db = { select: selectFn } as any;
      const repo = new DrizzleTransactionRepository(db);

      const result = await repo.findById('tx-1', 'hh-1');

      expect(result).toEqual(entity);
      expect(limitFn).toHaveBeenCalledWith(1);
    });

    it('returns null when row is not found', async () => {
      const { selectFn } = buildSelectMock([]);
      const db = { select: selectFn } as any;
      const repo = new DrizzleTransactionRepository(db);

      const result = await repo.findById('nonexistent', 'hh-1');

      expect(result).toBeNull();
    });

    it('propagates database errors', async () => {
      const limitFn = jest.fn().mockRejectedValue(new Error('DB Error'));
      const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
      const fromFn = jest.fn().mockReturnValue({ where: whereFn });
      const selectFn = jest.fn().mockReturnValue({ from: fromFn });
      const db = { select: selectFn } as any;
      const repo = new DrizzleTransactionRepository(db);

      await expect(repo.findById('tx-1', 'hh-1')).rejects.toThrow('DB Error');
    });
  });

  describe('findByHousehold', () => {
    it('returns transactions ordered by date with default limit', async () => {
      const entities = [makeEntity(), makeEntity({ id: 'tx-2', payee: 'Woolworths' })];
      const rows = entities.map(makeRow);
      const { selectFn, orderByFn, limitFn } = buildSelectOrderedMock(rows);
      const db = { select: selectFn } as any;
      const repo = new DrizzleTransactionRepository(db);

      const result = await repo.findByHousehold('hh-1');

      expect(result).toHaveLength(2);
      expect(orderByFn).toHaveBeenCalled();
      expect(limitFn).toHaveBeenCalledWith(100);
    });

    it('respects custom limit parameter', async () => {
      const { selectFn, limitFn } = buildSelectOrderedMock([]);
      const db = { select: selectFn } as any;
      const repo = new DrizzleTransactionRepository(db);

      await repo.findByHousehold('hh-1', 25);

      expect(limitFn).toHaveBeenCalledWith(25);
    });

    it('returns empty array when no transactions exist', async () => {
      const { selectFn } = buildSelectOrderedMock([]);
      const db = { select: selectFn } as any;
      const repo = new DrizzleTransactionRepository(db);

      const result = await repo.findByHousehold('hh-1');

      expect(result).toEqual([]);
    });
  });

  describe('insert', () => {
    it('inserts entity with isSynced false', async () => {
      const valuesFn = jest.fn().mockResolvedValue(undefined);
      const insertFn = jest.fn().mockReturnValue({ values: valuesFn });
      const db = { insert: insertFn } as any;
      const repo = new DrizzleTransactionRepository(db);
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
      const repo = new DrizzleTransactionRepository(db);

      await expect(repo.insert(makeEntity())).rejects.toThrow('Insert failed');
    });
  });

  describe('delete', () => {
    it('deletes by id and householdId', async () => {
      const whereFn = jest.fn().mockResolvedValue(undefined);
      const deleteFn = jest.fn().mockReturnValue({ where: whereFn });
      const db = { delete: deleteFn } as any;
      const repo = new DrizzleTransactionRepository(db);

      await repo.delete('tx-1', 'hh-1');

      expect(deleteFn).toHaveBeenCalled();
      expect(whereFn).toHaveBeenCalledTimes(1);
      const filterPredicate = whereFn.mock.calls[0][0];
      expect(filterPredicate).toBeDefined();
    });

    it('propagates database errors on delete', async () => {
      const whereFn = jest.fn().mockRejectedValue(new Error('Delete failed'));
      const deleteFn = jest.fn().mockReturnValue({ where: whereFn });
      const db = { delete: deleteFn } as any;
      const repo = new DrizzleTransactionRepository(db);

      await expect(repo.delete('tx-1', 'hh-1')).rejects.toThrow('Delete failed');
    });
  });
});
