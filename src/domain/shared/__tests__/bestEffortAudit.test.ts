import { bestEffortAudit } from '../bestEffortAudit';
import type { AuditLogEntry } from '../bestEffortAudit';

jest.mock('../../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn() },
}));

const mockAudit = { log: jest.fn() };
const { logger } = jest.requireMock('../../../infrastructure/logging/Logger');

const testEntry: AuditLogEntry = {
  householdId: 'h1',
  entityType: 'debt',
  entityId: 'debt-1',
  action: 'create',
  previousValue: null,
  newValue: { id: 'debt-1', name: 'Test Debt' },
};

describe('bestEffortAudit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves when audit.log succeeds', async () => {
    mockAudit.log.mockResolvedValue(undefined);
    await expect(bestEffortAudit(mockAudit as any, testEntry)).resolves.toBeUndefined();
    expect(mockAudit.log).toHaveBeenCalledWith(testEntry);
  });

  it('resolves when audit.log rejects (never throws)', async () => {
    const error = new Error('Database connection failed');
    mockAudit.log.mockRejectedValue(error);
    await expect(bestEffortAudit(mockAudit as any, testEntry)).resolves.toBeUndefined();
    expect(mockAudit.log).toHaveBeenCalledWith(testEntry);
  });

  it('logs error to logger when audit.log rejects', async () => {
    const error = new Error('Database connection failed');
    mockAudit.log.mockRejectedValue(error);
    await bestEffortAudit(mockAudit as any, testEntry);
    expect(logger.error).toHaveBeenCalledWith(
      'Audit log failed after write committed',
      error,
      expect.objectContaining({
        householdId: 'h1',
        entityType: 'debt',
        entityId: 'debt-1',
        action: 'create',
      }),
    );
  });

  it('does not rethrow audit.log errors', async () => {
    mockAudit.log.mockRejectedValue(new Error('Audit failure'));
    const fn = async () => {
      await bestEffortAudit(mockAudit as any, testEntry);
    };
    await expect(fn()).resolves.toBeUndefined();
  });
});
