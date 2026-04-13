import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import * as schema from '../local/schema';
import { userConsent } from '../local/schema';
import type {
  IUserConsentRepository,
  UserConsentRow,
} from '../../domain/ports/IUserConsentRepository';

type Db = ExpoSQLiteDatabase<typeof schema>;

export class DrizzleUserConsentRepository implements IUserConsentRepository {
  constructor(private readonly db: Db) {}

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
    await this.db
      .insert(userConsent)
      .values({
        userId,
        slipScanConsentAt: atIso,
        createdAt: now,
        updatedAt: now,
        isSynced: false,
      })
      .onConflictDoUpdate({
        target: userConsent.userId,
        set: { slipScanConsentAt: atIso, updatedAt: now, isSynced: false },
      });
  }
}
