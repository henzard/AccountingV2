import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const babySteps = sqliteTable('baby_steps', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  stepNumber: integer('step_number').notNull(), // 1-7
  isCompleted: integer('is_completed', { mode: 'boolean' }).notNull().default(false),
  completedAt: text('completed_at'), // ISO date when completed
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
