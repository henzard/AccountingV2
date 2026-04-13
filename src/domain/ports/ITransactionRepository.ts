import type { TransactionEntity } from '../transactions/TransactionEntity';

export interface ITransactionRepository {
  findById(id: string, householdId: string): Promise<TransactionEntity | null>;
  findByHousehold(householdId: string, limit?: number): Promise<TransactionEntity[]>;
  insert(t: TransactionEntity): Promise<void>;
  delete(id: string, householdId: string): Promise<void>;
}
