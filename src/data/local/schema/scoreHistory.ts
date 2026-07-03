import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const scoreHistory = sqliteTable('score_history', {
  id: text('id').primaryKey(),
  householdId: text('household_id'),
  periodStart: text('period_start'),
  score: integer('score'),
  components: text('components'), // JSON
  createdAt: text('created_at'),
});
