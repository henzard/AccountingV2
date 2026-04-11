ALTER TABLE `debts` ADD `initial_balance_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `debts` ADD `total_paid_cents` integer DEFAULT 0 NOT NULL;