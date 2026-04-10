import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  envelopeId: text('envelope_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  payee: text('payee'),
  description: text('description'),
  transactionDate: text('transaction_date').notNull(), // ISO date
  isBusinessExpense: integer('is_business_expense', { mode: 'boolean' }).notNull().default(false),
  spendingTriggerNote: text('spending_trigger_note'), // FR-72
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
