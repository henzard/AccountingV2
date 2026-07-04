import { randomUUID } from 'expo-crypto';
import { eq, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import * as schema from '../local/schema';
import { userConsent } from '../local/schema';
import type {
  IUserConsentRepository,
  UserConsentRow,
} from '../../domain/ports/IUserConsentRepository';
import { runInUnitOfWork } from '../uow/UnitOfWork';
import { resolveSyncedRepoCtx } from '../../domain/shared/syncWrite';
import type { SyncWriteDeps } from '../../domain/shared/syncWrite';

type Db = ExpoSQLiteDatabase<typeof schema>;

export class DrizzleUserConsentRepository implements IUserConsentRepository {
  constructor(
    private readonly db: Db,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async get(userId: string): Promise<UserConsentRow | null> {
    const rows = await this.db
      .select()
      .from(userConsent)
      .where(eq(userConsent.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async setSlipScanConsent(userId: string, atIso: string): Promise<void> {
    const now = new Date().toISOString();
    // Check if row exists to determine INSERT vs UPDATE operation for sync
    const existing = await this.get(userId);
    const ctx = resolveSyncedRepoCtx(this.deps);

    // `user_consent` is keyed by `user_id`, not `id`, and has no
    // `household_id` at all (consent is a per-user, not per-household,
    // fact) — it doesn't fit `createSyncedRepo`'s household-scoped
    // (id, household_id) shape, so this drives `runInUnitOfWork` directly.
    // The oplog row's `household_id` is `null`, which `AppendOpInput`
    // explicitly supports for exactly this kind of user-scoped table.
    runInUnitOfWork(this.db, (uow) => {
      uow.db.run(sql`
        INSERT INTO user_consent (user_id, slip_scan_consent_at, created_at, updated_at)
        VALUES (${userId}, ${atIso}, ${now}, ${now})
        ON CONFLICT(user_id) DO UPDATE SET
          slip_scan_consent_at = excluded.slip_scan_consent_at,
          updated_at = excluded.updated_at
      `);

      if (existing) {
        uow.appendOp({
          opId: ctx.genId ? ctx.genId() : randomUUID(),
          householdId: null,
          tableName: 'user_consent',
          rowId: userId,
          opType: 'update',
          payload: { slip_scan_consent_at: atIso, updated_at: now },
          actorUserId: ctx.actorUserId,
          deviceId: ctx.deviceId,
          clientCreatedAt: ctx.clock(),
        });
      } else {
        uow.appendOp({
          opId: ctx.genId ? ctx.genId() : randomUUID(),
          householdId: null,
          tableName: 'user_consent',
          rowId: userId,
          opType: 'insert',
          payload: {
            user_id: userId,
            slip_scan_consent_at: atIso,
            created_at: now,
            updated_at: now,
          },
          actorUserId: ctx.actorUserId,
          deviceId: ctx.deviceId,
          clientCreatedAt: ctx.clock(),
        });
      }
    });
  }
}
