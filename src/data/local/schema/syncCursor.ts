import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const syncCursor = sqliteTable('sync_cursor', {
  householdId: text('household_id').primaryKey(),
  lastPulledSeq: integer('last_pulled_seq').notNull().default(0),
});
