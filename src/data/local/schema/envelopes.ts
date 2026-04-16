import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const envelopes = sqliteTable(
  'envelopes',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull(),
    name: text('name').notNull(),
    allocatedCents: integer('allocated_cents').notNull().default(0),
    spentCents: integer('spent_cents').notNull().default(0),
    envelopeType: text('envelope_type').notNull().default('spending'),
    // 'spending' | 'savings' | 'emergency_fund' | 'baby_step' | 'utility'
    isSavingsLocked: integer('is_savings_locked', { mode: 'boolean' }).notNull().default(false),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    periodStart: text('period_start').notNull(), // ISO date of budget period start
    targetAmountCents: integer('target_amount_cents'),
    targetDate: text('target_date'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => ({
    householdPeriodIdx: index('envelopes_household_period_idx').on(
      t.householdId,
      t.periodStart,
      t.isArchived,
    ),
  }),
);
