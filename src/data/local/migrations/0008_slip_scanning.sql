-- 0008_slip_scanning.sql
-- Replaces slip_queue with new cloud-image shape; adds transactions.slip_id; adds user_consent.

--> statement-breakpoint
DROP TABLE IF EXISTS `slip_queue`;
--> statement-breakpoint
CREATE TABLE `slip_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`created_by` text NOT NULL,
	`image_uris` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`error_message` text,
	`merchant` text,
	`slip_date` text,
	`total_cents` integer,
	`raw_response_json` text,
	`images_deleted_at` text,
	`openai_cost_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_synced` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `slip_id` text;
--> statement-breakpoint
CREATE INDEX `idx_transactions_slip_id` ON `transactions` (`slip_id`);
--> statement-breakpoint
CREATE TABLE `user_consent` (
	`user_id` text PRIMARY KEY NOT NULL,
	`slip_scan_consent_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_synced` integer DEFAULT false NOT NULL
);
