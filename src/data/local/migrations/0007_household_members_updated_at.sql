ALTER TABLE `household_members` ADD `updated_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
