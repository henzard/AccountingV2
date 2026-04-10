import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const debts = sqliteTable('debts', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  creditorName: text('creditor_name').notNull(),
  debtType: text('debt_type').notNull(),
  // 'credit_card' | 'personal_loan' | 'store_account' | 'vehicle_finance' | 'bond'
  outstandingBalanceCents: integer('outstanding_balance_cents').notNull(),
  interestRatePercent: real('interest_rate_percent').notNull(),
  minimumPaymentCents: integer('minimum_payment_cents').notNull(),
  sortOrder: integer('sort_order').notNull().default(0), // smallest-first by default
  isPaidOff: integer('is_paid_off', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
