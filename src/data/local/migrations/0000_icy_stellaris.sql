CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`previous_value_json` text,
	`new_value_json` text,
	`created_at` text NOT NULL,
	`is_synced` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `baby_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`is_completed` integer DEFAULT false NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_synced` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `debts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`creditor_name` text NOT NULL,
	`debt_type` text NOT NULL,
	`outstanding_balance_cents` integer NOT NULL,
	`interest_rate_percent` real NOT NULL,
	`minimum_payment_cents` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_paid_off` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_synced` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `envelopes` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`allocated_cents` integer DEFAULT 0 NOT NULL,
	`spent_cents` integer DEFAULT 0 NOT NULL,
	`envelope_type` text DEFAULT 'spending' NOT NULL,
	`is_savings_locked` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`period_start` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_synced` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`payday_day` integer DEFAULT 1 NOT NULL,
	`user_level` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_synced` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meter_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`meter_type` text NOT NULL,
	`reading_value` real NOT NULL,
	`reading_date` text NOT NULL,
	`cost_cents` integer,
	`vehicle_id` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_synced` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pending_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`operation` text NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`last_attempted_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slip_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`image_base64` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`extracted_json` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`envelope_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`payee` text,
	`description` text,
	`transaction_date` text NOT NULL,
	`is_business_expense` integer DEFAULT false NOT NULL,
	`spending_trigger_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_synced` integer DEFAULT false NOT NULL
);
