jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

import { AuditLogger } from './AuditLogger';
import { db } from '../local/db';
import { auditEvents } from '../local/schema';

// Use in-memory DB for tests
jest.mock('../local/db', () => ({
  db: {
    select: jest.fn().mockReturnValue({ from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    }),
    update: jest.fn().mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }) }),
  },
}));

describe('AuditLogger', () => {
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
});
