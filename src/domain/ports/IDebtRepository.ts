import type { DebtEntity } from '../debtSnowball/DebtEntity';

export interface IDebtRepository {
  findById(id: string, householdId: string): Promise<DebtEntity | null>;
  findByHousehold(householdId: string): Promise<DebtEntity[]>;
  insert(debt: DebtEntity): Promise<void>;
  update(debt: Partial<DebtEntity> & { id: string; householdId: string }): Promise<void>;
}
