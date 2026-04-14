import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const userConsent = sqliteTable('user_consent', {
  userId: text('user_id').primaryKey(),
  slipScanConsentAt: text('slip_scan_consent_at'), // null = not consented
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
