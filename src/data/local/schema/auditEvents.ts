import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  previousValueJson: text('previous_value_json'),
  newValueJson: text('new_value_json'),
  createdAt: text('created_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
