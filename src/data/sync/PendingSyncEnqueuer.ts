import { randomUUID } from 'expo-crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';
import { pendingSync } from '../local/schema';

export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export class PendingSyncEnqueuer {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async enqueue(tableName: string, recordId: string, operation: SyncOperation): Promise<void> {
    const existing = await this.db
      .select({ id: pendingSync.id })
      .from(pendingSync)
      .where(
        and(
          eq(pendingSync.tableName, tableName),
          eq(pendingSync.recordId, recordId),
          isNull(pendingSync.deadLetteredAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // Only update operation so the newer op takes priority on LWW.
      // Do NOT touch lastAttemptedAt or retryCount — resetting them would
      // defeat backoff for items currently in an exponential-backoff window.
      await this.db
        .update(pendingSync)
        .set({ operation })
        .where(eq(pendingSync.id, existing[0].id));
      return;
    }

    const now = new Date().toISOString();
    await this.db.insert(pendingSync).values({
      id: randomUUID(),
      tableName,
      recordId,
      operation,
      retryCount: 0,
      lastAttemptedAt: null,
      deadLetteredAt: null,
      createdAt: now,
    });
  }
}
