import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const babySteps = sqliteTable(
  'baby_steps',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull(),
    stepNumber: integer('step_number').notNull(), // 1-7
    isCompleted: integer('is_completed', { mode: 'boolean' }).notNull().default(false),
    completedAt: text('completed_at'), // ISO date when completed
    isManual: integer('is_manual', { mode: 'boolean' }).notNull().default(false),
    celebratedAt: text('celebrated_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => ({
    householdStepUnique: uniqueIndex('baby_steps_household_step_uq').on(
      table.householdId,
      table.stepNumber,
    ),
  }),
);
