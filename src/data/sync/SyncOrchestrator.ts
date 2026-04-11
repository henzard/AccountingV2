import { asc, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';
import type * as schema from '../local/schema';
import {
  pendingSync,
  envelopes,
  transactions,
  debts,
  meterReadings,
  households,
  householdMembers,
} from '../local/schema';
import { toSupabaseRow } from './rowConverters';

type SyncTable =
  | typeof envelopes
  | typeof transactions
  | typeof debts
  | typeof meterReadings
  | typeof households
  | typeof householdMembers;

const TABLE_MAP: Record<string, SyncTable> = {
  envelopes,
  transactions,
  debts,
  meter_readings: meterReadings,
  households,
  household_members: householdMembers,
};

export class SyncOrchestrator {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly supabase: SupabaseClient,
  ) {}

  async syncPending(): Promise<{ synced: number; failed: number }> {
    const pending = await this.db
      .select()
      .from(pendingSync)
      .orderBy(asc(pendingSync.createdAt))
      .limit(100);

    let synced = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        await this.processItem(item);
        await this.db.delete(pendingSync).where(eq(pendingSync.id, item.id));
        synced++;
      } catch {
        const now = new Date().toISOString();
        await this.db
          .update(pendingSync)
          .set({ retryCount: item.retryCount + 1, lastAttemptedAt: now })
          .where(eq(pendingSync.id, item.id));
        failed++;
      }
    }

    return { synced, failed };
  }

  private async processItem(item: typeof pendingSync.$inferSelect): Promise<void> {
    if (item.operation === 'DELETE') {
      const { error } = await this.supabase
        .from(item.tableName)
        .delete()
        .eq('id', item.recordId);
      if (error) throw new Error(error.message);
      return;
    }

    const table = TABLE_MAP[item.tableName];
    if (!table) throw new Error(`Unknown sync table: ${item.tableName}`);

    const [row] = await this.db
      .select()
      .from(table)
      .where(eq((table as typeof envelopes).id, item.recordId))
      .limit(1);

    if (!row) throw new Error(`Local row not found: ${item.tableName}/${item.recordId}`);

    const snakeRow = toSupabaseRow(row as Record<string, unknown>);
    const { error } = await this.supabase
      .from(item.tableName)
      .upsert(snakeRow, { onConflict: 'id' });
    if (error) throw new Error(error.message);

    // Only update isSynced for tables that have the column (not household_members)
    if (item.tableName !== 'household_members') {
      await this.db
        .update(table)
        .set({ isSynced: true } as Partial<typeof table.$inferInsert>)
        .where(eq((table as typeof envelopes).id, item.recordId));
    }
  }
}
