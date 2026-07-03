-- 0012_derive_balances.sql
-- Drop the dead `envelopes.spent_cents` column (envelope spend is now derived
-- from the transaction ledger — see getEnvelopeSpentCents — nothing writes
-- this column anymore as of Task 3 of the slice-3 plan). Also drop the legacy
-- `is_synced` column from every local table that still has it: sync state is
-- now tracked by the oplog outbox introduced in 0011, not a per-row flag.
--
-- SQLite's `ALTER TABLE ... DROP COLUMN` (supported since SQLite 3.35, and
-- both better-sqlite3 12.9 and the expo-sqlite SDK 55 bundle far newer
-- versions) is used directly rather than the 12-step table-rebuild dance,
-- since both local engines support it natively.

--> statement-breakpoint
ALTER TABLE `envelopes` DROP COLUMN `spent_cents`;
--> statement-breakpoint
ALTER TABLE `envelopes` DROP COLUMN `is_synced`;
--> statement-breakpoint
ALTER TABLE `households` DROP COLUMN `is_synced`;
--> statement-breakpoint
ALTER TABLE `transactions` DROP COLUMN `is_synced`;
--> statement-breakpoint
ALTER TABLE `meter_readings` DROP COLUMN `is_synced`;
--> statement-breakpoint
ALTER TABLE `debts` DROP COLUMN `is_synced`;
--> statement-breakpoint
ALTER TABLE `baby_steps` DROP COLUMN `is_synced`;
--> statement-breakpoint
ALTER TABLE `slip_queue` DROP COLUMN `is_synced`;
--> statement-breakpoint
ALTER TABLE `audit_events` DROP COLUMN `is_synced`;
--> statement-breakpoint
ALTER TABLE `user_consent` DROP COLUMN `is_synced`;
