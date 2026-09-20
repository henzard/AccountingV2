-- 0015_oplog_applied_and_tx_envelope_idx.sql
--
-- 1. `oplog_applied` — the receiver-side idempotency ledger (R5) the puller
--    uses to make a re-delivered op a no-op. It was previously created
--    lazily by the `SyncEngine` constructor (`CREATE TABLE IF NOT EXISTS`),
--    which is too late: `runInUnitOfWork` now records every locally-written
--    `increment` op id in it, inside the same transaction as the write, and a
--    write can happen before a SyncEngine is ever constructed (offline boot,
--    signed-out-then-in). Creating it here puts it in the schema from the
--    start. `IF NOT EXISTS` keeps it compatible with a device that already
--    has the lazily-created table, and the SyncEngine's own guarded CREATE
--    stays a harmless no-op.
--
-- 2. `transactions (envelope_id, deleted_at)` — the envelope balance/spend
--    reads filter by envelope AND `deleted_at IS NULL`; without a composite
--    index SQLite scans every transaction row of the household per envelope.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oplog_applied` (
	`op_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `transactions_envelope_deleted_idx` ON `transactions` (`envelope_id`,`deleted_at`);
