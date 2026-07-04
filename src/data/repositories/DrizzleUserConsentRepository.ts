import { eq, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import * as schema from '../local/schema';
import { userConsent } from '../local/schema';
import type {
  IUserConsentRepository,
  UserConsentRow,
} from '../../domain/ports/IUserConsentRepository';
import { supabase } from '../remote/supabaseClient';

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
    // Known locally before the write below touches the row; used only to
    // decide whether `created_at` belongs in the remote upsert payload
    // (see comment below — the server column is NOT NULL with no default).
    const existing = await this.get(userId);

    // `user_consent` is a per-user (not per-household) table — spec §8
    // is explicit that user_preferences/user_consent/user_fcm_tokens stay
    // OUTSIDE the household-scoped oplog entirely and use direct
    // RLS-scoped upsert instead (the server's apply_one_op table
    // allowlist does not include them, so an oplog row for user_consent
    // would be permanently rejected). Mirror userPreferences.ts: a plain
    // local write for offline-first read access, plus a best-effort
    // direct upsert to Supabase (RLS-scoped to auth.uid(), per the
    // baseline user_consent_insert/user_consent_update policies).
    await this.db.run(sql`
      INSERT INTO user_consent (user_id, slip_scan_consent_at, created_at, updated_at)
      VALUES (${userId}, ${atIso}, ${now}, ${now})
      ON CONFLICT(user_id) DO UPDATE SET
        slip_scan_consent_at = excluded.slip_scan_consent_at,
        updated_at = excluded.updated_at
    `);

    // `user_consent.created_at` is `timestamptz NOT NULL` with no default,
    // so it must be present on INSERT — but omitted on UPDATE so a repeat
    // upsert doesn't clobber the row's original creation time.
    const remotePayload: Record<string, unknown> = existing
      ? { user_id: userId, slip_scan_consent_at: atIso, updated_at: now }
      : { user_id: userId, slip_scan_consent_at: atIso, created_at: now, updated_at: now };

    await supabase.from('user_consent').upsert(remotePayload, { onConflict: 'user_id' });
  }
}
