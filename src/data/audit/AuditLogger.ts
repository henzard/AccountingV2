import { randomUUID } from 'expo-crypto';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { auditEvents } from '../local/schema';
import type * as schema from '../local/schema';

interface LogInput {
  householdId: string;
  entityType: string;
  entityId: string;
  action: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
}

export class AuditLogger {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async log(input: LogInput): Promise<void> {
    const now = new Date().toISOString();
    await this.db.insert(auditEvents).values({
      id: randomUUID(),
      householdId: input.householdId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      previousValueJson: input.previousValue ? JSON.stringify(input.previousValue) : null,
      newValueJson: input.newValue ? JSON.stringify(input.newValue) : null,
      createdAt: now,
      isSynced: false,
    });
  }
}
