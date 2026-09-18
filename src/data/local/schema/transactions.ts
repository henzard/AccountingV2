import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull(),
    envelopeId: text('envelope_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    payee: text('payee'),
    description: text('description'),
    transactionDate: text('transaction_date').notNull(), // ISO date
    isBusinessExpense: integer('is_business_expense', { mode: 'boolean' }).notNull().default(false),
    spendingTriggerNote: text('spending_trigger_note'), // FR-72
    slipId: text('slip_id'),
    transactionHash: text('transaction_hash'), // SHA-256 hash for CSV import deduplication
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => ({
    householdDateIdx: index('transactions_household_date_idx').on(t.householdId, t.transactionDate),
    transactionHashIdx: index('transactions_hash_idx').on(t.householdId, t.transactionHash),
  }),
);
