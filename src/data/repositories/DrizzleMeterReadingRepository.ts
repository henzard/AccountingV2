import { and, eq, desc } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';
import { meterReadings } from '../local/schema';
import type { IMeterReadingRepository } from '../../domain/ports/IMeterReadingRepository';
import type { MeterReadingEntity, MeterType } from '../../domain/meterReadings/MeterReadingEntity';

export class DrizzleMeterReadingRepository implements IMeterReadingRepository {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async findById(id: string, householdId: string): Promise<MeterReadingEntity | null> {
    const [row] = await this.db
      .select()
      .from(meterReadings)
      .where(and(eq(meterReadings.id, id), eq(meterReadings.householdId, householdId)))
      .limit(1);
    if (!row) return null;
    return this.rowToEntity(row);
  }

  async findByHousehold(householdId: string, meterType?: MeterType): Promise<MeterReadingEntity[]> {
    const conditions = meterType
      ? and(eq(meterReadings.householdId, householdId), eq(meterReadings.meterType, meterType))
      : eq(meterReadings.householdId, householdId);

    const rows = await this.db
      .select()
      .from(meterReadings)
      .where(conditions)
      .orderBy(desc(meterReadings.readingDate));
    return rows.map((r) => this.rowToEntity(r));
  }

  async insert(reading: MeterReadingEntity): Promise<void> {
    await this.db.insert(meterReadings).values({ ...reading, isSynced: false });
  }

  private rowToEntity(row: typeof meterReadings.$inferSelect): MeterReadingEntity {
    return {
      id: row.id,
      householdId: row.householdId,
      meterType: row.meterType as MeterType,
      readingValue: row.readingValue,
      readingDate: row.readingDate,
      costCents: row.costCents ?? null,
      vehicleId: row.vehicleId ?? null,
      notes: row.notes ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isSynced: row.isSynced,
    };
  }
}
