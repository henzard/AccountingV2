import type { AuditLogger } from '../../data/audit/AuditLogger';
import { logger } from '../../infrastructure/logging/Logger';

/**
 * Audit log entry parameter type.
 * Mirrors AuditLogger.log input parameter (not exported from AuditLogger).
 */
export interface AuditLogEntry {
  householdId: string;
  entityType: string;
  entityId: string;
  action: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
}

/**
 * Best-effort audit logging: never throws, reports failures to the app logger.
 *
 * Use cases call audit.log AFTER their database write has already committed,
 * so if audit.log throws, the use case must still return success (the write
 * succeeded). This function wraps audit.log in try/catch and reports failures
 * to the app's monitoring/logging system without rethrowing.
 *
 * @param audit The AuditLogger instance
 * @param entry The audit log entry to record
 */
export async function bestEffortAudit(audit: AuditLogger, entry: AuditLogEntry): Promise<void> {
  try {
    await audit.log(entry);
  } catch (err) {
    logger.error('Audit log failed after write committed', err, {
      householdId: entry.householdId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
    });
  }
}
