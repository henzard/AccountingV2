import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const envelopes = sqliteTable(
  'envelopes',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull(),
    name: text('name').notNull(),
    allocatedCents: integer('allocated_cents').notNull().default(0),
    envelopeType: text('envelope_type').notNull().default('spending'),
    // 'spending' | 'savings' | 'emergency_fund' | 'baby_step' | 'utility'
    isSavingsLocked: integer('is_savings_locked', { mode: 'boolean' }).notNull().default(false),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    periodStart: text('period_start').notNull(), // ISO date of budget period start
    targetAmountCents: integer('target_amount_cents'),
    targetDate: text('target_date'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => ({
    householdPeriodIdx: index('envelopes_household_period_idx').on(
      t.householdId,
      t.periodStart,
      t.isArchived,
    ),
    // Partial unique index: at most one ACTIVE emergency_fund envelope per
    // household — see migration 0013_emf_unique.sql for the full rationale
    // (this closes the same-device TOCTOU race in the create-time EMF
    // duplicate guard; the cross-device case remains handled by the
    // emergencyFundReconcileStore backstop).
    oneActiveEmfPerHousehold: uniqueIndex('envelopes_one_active_emf_per_household')
      .on(t.householdId)
      .where(
        sql`${t.envelopeType} = 'emergency_fund' AND ${t.deletedAt} IS NULL AND ${t.isArchived} = 0`,
      ),
  }),
);
