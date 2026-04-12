CREATE TABLE `household_members` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `baby_steps` ADD `is_manual` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `baby_steps` ADD `celebrated_at` text;