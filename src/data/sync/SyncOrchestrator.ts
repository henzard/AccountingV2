import { asc, eq, isNull, or, lte, and } from 'drizzle-orm';
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
  auditEvents,
  slipQueue,
} from '../local/schema';
import { toSupabaseRow } from './rowConverters';
import { ReconcileEmergencyFundTypeUseCase } from '../../domain/babySteps/ReconcileEmergencyFundTypeUseCase';
import { logger } from '../../infrastructure/logging/Logger';

type SyncTable =
  | typeof envelopes
  | typeof transactions
  | typeof debts
  | typeof meterReadings
  | typeof households
  | typeof householdMembers
  | typeof babySteps
  | typeof auditEvents
  | typeof slipQueue;

const TABLE_MAP: Record<string, SyncTable> = {
  envelopes,
  transactions,
  debts,
  meter_readings: meterReadings,
  households,
  household_members: householdMembers,
  baby_steps: babySteps,
  audit_events: auditEvents,
  slip_queue: slipQueue,
};

const TABLE_RPC_MAP: Record<string, string> = {
  baby_steps: 'merge_baby_step',
  envelopes: 'merge_envelope',
  transactions: 'merge_transaction',
  debts: 'merge_debt',
  meter_readings: 'merge_meter_reading',
  households: 'merge_household',
  household_members: 'merge_household_member',
  audit_events: 'merge_audit_event',
  slip_queue: 'merge_slip_queue',
};

const DLQ_MAX_RETRIES = 10;
const DLQ_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class SyncOrchestrator {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly supabase: SupabaseClient,
  ) {}

  async syncPending(
    householdId?: string,
  ): Promise<{ synced: number; failed: number; emfFlipped: number }> {
    // Only fetch items whose backoff window has elapsed.
    // lastAttemptedAt stores the *next-allowed retry time* (not the last attempt time).
    // Items with no lastAttemptedAt are first-time attempts — always eligible.
    const nowIso = new Date().toISOString();
    const pending = await this.db
      .select()
      .from(pendingSync)
      .where(
        and(
          isNull(pendingSync.deadLetteredAt),
          or(isNull(pendingSync.lastAttemptedAt), lte(pendingSync.lastAttemptedAt, nowIso)),
        ),
      )
      .orderBy(asc(pendingSync.createdAt))
      .limit(100);

    let synced = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        await this.processItem(item);
        await this.db.delete(pendingSync).where(eq(pendingSync.id, item.id));
        synced++;
      } catch (err) {
        logger.error('sync item failed', err, { itemId: item.id, table: item.tableName });
        const now = new Date().toISOString();
        const newRetryCount = item.retryCount + 1;

        const shouldDLQ =
          newRetryCount >= DLQ_MAX_RETRIES ||
          Date.now() - new Date(item.createdAt).getTime() >= DLQ_MAX_AGE_MS;

        if (shouldDLQ) {
          await this.db
            .update(pendingSync)
            .set({ retryCount: newRetryCount, lastAttemptedAt: now, deadLetteredAt: now })
            .where(eq(pendingSync.id, item.id));
        } else {
          const backoffMs = Math.min(60_000, 1000 * 2 ** item.retryCount);
          const nextAttempt = new Date(Date.now() + backoffMs).toISOString();
          await this.db
            .update(pendingSync)
            .set({ retryCount: newRetryCount, lastAttemptedAt: nextAttempt })
            .where(eq(pendingSync.id, item.id));
        }
        failed++;
      }
    }

    // Spec §ReconcileEmergencyFundTypeUseCase trigger:
    // Fire ONLY when result is { failed: 0 } (full clean sync).
    let emfFlipped = 0;
    if (failed === 0 && householdId) {
      const fixer = new ReconcileEmergencyFundTypeUseCase(this.db);
      const fixResult = await fixer.execute(householdId).catch(() => null);
      if (fixResult?.success) {
        emfFlipped = fixResult.data.flipped;
      }
    }

    return { synced, failed, emfFlipped };
  }

  private async processItem(item: typeof pendingSync.$inferSelect): Promise<void> {
    if (item.operation === 'DELETE') {
      const { error } = await this.supabase.from(item.tableName).delete().eq('id', item.recordId);
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
    const rpcName = TABLE_RPC_MAP[item.tableName];
    if (rpcName) {
      // Route through per-table merge RPC with LWW guard
      const { error } = await this.supabase.rpc(rpcName, { row: snakeRow });
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
