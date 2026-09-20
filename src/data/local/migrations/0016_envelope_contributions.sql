-- 0016_envelope_contributions.sql
-- Ledger of money moved INTO a persistent envelope (`sinking_fund` |
-- `emergency_fund` | `savings` | `baby_step`).
--
-- Persistent envelopes keep ONE row across every budget period, so nothing
-- recorded that a period had actually funded them: `envelopes.allocated_cents`
-- is the MONTHLY contribution the user budgets, and reading it as "saved"
-- meant a fund showed the same figure forever however many months had been
-- budgeted — and Baby Step 1 "completed" the instant someone typed R1,000
-- into the allocation field. With this table a persistent envelope's saved
-- balance is DERIVED, exactly as period-envelope spend already is:
--
--   saved_cents = SUM(envelope_contributions.amount_cents)
--               - SUM(transactions.amount_cents)
--
-- Rows are append-only and carry deterministic ids (uuidv5 over
-- household:envelope:period — see `PersistentContributions`), so a double
-- rollover, and two offline devices rolling the same period transition over
-- independently, converge on ONE row instead of double-funding the envelope.
--
-- NO backfill runs here. The opening-balance row that carries a legacy
-- envelope's existing `allocated_cents` forward is written by application
-- code (`ensureOpeningBalances`) through the synced-repo path, so it lands in
-- the oplog and REPLICATES. A SQL backfill here would only ever exist on the
-- device that ran the migration, leaving a freshly-restored device silently
-- short by the opening amount.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `envelope_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`envelope_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`period_start` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `envelope_contributions_household_envelope_idx` ON `envelope_contributions` (`household_id`,`envelope_id`);
