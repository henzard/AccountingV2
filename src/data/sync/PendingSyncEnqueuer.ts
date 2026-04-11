import { randomUUID } from 'expo-crypto';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';
import { pendingSync } from '../local/schema';

export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export class PendingSyncEnqueuer {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async enqueue(tableName: string, recordId: string, operation: SyncOperation): Promise<void> {
    const now = new Date().toISOString();
    await this.db.insert(pendingSync).values({
      id: randomUUID(),
      tableName,
      recordId,
      operation,
      retryCount: 0,
      lastAttemptedAt: null,
      createdAt: now,
    });
  }
}
