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

/**
 * AuditLogger — local-only audit trail.
 *
 * Historically enqueued each audit_events row onto the `pending_sync` outbox
 * (via `PendingSyncEnqueuer`) so `SyncOrchestrator` would push it through the
 * `merge_audit_event` RPC. Slice 5's oplog protocol never picked up
 * `audit_events` as a synced table — it's absent from both the server oplog
 * table allowlist (`supabase/migrations/0001_baseline.sql`,
 * `private.apply_one_op`'s `c_tables`) and the `SyncWriteDeps`/createSyncedRepo
 * writer list documented in `src/domain/ports/README.md`. Audit events are
 * therefore local-device-only in the new protocol; this class no longer
 * enqueues anything for sync. Removing the enqueue call also fixes a latent
 * bug: it was writing into `pending_sync`, which slice 5 task 6 drops
 * entirely (migration 0014) — left in place, every audit log call (i.e.
 * nearly every domain write) would have thrown "no such table: pending_sync"
 * at runtime once that migration ran.
 */
export class AuditLogger {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

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
    });
  }
}
