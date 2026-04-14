import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';
import { households } from '../local/schema';
import type { IHouseholdRepository, HouseholdRow } from '../../domain/ports/IHouseholdRepository';

export class DrizzleHouseholdRepository implements IHouseholdRepository {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async findById(id: string): Promise<HouseholdRow | null> {
    const [row] = await this.db.select().from(households).where(eq(households.id, id)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      paydayDay: row.paydayDay,
      userLevel: row.userLevel,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isSynced: row.isSynced,
    };
  }

  async insert(household: HouseholdRow): Promise<void> {
    await this.db.insert(households).values({ ...household, isSynced: false });
  }
}
