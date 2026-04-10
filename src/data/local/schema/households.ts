import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const households = sqliteTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  paydayDay: integer('payday_day').notNull().default(1),
  userLevel: integer('user_level').notNull().default(1), // 1=Learner, 2=Practitioner, 3=Mentor
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
