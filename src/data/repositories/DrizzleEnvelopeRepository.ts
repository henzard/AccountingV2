import { and, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';
import { envelopes } from '../local/schema';
import type { IEnvelopeRepository } from '../../domain/ports/IEnvelopeRepository';
import type { EnvelopeEntity } from '../../domain/envelopes/EnvelopeEntity';

export class DrizzleEnvelopeRepository implements IEnvelopeRepository {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async findById(id: string, householdId: string): Promise<EnvelopeEntity | null> {
    const [row] = await this.db
      .select()
      .from(envelopes)
      .where(and(eq(envelopes.id, id), eq(envelopes.householdId, householdId)))
      .limit(1);
    if (!row) return null;
    return this.rowToEntity(row);
  }

  async findByHousehold(householdId: string): Promise<EnvelopeEntity[]> {
    const rows = await this.db
      .select()
      .from(envelopes)
      .where(eq(envelopes.householdId, householdId));
    return rows.map((r) => this.rowToEntity(r));
  }

  async insert(e: EnvelopeEntity): Promise<void> {
    await this.db.insert(envelopes).values({ ...e, isSynced: false });
  }

  async update(e: EnvelopeEntity): Promise<void> {
    await this.db
      .update(envelopes)
      .set({
        name: e.name,
        allocatedCents: e.allocatedCents,
        spentCents: e.spentCents,
        envelopeType: e.envelopeType,
        isSavingsLocked: e.isSavingsLocked,
        isArchived: e.isArchived,
        periodStart: e.periodStart,
        updatedAt: e.updatedAt,
      })
      .where(and(eq(envelopes.id, e.id), eq(envelopes.householdId, e.householdId)));
  }

  async delete(id: string, householdId: string): Promise<void> {
    await this.db
      .delete(envelopes)
      .where(and(eq(envelopes.id, id), eq(envelopes.householdId, householdId)));
  }

  private rowToEntity(row: typeof envelopes.$inferSelect): EnvelopeEntity {
    return {
      id: row.id,
      householdId: row.householdId,
      name: row.name,
      allocatedCents: row.allocatedCents,
      spentCents: row.spentCents,
      envelopeType: row.envelopeType as EnvelopeEntity['envelopeType'],
      isSavingsLocked: row.isSavingsLocked,
      isArchived: row.isArchived,
      periodStart: row.periodStart,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
