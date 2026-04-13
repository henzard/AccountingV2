import { randomUUID } from 'expo-crypto';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { auditEvents } from '../local/schema';
import type * as schema from '../local/schema';
import { PendingSyncEnqueuer } from '../sync/PendingSyncEnqueuer';

interface LogInput {
  householdId: string;
  entityType: string;
  entityId: string;
  action: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
}

export class AuditLogger {
  private readonly enqueuer: PendingSyncEnqueuer;

  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {
    this.enqueuer = new PendingSyncEnqueuer(db);
  }

  async log(input: LogInput): Promise<void> {
    const now = new Date().toISOString();
    const id = randomUUID();
    await this.db.insert(auditEvents).values({
      id,
      householdId: input.householdId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      previousValueJson: input.previousValue ? JSON.stringify(input.previousValue) : null,
      newValueJson: input.newValue ? JSON.stringify(input.newValue) : null,
      createdAt: now,
      isSynced: false,
    });
    await this.enqueuer.enqueue('audit_events', id, 'INSERT');
  }
}
