import { randomUUID } from 'expo-crypto';
import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { pendingSync } from '../local/schema';
import type * as schema from '../local/schema';

export interface PendingSyncRecord {
  id: string;
  tableName: string;
  recordId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  retryCount: number;
  lastAttemptedAt: string | null;
  createdAt: string;
}

export class PendingSyncTable {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async enqueue(input: {
    tableName: string;
    recordId: string;
    operation: 'INSERT' | 'UPDATE' | 'DELETE';
  }): Promise<void> {
    await this.db.insert(pendingSync).values({
      id: randomUUID(),
      tableName: input.tableName,
      recordId: input.recordId,
      operation: input.operation,
      retryCount: 0,
      lastAttemptedAt: null,
      createdAt: new Date().toISOString(),
    });
  }

  async dequeue(syncRowId: string): Promise<void> {
    await this.db.delete(pendingSync).where(eq(pendingSync.id, syncRowId));
  }

  async getPending(): Promise<PendingSyncRecord[]> {
    return this.db.select().from(pendingSync) as Promise<PendingSyncRecord[]>;
  }

  async incrementRetry(syncRowId: string): Promise<void> {
    const row = await this.db.select().from(pendingSync).where(eq(pendingSync.id, syncRowId)).get();
    if (!row) return;
    await this.db
      .update(pendingSync)
      .set({
        retryCount: (row as PendingSyncRecord).retryCount + 1,
        lastAttemptedAt: new Date().toISOString(),
      })
      .where(eq(pendingSync.id, syncRowId));
  }
}
