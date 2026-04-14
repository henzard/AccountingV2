import { sql, getTableColumns } from 'drizzle-orm';
import { logger } from '../../infrastructure/logging/Logger';
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
  babySteps,
  auditEvents,
  slipQueue,
  userConsent,
} from '../local/schema';
import { toLocalRow } from './rowConverters';
import { SeedBabyStepsUseCase } from '../../domain/babySteps/SeedBabyStepsUseCase';

export interface RestoredHousehold {
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

  async restore(userId: string): Promise<RestoredHousehold[]> {
    // 1. Fetch memberships from Supabase
    const { data: members, error: memberError } = await this.supabase
      .from('household_members')
      .select('household_id, role')
      .eq('user_id', userId);

    if (memberError) throw new Error(memberError.message);
    if (!members || members.length === 0) return [];

    const summaries: RestoredHousehold[] = [];

    for (const member of members) {
      const summary = await this.restoreHousehold(
        member.household_id as string,
        member.role as string,
        userId,
      );
      if (summary) summaries.push(summary);
    }

    return summaries;
  }

  async restoreHousehold(
    householdId: string,
    role: string,
    userId: string,
  ): Promise<RestoredHousehold | null> {
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
      const { isSynced: _ignored, ...insertableMember } = localMember;
      try {
        await this.db
          .insert(householdMembers)
          .values(insertableMember as typeof householdMembers.$inferInsert)
          .onConflictDoNothing();
      } catch (err) {
        logger.warn('household_members insert skipped (duplicate)', { err: String(err) });
      }
    }

    // Restore entity tables
    await this.restoreTable('envelopes', envelopes, householdId);
    await this.restoreTable('transactions', transactions, householdId);
    await this.restoreTable('debts', debts, householdId);
    await this.restoreTable('meter_readings', meterReadings, householdId);
    await this.restoreTable('baby_steps', babySteps, householdId);
    await this.restoreTable('audit_events', auditEvents, householdId);
    await this.restoreTable('slip_queue', slipQueue, householdId);
    await this.restoreUserConsent(userId);

    // Backfill any missing baby_steps rows (idempotent — INSERT OR IGNORE)
    const seeder = new SeedBabyStepsUseCase(this.db);
    await seeder.execute(householdId);

    return {
      id: hh.id as string,
      name: hh.name as string,
      paydayDay: hh.payday_day as number,
      role,
    };
  }

  private async restoreUserConsent(userId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('user_consent')
      .select('*')
      .eq('user_id', userId);

    if (error || !data) return;

    for (const row of data) {
      const localRow = toLocalRow(row as Record<string, unknown>);
      await this.db
        .insert(userConsent)
        .values(localRow as typeof userConsent.$inferInsert)
        .onConflictDoUpdate({
          target: userConsent.userId,
          set: {
            slipScanConsentAt: sql.raw('excluded.slip_scan_consent_at'),
            updatedAt: sql.raw('excluded.updated_at'),
            isSynced: true,
          },
        });
    }
  }

  private async restoreTable(
    supabaseTable: string,
    localTable:
      | typeof envelopes
      | typeof transactions
      | typeof debts
      | typeof meterReadings
      | typeof babySteps
      | typeof auditEvents
      | typeof slipQueue,
    householdId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from(supabaseTable)
      .select('*')
      .eq('household_id', householdId);

    if (error || !data) return;

    for (const row of data) {
      const localRow = toLocalRow(row as Record<string, unknown>);
      // Build set clause from all non-id columns so remote overwrites stale local rows.
      // Remote is authoritative on restore.
      const columns = Object.keys(getTableColumns(localTable)).filter((col) => col !== 'id');
      const setClause = Object.fromEntries(
        columns.map((col) => {
          // Map camelCase col to snake_case for the EXCLUDED reference
          const snakeCol = col.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`);
          return [col, sql.raw(`excluded.${snakeCol}`)];
        }),
      );
      await this.db
        .insert(localTable)
        .values(localRow as typeof localTable.$inferInsert)
        .onConflictDoUpdate({
          target: (localTable as typeof envelopes).id,
          set: setClause,
        });
    }
  }
}
