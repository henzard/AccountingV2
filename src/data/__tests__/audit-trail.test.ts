import { AuditLogger } from '../audit/AuditLogger';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'audit-uuid-001' }));

const mockInsertValues = jest.fn().mockResolvedValue(undefined);
const mockEnqueue = jest.fn().mockResolvedValue(undefined);

jest.mock('../sync/PendingSyncEnqueuer', () => ({
  PendingSyncEnqueuer: jest.fn().mockImplementation(() => ({
    enqueue: mockEnqueue,
  })),
}));

function createMockDb() {
  return {
    insert: jest.fn(() => ({
      values: mockInsertValues,
    })),
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Audit Trail — AuditLogger.log()', () => {
  it('creates audit event with correct fields', async () => {
    const db = createMockDb();
    const logger = new AuditLogger(db);

    await logger.log({
      householdId: 'hh-1',
      entityType: 'transaction',
      entityId: 'tx-123',
      action: 'create',
      previousValue: null,
      newValue: { amountCents: 500 },
    });

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'audit-uuid-001',
        householdId: 'hh-1',
        entityType: 'transaction',
        entityId: 'tx-123',
        action: 'create',
        isSynced: false,
        createdAt: expect.any(String),
      }),
    );
  });

  it('serializes previousValue to JSON', async () => {
    const db = createMockDb();
    const logger = new AuditLogger(db);

    const previousValue = { name: 'Groceries', allocatedCents: 500_00 };
    await logger.log({
      householdId: 'hh-1',
      entityType: 'envelope',
      entityId: 'env-1',
      action: 'update',
      previousValue,
      newValue: { name: 'Food' },
    });

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        previousValueJson: JSON.stringify(previousValue),
      }),
    );
  });

  it('serializes newValue to JSON', async () => {
    const db = createMockDb();
    const logger = new AuditLogger(db);

    const newValue = { name: 'Food', allocatedCents: 600_00 };
    await logger.log({
      householdId: 'hh-1',
      entityType: 'envelope',
      entityId: 'env-1',
      action: 'update',
      previousValue: { name: 'Groceries' },
      newValue,
    });

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        newValueJson: JSON.stringify(newValue),
      }),
    );
  });

  it('stores null when previousValue is null', async () => {
    const db = createMockDb();
    const logger = new AuditLogger(db);

    await logger.log({
      householdId: 'hh-1',
      entityType: 'transaction',
      entityId: 'tx-1',
      action: 'create',
      previousValue: null,
      newValue: { amountCents: 100 },
    });

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ previousValueJson: null }),
    );
  });

  it('stores null when newValue is null (delete action)', async () => {
    const db = createMockDb();
    const logger = new AuditLogger(db);

    await logger.log({
      householdId: 'hh-1',
      entityType: 'transaction',
      entityId: 'tx-1',
      action: 'delete',
      previousValue: { amountCents: 100 },
      newValue: null,
    });

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ newValueJson: null }));
  });

  it('enqueues sync for the audit event', async () => {
    const db = createMockDb();
    const logger = new AuditLogger(db);

    await logger.log({
      householdId: 'hh-1',
      entityType: 'envelope',
      entityId: 'env-1',
      action: 'archive',
      previousValue: null,
      newValue: null,
    });

    expect(mockEnqueue).toHaveBeenCalledWith('audit_events', 'audit-uuid-001', 'INSERT');
  });

  it('includes ISO timestamp in createdAt field', async () => {
    const db = createMockDb();
    const logger = new AuditLogger(db);

    const before = new Date().toISOString();
    await logger.log({
      householdId: 'hh-1',
      entityType: 'debt',
      entityId: 'debt-1',
      action: 'create',
      previousValue: null,
      newValue: { amountCents: 1000 },
    });
    const after = new Date().toISOString();

    const call = mockInsertValues.mock.calls[0][0];
    expect(call.createdAt >= before).toBe(true);
    expect(call.createdAt <= after).toBe(true);
  });
});
