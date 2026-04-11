import { sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';
import type * as schema from '../local/schema';
import {
  households,
  householdMembers,
  envelopes,
  transactions,
  debts,
  meterReadings,
} from '../local/schema';
import { toLocalRow } from './rowConverters';

export interface HouseholdSummary {
  id: string;
  name: string;
  paydayDay: number;
  role: string;
}

export class RestoreService {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly supabase: SupabaseClient,
  ) {}

  async restore(userId: string): Promise<HouseholdSummary[]> {
    // 1. Fetch memberships from Supabase
    const { data: members, error: memberError } = await this.supabase
      .from('household_members')
      .select('household_id, role')
      .eq('user_id', userId);

    if (memberError) throw new Error(memberError.message);
    if (!members || members.length === 0) return [];

    const summaries: HouseholdSummary[] = [];

    for (const member of members) {
      const summary = await this.restoreHousehold(member.household_id as string, member.role as string, userId);
      if (summary) summaries.push(summary);
    }

    return summaries;
  }

  async restoreHousehold(
    householdId: string,
    role: string,
    _userId: string,
  ): Promise<HouseholdSummary | null> {
    // Fetch household row
    const { data: hh, error: hhError } = await this.supabase
      .from('households')
      .select('*')
      .eq('id', householdId)
      .single();
    if (hhError || !hh) return null;

    // Upsert household into SQLite
    const localHh = toLocalRow(hh as Record<string, unknown>);
    await this.db
      .insert(households)
      .values(localHh as typeof households.$inferInsert)
      .onConflictDoUpdate({
        target: households.id,
        set: {
          name: sql`excluded.name`,
          paydayDay: sql`excluded.payday_day`,
          updatedAt: sql`excluded.updated_at`,
          isSynced: true,
        },
      });

    // Upsert household_members rows
    const { data: allMembers } = await this.supabase
      .from('household_members')
      .select('*')
      .eq('household_id', householdId);

    for (const m of allMembers ?? []) {
      const localMember = toLocalRow(m as Record<string, unknown>);
      try {
        await this.db
          .insert(householdMembers)
          .values(localMember as typeof householdMembers.$inferInsert)
          .onConflictDoNothing();
      } catch {
        // Ignore duplicate key errors for household_members
      }
    }

    // Restore entity tables
    await this.restoreTable('envelopes', envelopes, householdId);
    await this.restoreTable('transactions', transactions, householdId);
    await this.restoreTable('debts', debts, householdId);
    await this.restoreTable('meter_readings', meterReadings, householdId);

    return {
      id: hh.id as string,
      name: hh.name as string,
      paydayDay: hh.payday_day as number,
      role,
    };
  }

  private async restoreTable(
    supabaseTable: string,
    localTable:
      | typeof envelopes
      | typeof transactions
      | typeof debts
      | typeof meterReadings,
    householdId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from(supabaseTable)
      .select('*')
      .eq('household_id', householdId);

    if (error || !data) return;

    for (const row of data) {
      const localRow = toLocalRow(row as Record<string, unknown>);
      await this.db
        .insert(localTable)
        .values(localRow as typeof localTable.$inferInsert)
        .onConflictDoNothing();
    }
  }
}
