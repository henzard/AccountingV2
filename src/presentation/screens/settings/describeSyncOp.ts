/**
 * describeSyncOp — convert raw table/opType to plain language for the UI.
 * Maps sync operations to user-facing descriptions (e.g., "A transaction you added").
 */

type TableName =
  | 'transactions'
  | 'envelopes'
  | 'debts'
  | 'meter_readings'
  | 'household_members'
  | 'slip_queue'
  | 'envelope_contributions'
  | 'baby_steps'
  | 'households';

type OpType = 'insert' | 'update' | 'delete';

export function describeSyncOp(tableName: string, opType: string): string {
  const descriptions: Record<TableName, Record<OpType, string>> = {
    transactions: {
      insert: 'A transaction you added',
      update: 'A change to a transaction',
      delete: 'A transaction you deleted',
    },
    envelopes: {
      insert: 'An envelope you added',
      update: 'A change to an envelope',
      delete: 'An envelope you deleted',
    },
    debts: {
      insert: 'A debt you added',
      update: 'A change to a debt',
      delete: 'A debt you deleted',
    },
    meter_readings: {
      insert: 'A meter reading you added',
      update: 'A change to a meter reading',
      delete: 'A meter reading you deleted',
    },
    household_members: {
      insert: 'A household membership you added',
      update: 'A change to a household membership',
      delete: 'A household membership you removed',
    },
    slip_queue: {
      insert: 'A scanned slip you added',
      update: 'A change to a scanned slip',
      delete: 'A scanned slip you deleted',
    },
    envelope_contributions: {
      insert: 'A savings contribution you made',
      update: 'A change to a savings contribution',
      delete: 'A savings contribution you deleted',
    },
    baby_steps: {
      insert: 'A baby step you added',
      update: 'A change to a baby step',
      delete: 'A baby step you deleted',
    },
    households: {
      insert: 'Household settings you added',
      update: 'Household settings you changed',
      delete: 'Household settings you deleted',
    },
  };

  // Payments are the only `increment` ops the app writes (LogDebtPaymentUseCase).
  if (opType === 'increment') {
    return tableName === 'debts' ? 'A debt payment' : 'A change';
  }

  const desc = descriptions[tableName as TableName]?.[opType as OpType];
  return desc ?? 'A change';
}
