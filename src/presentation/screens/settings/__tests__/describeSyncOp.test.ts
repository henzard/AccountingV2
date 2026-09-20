/**
 * describeSyncOp.test.ts
 *
 * Table-driven tests for describeSyncOp mapping function.
 */
import { describeSyncOp } from '../describeSyncOp';

describe('describeSyncOp', () => {
  it('maps transactions insert to "A transaction you added"', () => {
    expect(describeSyncOp('transactions', 'insert')).toBe('A transaction you added');
  });

  it('maps transactions update to "A change to a transaction"', () => {
    expect(describeSyncOp('transactions', 'update')).toBe('A change to a transaction');
  });

  it('maps transactions delete to "A transaction you deleted"', () => {
    expect(describeSyncOp('transactions', 'delete')).toBe('A transaction you deleted');
  });

  it('maps envelopes insert to "An envelope you added"', () => {
    expect(describeSyncOp('envelopes', 'insert')).toBe('An envelope you added');
  });

  it('maps debts insert to "A debt you added"', () => {
    expect(describeSyncOp('debts', 'insert')).toBe('A debt you added');
  });

  it('maps debts update to "A debt payment"', () => {
    expect(describeSyncOp('debts', 'update')).toBe('A change to a debt');
  });

  it('maps meter_readings to appropriate descriptions', () => {
    expect(describeSyncOp('meter_readings', 'insert')).toBe('A meter reading you added');
    expect(describeSyncOp('meter_readings', 'update')).toBe('A change to a meter reading');
    expect(describeSyncOp('meter_readings', 'delete')).toBe('A meter reading you deleted');
  });

  it('maps household_members to appropriate descriptions', () => {
    expect(describeSyncOp('household_members', 'insert')).toBe('A household membership you added');
    expect(describeSyncOp('household_members', 'update')).toBe(
      'A change to a household membership',
    );
    expect(describeSyncOp('household_members', 'delete')).toBe(
      'A household membership you removed',
    );
  });

  it('maps slip_queue to appropriate descriptions', () => {
    expect(describeSyncOp('slip_queue', 'insert')).toBe('A scanned slip you added');
    expect(describeSyncOp('slip_queue', 'update')).toBe('A change to a scanned slip');
    expect(describeSyncOp('slip_queue', 'delete')).toBe('A scanned slip you deleted');
  });

  it('maps envelope_contributions to savings-related descriptions', () => {
    expect(describeSyncOp('envelope_contributions', 'insert')).toBe(
      'A savings contribution you made',
    );
    expect(describeSyncOp('envelope_contributions', 'update')).toBe(
      'A change to a savings contribution',
    );
    expect(describeSyncOp('envelope_contributions', 'delete')).toBe(
      'A savings contribution you deleted',
    );
  });

  it('maps baby_steps to appropriate descriptions', () => {
    expect(describeSyncOp('baby_steps', 'insert')).toBe('A baby step you added');
  });

  it('maps households to settings descriptions', () => {
    expect(describeSyncOp('households', 'insert')).toBe('Household settings you added');
    expect(describeSyncOp('households', 'update')).toBe('Household settings you changed');
    expect(describeSyncOp('households', 'delete')).toBe('Household settings you deleted');
  });

  it('returns "A change" for unknown table names', () => {
    expect(describeSyncOp('unknown_table', 'insert')).toBe('A change');
  });

  it('returns "A change" for unknown operation types', () => {
    expect(describeSyncOp('transactions', 'unknown_op' as any)).toBe('A change');
  });

  it('describes a debt increment as a payment, and any other increment generically', () => {
    expect(describeSyncOp('debts', 'increment')).toBe('A debt payment');
    expect(describeSyncOp('envelopes', 'increment')).toBe('A change');
  });
});
