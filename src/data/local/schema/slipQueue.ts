import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const slipQueue = sqliteTable('slip_queue', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  createdBy: text('created_by').notNull(),
  imageUris: text('image_uris').notNull(), // JSON array of Storage paths
  status: text('status').notNull().default('processing'),
  // 'processing' | 'completed' | 'failed' | 'cancelled'
  errorMessage: text('error_message'),
  merchant: text('merchant'),
  slipDate: text('slip_date'),
  totalCents: integer('total_cents'),
  rawResponseJson: text('raw_response_json'),
  imagesDeletedAt: text('images_deleted_at'),
  openaiCostCents: integer('openai_cost_cents').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
