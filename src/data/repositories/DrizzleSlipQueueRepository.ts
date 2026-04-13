import { eq, lt, and, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import * as schema from '../local/schema';
import { slipQueue } from '../local/schema';
import type { ISlipQueueRepository, SlipQueueRow } from '../../domain/ports/ISlipQueueRepository';

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
  constructor(private readonly db: Db) {}

  async create(row: Parameters<ISlipQueueRepository['create']>[0]): Promise<void> {
    await this.db.insert(slipQueue).values({
      id: row.id,
      householdId: row.householdId,
      createdBy: row.createdBy,
      imageUris: JSON.stringify(row.imageUris),
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isSynced: false,
    });
  }

  async get(id: string): Promise<SlipQueueRow | null> {
    const rows = await this.db.select().from(slipQueue).where(eq(slipQueue.id, id)).limit(1);
    return rows[0] ? rowToDomain(rows[0]) : null;
  }

  async update(id: string, patch: Partial<SlipQueueRow>): Promise<void> {
    const set: Record<string, unknown> = { isSynced: false, updatedAt: new Date().toISOString() };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.errorMessage !== undefined) set.errorMessage = patch.errorMessage;
    if (patch.merchant !== undefined) set.merchant = patch.merchant;
    if (patch.slipDate !== undefined) set.slipDate = patch.slipDate;
    if (patch.totalCents !== undefined) set.totalCents = patch.totalCents;
    if (patch.rawResponseJson !== undefined) set.rawResponseJson = patch.rawResponseJson;
    if (patch.imagesDeletedAt !== undefined) set.imagesDeletedAt = patch.imagesDeletedAt;
    if (patch.openaiCostCents !== undefined) set.openaiCostCents = patch.openaiCostCents;
    if (patch.imageUris !== undefined) set.imageUris = JSON.stringify(patch.imageUris);
    await this.db.update(slipQueue).set(set).where(eq(slipQueue.id, id));
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
