-- 0009_soft_delete_tombstones.sql
-- Add deleted_at (TEXT, nullable) to all domain tables for tombstone/soft-delete support.

--> statement-breakpoint
ALTER TABLE `envelopes` ADD `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `debts` ADD `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `meter_readings` ADD `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `baby_steps` ADD `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `households` ADD `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `household_members` ADD `deleted_at` text;
