import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const householdMembers = sqliteTable('household_members', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  userId: text('user_id').notNull(),   // Supabase auth.uid()
  role: text('role').notNull().default('member'), // 'owner' | 'member'
  joinedAt: text('joined_at').notNull(),
});
