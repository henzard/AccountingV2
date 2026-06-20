import { DrizzleDebtRepository } from '../DrizzleDebtRepository';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';

const debt: DebtEntity = {
  id: 'd1',
  householdId: 'h1',
  creditorName: 'FNB',
  debtType: 'credit_card',
  outstandingBalanceCents: 50000,
  initialBalanceCents: 50000,
  interestRatePercent: 22.5,
  minimumPaymentCents: 1500,
  sortOrder: 0,
  isPaidOff: false,
  totalPaidCents: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  isSynced: false,
};

describe('DrizzleDebtRepository', () => {
  it('insert calls db.insert with correct data shape and isSynced:false', async () => {
    const valuesFn = jest.fn().mockResolvedValue(undefined);
    const insertFn = jest.fn().mockReturnValue({ values: valuesFn });
    const db = { insert: insertFn } as any;
    const repo = new DrizzleDebtRepository(db);

    await repo.insert(debt);

    expect(insertFn).toHaveBeenCalled();
    expect(valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'd1',
        householdId: 'h1',
        creditorName: 'FNB',
        debtType: 'credit_card',
        outstandingBalanceCents: 50000,
        interestRatePercent: 22.5,
        minimumPaymentCents: 1500,
        isSynced: false,
      }),
    );
  });

  it('findById returns null when no row found', async () => {
    const limitFn = jest.fn().mockResolvedValue([]);
    const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    const db = { select: selectFn } as any;
    const repo = new DrizzleDebtRepository(db);

    const result = await repo.findById('d1', 'h1');

    expect(result).toBeNull();
  });

  it('findById maps row to entity with all fields', async () => {
    const row = { ...debt };
    const limitFn = jest.fn().mockResolvedValue([row]);
    const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    const db = { select: selectFn } as any;
    const repo = new DrizzleDebtRepository(db);

    const result = await repo.findById('d1', 'h1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'd1',
        householdId: 'h1',
        creditorName: 'FNB',
        debtType: 'credit_card',
        outstandingBalanceCents: 50000,
        initialBalanceCents: 50000,
        interestRatePercent: 22.5,
        minimumPaymentCents: 1500,
        sortOrder: 0,
        isPaidOff: false,
        totalPaidCents: 0,
      }),
    );
  });

  it('findByHousehold returns all debts for a household', async () => {
    const rows = [debt, { ...debt, id: 'd2', creditorName: 'Absa' }];
    const whereFn = jest.fn().mockResolvedValue(rows);
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    const db = { select: selectFn } as any;
    const repo = new DrizzleDebtRepository(db);

    const result = await repo.findByHousehold('h1');

    expect(result).toHaveLength(2);
    expect(result[0].creditorName).toBe('FNB');
    expect(result[1].creditorName).toBe('Absa');
  });

  it('update calls db.update with partial fields', async () => {
    const whereFn = jest.fn().mockResolvedValue(undefined);
    const setFn = jest.fn().mockReturnValue({ where: whereFn });
    const updateFn = jest.fn().mockReturnValue({ set: setFn });
    const db = { update: updateFn } as any;
    const repo = new DrizzleDebtRepository(db);

    await repo.update({ id: 'd1', householdId: 'h1', creditorName: 'Updated' });

    expect(updateFn).toHaveBeenCalled();
    expect(setFn).toHaveBeenCalledWith({ creditorName: 'Updated' });
  });

  it('incrementTotalPaid calls db.update with sql expression', async () => {
    const whereFn = jest.fn().mockResolvedValue(undefined);
    const setFn = jest.fn().mockReturnValue({ where: whereFn });
    const updateFn = jest.fn().mockReturnValue({ set: setFn });
    const db = { update: updateFn } as any;
    const repo = new DrizzleDebtRepository(db);

    await repo.incrementTotalPaid('d1', 'h1', 500);

    expect(updateFn).toHaveBeenCalled();
    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({ totalPaidCents: expect.anything() }),
    );
  });
});
