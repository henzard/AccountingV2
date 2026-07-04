jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

import { AuditLogger } from './AuditLogger';
import { db } from '../local/db';
import { auditEvents } from '../local/schema';

jest.mock('../local/db', () => ({
  db: {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
    }),
  },
}));

describe('AuditLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const logger = new AuditLogger(db as any);

  it('inserts an audit event row', async () => {
    await logger.log({
      householdId: 'hh-1',
      entityType: 'envelope',
      entityId: 'env-1',
      action: 'CREATE',
      previousValue: null,
      newValue: { name: 'Groceries', allocatedCents: 200000 },
    });

    expect(db.insert).toHaveBeenCalledWith(auditEvents);
  });

  it('serializes newValue as JSON when present', async () => {
    const valuesMock = jest.fn().mockResolvedValue(undefined);
    (db.insert as jest.Mock).mockReturnValue({ values: valuesMock });

    await logger.log({
      householdId: 'hh-1',
      entityType: 'envelope',
      entityId: 'env-1',
      action: 'UPDATE',
      previousValue: { name: 'Old' },
      newValue: { name: 'New' },
    });

    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.previousValueJson).toBe(JSON.stringify({ name: 'Old' }));
    expect(insertedValues.newValueJson).toBe(JSON.stringify({ name: 'New' }));
  });

  it('sets previousValueJson to null when previousValue is null', async () => {
    const valuesMock = jest.fn().mockResolvedValue(undefined);
    (db.insert as jest.Mock).mockReturnValue({ values: valuesMock });

    await logger.log({
      householdId: 'hh-1',
      entityType: 'debt',
      entityId: 'debt-1',
      action: 'CREATE',
      previousValue: null,
      newValue: { creditorName: 'FNB' },
    });

    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.previousValueJson).toBeNull();
    expect(insertedValues.newValueJson).toBe(JSON.stringify({ creditorName: 'FNB' }));
  });

  it('sets newValueJson to null when newValue is null', async () => {
    const valuesMock = jest.fn().mockResolvedValue(undefined);
    (db.insert as jest.Mock).mockReturnValue({ values: valuesMock });

    await logger.log({
      householdId: 'hh-1',
      entityType: 'envelope',
      entityId: 'env-1',
      action: 'DELETE',
      previousValue: { name: 'Groceries' },
      newValue: null,
    });

    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.previousValueJson).toBe(JSON.stringify({ name: 'Groceries' }));
    expect(insertedValues.newValueJson).toBeNull();
  });

  it('does not write an isSynced column (retired in migration 0012)', async () => {
    const valuesMock = jest.fn().mockResolvedValue(undefined);
    (db.insert as jest.Mock).mockReturnValue({ values: valuesMock });

    await logger.log({
      householdId: 'hh-1',
      entityType: 'transaction',
      entityId: 'tx-1',
      action: 'CREATE',
      previousValue: null,
      newValue: { amountCents: 5000 },
    });

    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues).not.toHaveProperty('isSynced');
  });

  it('does not enqueue onto pending_sync (audit_events is local-only, slice 5)', async () => {
    const valuesMock = jest.fn().mockResolvedValue(undefined);
    (db.insert as jest.Mock).mockReturnValue({ values: valuesMock });

    await logger.log({
      householdId: 'hh-1',
      entityType: 'envelope',
      entityId: 'env-1',
      action: 'CREATE',
      previousValue: null,
      newValue: { name: 'Groceries' },
    });

    // AuditLogger no longer depends on PendingSyncEnqueuer (deleted, slice 5
    // task 6) — db.insert is called exactly once, for auditEvents only.
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('uses a generated UUID and ISO timestamp', async () => {
    const valuesMock = jest.fn().mockResolvedValue(undefined);
    (db.insert as jest.Mock).mockReturnValue({ values: valuesMock });

    await logger.log({
      householdId: 'hh-1',
      entityType: 'envelope',
      entityId: 'env-1',
      action: 'CREATE',
      previousValue: null,
      newValue: null,
    });

    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.id).toBe('test-uuid-1234');
    expect(insertedValues.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
