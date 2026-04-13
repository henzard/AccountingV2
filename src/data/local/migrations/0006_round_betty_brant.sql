CREATE INDEX `envelopes_household_period_idx` ON `envelopes` (`household_id`,`period_start`,`is_archived`);--> statement-breakpoint
CREATE INDEX `meter_readings_household_meter_idx` ON `meter_readings` (`household_id`,`meter_type`);--> statement-breakpoint
CREATE INDEX `transactions_household_date_idx` ON `transactions` (`household_id`,`transaction_date`);
