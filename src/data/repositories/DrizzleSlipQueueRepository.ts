import { eq, lt, and, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import * as schema from '../local/schema';
import { slipQueue } from '../local/schema';
import type { ISlipQueueRepository, SlipQueueRow } from '../../domain/ports/ISlipQueueRepository';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../../domain/shared/syncWrite';
import type { SyncWriteDeps } from '../../domain/shared/syncWrite';

type Db = ExpoSQLiteDatabase<typeof schema>;

function rowToDomain(r: typeof slipQueue.$inferSelect): SlipQueueRow {
  return {
    id: r.id,
    householdId: r.householdId,
    createdBy: r.createdBy,
    imageUris: JSON.parse(r.imageUris) as string[],
    status: r.status as SlipQueueRow['status'],
    errorMessage: r.errorMessage,
    merchant: r.merchant,
    slipDate: r.slipDate,
    totalCents: r.totalCents,
    rawResponseJson: r.rawResponseJson,
    imagesDeletedAt: r.imagesDeletedAt,
    openaiCostCents: r.openaiCostCents,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class DrizzleSlipQueueRepository implements ISlipQueueRepository {
  constructor(
    private readonly db: Db,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async create(row: Parameters<ISlipQueueRepository['create']>[0]): Promise<void> {
    const repo = resolveSyncedRepo(this.db, 'slip_queue', this.deps);
    repo.insert(
      {
        id: row.id,
        household_id: row.householdId,
        created_by: row.createdBy,
        image_uris: JSON.stringify(row.imageUris),
        status: row.status,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      },
      resolveSyncedRepoCtx(this.deps),
    );
  }

  async get(id: string): Promise<SlipQueueRow | null> {
    const rows = await this.db.select().from(slipQueue).where(eq(slipQueue.id, id)).limit(1);
    return rows[0] ? rowToDomain(rows[0]) : null;
  }

  async update(id: string, patch: Partial<SlipQueueRow>): Promise<void> {
    const [existing] = await this.db.select().from(slipQueue).where(eq(slipQueue.id, id)).limit(1);
    if (!existing) return;

    const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.errorMessage !== undefined) set.error_message = patch.errorMessage;
    if (patch.merchant !== undefined) set.merchant = patch.merchant;
    if (patch.slipDate !== undefined) set.slip_date = patch.slipDate;
    if (patch.totalCents !== undefined) set.total_cents = patch.totalCents;
    if (patch.rawResponseJson !== undefined) set.raw_response_json = patch.rawResponseJson;
    if (patch.imagesDeletedAt !== undefined) set.images_deleted_at = patch.imagesDeletedAt;
    if (patch.openaiCostCents !== undefined) set.openai_cost_cents = patch.openaiCostCents;
    if (patch.imageUris !== undefined) set.image_uris = JSON.stringify(patch.imageUris);

    const repo = resolveSyncedRepo(this.db, 'slip_queue', this.deps);
    repo.update(id, existing.householdId, set, resolveSyncedRepoCtx(this.deps));
  }

  async listByHousehold(
    householdId: string,
    limit: number,
    offset: number,
  ): Promise<SlipQueueRow[]> {
    const rows = await this.db
      .select()
      .from(slipQueue)
      .where(eq(slipQueue.householdId, householdId))
      .limit(limit)
      .offset(offset);
    return rows.map(rowToDomain);
  }

  async listExpired(beforeDateIso: string): Promise<SlipQueueRow[]> {
    const rows = await this.db
      .select()
      .from(slipQueue)
      .where(
        and(lt(slipQueue.createdAt, beforeDateIso), sql`${slipQueue.imagesDeletedAt} IS NULL`),
      );
    return rows.map(rowToDomain);
  }

  async listProcessingOlderThan(beforeDateIso: string): Promise<SlipQueueRow[]> {
    const rows = await this.db
      .select()
      .from(slipQueue)
      .where(and(eq(slipQueue.status, 'processing'), lt(slipQueue.updatedAt, beforeDateIso)));
    return rows.map(rowToDomain);
  }
}
