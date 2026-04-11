import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const debts = sqliteTable('debts', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  creditorName: text('creditor_name').notNull(),
  debtType: text('debt_type').notNull(),
  // 'credit_card' | 'personal_loan' | 'store_account' | 'vehicle_finance' | 'bond'
  outstandingBalanceCents: integer('outstanding_balance_cents').notNull(),
  initialBalanceCents: integer('initial_balance_cents').notNull().default(0),
  interestRatePercent: real('interest_rate_percent').notNull(),
  minimumPaymentCents: integer('minimum_payment_cents').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isPaidOff: integer('is_paid_off', { mode: 'boolean' }).notNull().default(false),
  totalPaidCents: integer('total_paid_cents').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
