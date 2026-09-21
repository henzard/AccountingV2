import type { TransactionEntity } from '../transactions/TransactionEntity';

/** Read-only: transaction WRITES go through the synced-write use cases so
 * they reach the oplog (and leave tombstones). See DrizzleTransactionRepository. */
export interface ITransactionRepository {
  findById(id: string, householdId: string): Promise<TransactionEntity | null>;
  findByHousehold(householdId: string, limit?: number): Promise<TransactionEntity[]>;
}
