import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const meterReadings = sqliteTable('meter_readings', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  meterType: text('meter_type').notNull(), // 'electricity' | 'water' | 'odometer'
  readingValue: real('reading_value').notNull(), // kWh, kL, or km
  readingDate: text('reading_date').notNull(), // ISO date
  costCents: integer('cost_cents'), // associated expense amount in cents
  vehicleId: text('vehicle_id'), // for odometer readings
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
