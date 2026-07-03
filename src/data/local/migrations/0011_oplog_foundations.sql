-- 0011_oplog_foundations.sql
-- Local SQLite oplog foundations for the slice-5 SyncEngine: outbox (oplog),
-- per-household pull cursor (sync_cursor), and score snapshots (score_history).

--> statement-breakpoint
CREATE TABLE `oplog` (
	`op_id` text PRIMARY KEY NOT NULL,
	`seq_local` integer,
	`household_id` text,
	`table_name` text,
	`row_id` text,
	`op_type` text,
	`payload` text,
	`actor_user_id` text,
	`device_id` text,
	`client_created_at` text,
	`pushed_at` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`dead_lettered_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oplog_seq_local_idx` ON `oplog` (`seq_local`);
--> statement-breakpoint
CREATE INDEX `oplog_pushed_next_attempt_idx` ON `oplog` (`pushed_at`,`next_attempt_at`);
--> statement-breakpoint
CREATE TABLE `sync_cursor` (
	`household_id` text PRIMARY KEY NOT NULL,
	`last_pulled_seq` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `score_history` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text,
	`period_start` text,
	`score` integer,
	`components` text,
	`created_at` text
);
