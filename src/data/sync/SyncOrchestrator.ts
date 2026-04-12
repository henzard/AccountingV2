import { asc, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type * as schema from '../local/schema';
import {
  pendingSync,
  envelopes,
  transactions,
  debts,
  meterReadings,
  households,
  householdMembers,
  babySteps,
} from '../local/schema';
import { toSupabaseRow } from './rowConverters';
import { ReconcileEmergencyFundTypeUseCase } from '../../domain/babySteps/ReconcileEmergencyFundTypeUseCase';

type SyncTable =
  | typeof envelopes
  | typeof transactions
  | typeof debts
  | typeof meterReadings
  | typeof households
  | typeof householdMembers
  | typeof babySteps;

const BABY_STEPS_TABLE = 'baby_steps' as const;

const TABLE_MAP: Record<string, SyncTable> = {
  envelopes,
  transactions,
  debts,
  meter_readings: meterReadings,
  households,
  household_members: householdMembers,
  [BABY_STEPS_TABLE]: babySteps,
};

export class SyncOrchestrator {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly supabase: SupabaseClient,
    /** Optional household ID for post-sync reconciliation (e.g. emergency fund type fixer). */
    private readonly householdId?: string,
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

    // Spec §ReconcileEmergencyFundTypeUseCase trigger:
    // Fire ONLY when result is { failed: 0 } (full clean sync).
    if (failed === 0 && this.householdId) {
      const fixer = new ReconcileEmergencyFundTypeUseCase(this.db);
      await fixer.execute(this.householdId).catch(() => {
        // Non-fatal: log in production but don't bubble up
      });
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

    let syncError: PostgrestError | null = null;
    if (item.tableName === BABY_STEPS_TABLE && item.operation !== 'DELETE') {
      // Route through merge_baby_step RPC to preserve celebrated_at on conflict
      const { error } = await this.supabase.rpc('merge_baby_step', { row: snakeRow });
      syncError = error;
    } else {
      const { error } = await this.supabase
        .from(item.tableName)
        .upsert(snakeRow, { onConflict: 'id' });
      syncError = error;
    }
    if (syncError) throw new Error(syncError.message);

    // Only update isSynced for tables that have the column (not household_members)
    if (item.tableName !== 'household_members') {
      await this.db
        .update(table)
        .set({ isSynced: true } as Partial<typeof table.$inferInsert>)
        .where(eq((table as typeof envelopes).id, item.recordId));
    }
  }
}
