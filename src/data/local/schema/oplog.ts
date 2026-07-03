import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const oplog = sqliteTable(
  'oplog',
  {
    opId: text('op_id').primaryKey(),
    // Local outbox ordering hint ONLY — not an autoincrement PK.
    // SQLite AUTOINCREMENT requires `INTEGER PRIMARY KEY`, which is unavailable here
    // because `op_id` (text) is the primary key. The server assigns the authoritative
    // `seq` on push; `seq_local` is populated locally (e.g. from a counter or rowid) and
    // enforced unique via `oplog_seq_local_idx`, but callers must not rely on it for
    // cross-device ordering — only for local outbox draining order.
    seqLocal: integer('seq_local'),
    householdId: text('household_id'),
    tableName: text('table_name'),
    rowId: text('row_id'),
    opType: text('op_type'),
    payload: text('payload'), // JSON
    actorUserId: text('actor_user_id'),
    deviceId: text('device_id'),
    clientCreatedAt: text('client_created_at'),
    pushedAt: text('pushed_at'),
    retryCount: integer('retry_count').notNull().default(0),
    nextAttemptAt: text('next_attempt_at'),
    deadLetteredAt: text('dead_lettered_at'),
  },
  (t) => ({
    seqLocalIdx: uniqueIndex('oplog_seq_local_idx').on(t.seqLocal),
    pushedNextAttemptIdx: index('oplog_pushed_next_attempt_idx').on(t.pushedAt, t.nextAttemptAt),
  }),
);
