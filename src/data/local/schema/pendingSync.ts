import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const pendingSync = sqliteTable('pending_sync', {
  id: text('id').primaryKey(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  operation: text('operation').notNull(), // 'INSERT' | 'UPDATE' | 'DELETE'
  retryCount: integer('retry_count').notNull().default(0),
  lastAttemptedAt: text('last_attempted_at'),
  deadLetteredAt: text('dead_lettered_at'),
  createdAt: text('created_at').notNull(),
});
