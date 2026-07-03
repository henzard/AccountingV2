ALTER TABLE `household_members` ADD `updated_at` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `household_members` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE `updated_at` = '';
