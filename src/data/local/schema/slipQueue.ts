import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const slipQueue = sqliteTable('slip_queue', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  imageBase64: text('image_base64').notNull(),
  status: text('status').notNull().default('pending'),
  // 'pending' | 'processing' | 'completed' | 'failed'
  extractedJson: text('extracted_json'), // SlipExtraction JSON once processed
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
