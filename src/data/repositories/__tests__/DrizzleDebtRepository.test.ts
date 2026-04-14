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
  it('insert calls db.insert with isSynced:false', async () => {
    const insertValues = jest.fn().mockResolvedValue(undefined);
    const db = { insert: jest.fn().mockReturnValue({ values: insertValues }) } as any;
    const repo = new DrizzleDebtRepository(db);
    await repo.insert(debt);
    expect(db.insert).toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1', isSynced: false }),
    );
  });

  it('findById returns null when no row found', async () => {
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      }),
    } as any;
    const repo = new DrizzleDebtRepository(db);
    const result = await repo.findById('d1', 'h1');
    expect(result).toBeNull();
  });

  it('findById maps row to entity', async () => {
    const row = { ...debt, debtType: 'credit_card' };
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([row]),
      }),
    } as any;
    const repo = new DrizzleDebtRepository(db);
    const result = await repo.findById('d1', 'h1');
    expect(result?.id).toBe('d1');
    expect(result?.creditorName).toBe('FNB');
  });
});
