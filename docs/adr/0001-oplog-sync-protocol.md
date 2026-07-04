# ADR 0001 — Server-sequenced oplog sync protocol

**Date:** 2026-07-04 · **Author:** Amelia (dev agent), slice 5 task 6 · **Status:** Accepted
**Affects:** `src/data/local/schema/oplog.ts`, `src/data/local/schema/syncCursor.ts`,
`src/data/uow/UnitOfWork.ts`, `src/data/uow/createSyncedRepo.ts`,
`src/data/sync/SyncEngine.ts`, `src/data/sync/SyncScheduler.ts`,
`supabase/migrations/0001_baseline.sql` (§9, functions `sync_push`, `sync_pull`,
`sync_row_state`, `apply_server_op`, `private.apply_one_op`)
**Supersedes / Superseded-by:** Supersedes the pre-slice-2 per-table `merge_*` RPC + LWW
design (`SyncOrchestrator`/`PendingSyncEnqueuer`/`PendingSyncTable`/`RestoreService`'s
full-restore role, all deleted or narrowed in this slice — see Consequences).

> **We replaced ten per-table `merge_*` RPCs and a client-clock LWW merge with one
> append-only, server-sequenced operation log that both sides replicate — because the
> old design's conflict resolution depended on unreliable client clocks and its per-table
> RPCs were an unbounded-growth surface for exactly the bug classes the 2026-07-02 deep
> review found.**

---

## Context

The pre-slice-2 sync design (10 `merge_*` RPCs, one per table, each doing its own
last-write-wins comparison against client-supplied timestamps, drained from a local
`pending_sync` outbox by `SyncOrchestrator`, with `RestoreService` doing a full
table-by-table restore capped at 1000 rows per table on install/reinstall) was the
subject of a deep review
(`docs/reviews/2026-07-02-deep-review-findings.md`) that found real, shipped bugs:
three different timestamp formats compared against each other in different `merge_*`
functions, a restore that clobbered unpushed local edits, an outbox enqueue that could be
silently skipped on certain write paths, and no server-side membership re-check on the
row being written (the `merge_transaction`-class hole). Fixing these one `merge_*`
function at a time would have re-created the same review 10 times over; the codebase was
pre-launch (`docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md`,
"Decisions log" — "Production status: Not launched, no data to protect" —
so a full protocol replacement was accepted as the cheaper path.

The full design rationale, alternatives considered, and slice-by-slice build order live
in `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md` (the "spec",
referenced by section below). This ADR is the durable contract record the spec itself
calls for (§6.5) — it is not a restatement of the spec's narrative, just the binding
protocol shape plus the deferrals and exceptions a future reader needs before touching
`sync_push`/`sync_pull`/`SyncEngine`.

## Decision

We will replicate committed writes as an **append-only, server-sequenced operation log**
("oplog"), not as row snapshots merged by client-supplied timestamps.

### The wire op (spec §1)

Every mutation is one op: `{v: 1, op_id (uuid), household_id, table, row_id, op_type:
insert|update|delete|increment, payload, actor_user_id, device_id, client_created_at}`.
`op_id` is client-generated and globally unique, making retries idempotent by
construction (§6.11, below). Local SQLite writes the entity row **and** appends this op
in the same transaction (`createSyncedRepo`/`runInUnitOfWork`) — an op can never be
forgotten, unlike the old design's separate enqueue step.

### Four RPCs are the entire server write/read surface

- **`sync_push(p_ops jsonb)`** — the client's only write path. Groups ops by
  `household_id` (input order preserved in the response), validates membership once per
  group, takes the per-household advisory lock (below), then applies each op via
  `private.apply_one_op` and returns `[{op_id, status: 'applied'|'rejected', code}]` in
  input order.
- **`sync_pull(p_household_id, p_after_seq, p_limit)`** — ordered incremental fetch from
  the server oplog, capped at `p_limit` (server-enforced max 500, spec §7.5). This is now
  the ONLY fresh-install/reinstall discovery mechanism for a household the client already
  knows about (see Consequences re: `RestoreService`).
- **`sync_row_state(p_household_id, p_table, p_row_id)`** — returns the current
  authoritative row (or `null`), membership-checked identically to `sync_pull`. Used
  exclusively by the DLQ "discard" action (§6.10, below) so discarding a permanently
  rejected local op can re-sync that one row instead of leaving it silently diverged.
- **`apply_server_op(p_op jsonb)`** — the service-role entry point for edge
  functions/crons (slip-scanning cleanup, etc.). Takes the same advisory lock and calls
  the same `private.apply_one_op` apply path as one `sync_push` op, so server-originated
  writes produce a real oplog row too (`device_id = 'server'`) — no synced table can be
  mutated by anything that bypasses the oplog.

Direct DML on every synced table stays revoked for `authenticated`; these four
`SECURITY DEFINER` functions are the only write path (defense-in-depth carried over
unchanged from the pre-existing RLS design).

### Per-household advisory lock + seq ordering (§6.1)

A naive `bigserial` + "pull after cursor" loses ops under concurrent writers: seq N+1 can
commit and become visible while seq N's transaction is still open, so a pull racing
between the two commits would skip N forever once the cursor advances past it. Every
oplog writer — `sync_push` and `apply_server_op` — takes
`pg_advisory_xact_lock(hashtextextended(household_id, 0))` before applying its batch,
serializing writes **per household** so per-household `seq` order equals commit order.
`sync_pull` is per-household, so its cursor can never skip an in-flight op. There is no
global lock; unrelated households never contend.

### Per-op savepoints, non-atomic batch (§6.3)

A `sync_push` batch is **not** transactionally atomic. Each op applies inside its own
Postgres savepoint (`private.apply_one_op`'s `BEGIN … EXCEPTION WHEN OTHERS`), recorded
in the oplog first (so a duplicate resend short-circuits before any apply work), then
applied; a failure rolls back only that op's savepoint and reports `{status: 'rejected',
code}` for it while every other op in the batch still applies. This trades whole-batch
atomicity for the guarantee that one poisoned op (bad payload, wrong-household target,
constraint violation) can never block or roll back the rest of a device's queued writes
— a poison op is isolated to itself, never a poison **batch**. The client-side
consequence (accepted, not a bug): a multi-op write that depends on more than one op
landing together (e.g. the old debt-payment 3-op shape) can observe a torn intermediate
state if the batch is interrupted between ops — see the `is_paid_off` fix in
Consequences for the one place this actually bit us.

### Duplicate-op acknowledgement (§6.11)

An op whose `op_id` already exists in the server oplog (client killed/network-dropped
between the server's apply and the client receiving the ack, then resent on retry)
returns `status: 'applied'`, never `'rejected'` — `private.apply_one_op` checks this via
`INSERT … ON CONFLICT (op_id) DO NOTHING` before doing any apply work. This is what makes
retries safe: the pusher never dead-letters a write that already succeeded.

### Column allowlist + wrong-household guard (§6.4)

Before applying any op, the server allowlist-checks every payload key against the
target table's real columns minus `id`/`household_id` (an `update`/`insert`/`delete`
payload with any other key is rejected `forbidden_column`; an `increment`'s `field` is
checked the same way) and, for `update`/`delete`/`increment`, re-reads the row's actual
`household_id` and rejects `wrong_household` if it doesn't match the op's claimed
household — closing the old `merge_transaction`-class hole where a forged/stale
`household_id` on the payload was trusted.

### Soft-delete tombstones

A `delete` op sets `deleted_at = now()` server-side (and the equivalent locally) rather
than removing the row — every synced table carries `deleted_at`. This makes deletes
ordinary, idempotent, replicable ops (a second delete of an already-deleted row is a
harmless no-op) instead of a special case that has to race against concurrent
pulls/restores of the same row.

### Increment ops + floor_zero clamp, cursor-in-transaction (§6.8)

`increment` payload is `{field, delta, clamp: 'none' | 'floor_zero'}`; both server
(`private.apply_one_op`'s `greatest(0, …)` branch) and local `createSyncedRepo` apply the
identical clamp semantics, so a household's spend/balance arithmetic can never go
negative from a concurrent double-decrement regardless of which side applies it first.
Symmetrically, the puller commits `sync_cursor` advancement in the **same local SQLite
transaction** as the batch of remote ops it just applied — a crash or throw between
"apply the batch" and "advance the cursor" is impossible; either both happen or neither
does, so a retry after a crash re-pulls the same ops rather than skipping them.

### DLQ + poison-batch handling (§6.10)

A permanently-rejected op (a real constraint violation, not a transient network error)
is dead-lettered locally, surfaced in the Settings DLQ inbox for the user to retry or
discard. Discarding fetches the row's current server truth via `sync_row_state` and
applies it locally, so a discarded write can never leave that row silently diverged from
the server forever. Because apply is per-op-savepoint (§6.3 above), one dead-lettered op
never blocks the rest of the batch or subsequent batches from that device — there is no
"poison batch," only a poison op.

### Realtime as a nudge, never a trigger (§6.7)

The server `oplog` table has an RLS `SELECT` policy
(`private.is_household_member(household_id)`) and is published via
`supabase_realtime`, so household members can subscribe to `postgres_changes` INSERTs on
their household's oplog rows. `SyncScheduler` treats this subscription purely as a
**nudge** that calls the same debounced `requestSync` as every other trigger
(after-write, `AppState` foreground, `NetInfo` reconnect) — never as the sole trigger.
Subscribe failure, `CLOSE`, or `TIMED_OUT` on the realtime channel is logged and
continues; the other three triggers already guarantee eventual sync with or without
realtime, so losing the nudge is a latency regression, never a correctness one.

### Compaction/retention — explicitly deferred (§6.5)

Pre-launch, a fresh install replays the **full** op history from `seq 0` via `sync_pull`
as its restore mechanism — no snapshotting. This is accepted as fine at today's data
volumes. Snapshot-plus-tail compaction, and whether the oplog is allowed to lose rows at
all given it now doubles as the audit trail (see the per-user-tables note below), is an
explicit **open decision, deferred, not designed**. Revisit trigger: **~50,000 ops for a
single household** (spec §6.5) — whichever household hits it first forces the decision;
there is no calendar-based revisit date. Large payloads (e.g. slip-scan
`raw_response_json`) are kept out of op payloads entirely (ops reference storage
objects) specifically so this deferral doesn't compound with unbounded payload growth.

### Per-user tables stay outside the household oplog

`user_preferences`, `user_consent`, `user_fcm_tokens` have no `household_id` and are
deliberately **not** part of the oplog protocol — they keep direct RLS-scoped DML
(`user_id = (select auth.uid())`) as a documented exception to "the oplog RPCs are the
only write path." `user_consent`'s local write goes through `runInUnitOfWork` directly
(append an oplog row with `household_id: null`, which `sync_push`/`apply_one_op` support
for exactly this case) rather than `createSyncedRepo`, since that helper assumes a
`household_id` column distinct from `id`.

### Remote deployment — DONE (2026-07-04), edge functions caught up in slice 6

**Update (slice 6):** the remote-deployment prerequisite below is resolved. On
2026-07-04, with explicit owner authorization, the linked production Supabase project
(`qmfsobqpnogefvzltwyj`) was backed up (schema + data + roles, to
`scratchpad/remote-backup-20260704` — the remote held 0 household data and a handful of
test `auth.users` rows, so this was a safe cutover) and then dump-and-recreated via
`supabase db reset --linked` applying `0001_baseline.sql`. Verified post-deploy:
`sync_push`/`sync_pull`/`sync_row_state`/`apply_server_op` present and granted, the oplog
table + RLS + realtime publication, 21 policies, the slip storage bucket, and every old
`merge_*` RPC gone. `SyncEngine` round-trips against the real remote as of the 2026-07-04
cutover (app already DELIVERED + on Play via slices 1–5).

The cutover did have one fallout, closed in slice 6: **edge functions were not
redeployed as part of the baseline swap**, so `extract-slip`'s household-membership
check — which read the now-dropped `user_households` table — started failing 100% of
the time against the new remote. Slice 6 task 1 re-pointed it to a `household_members`
query and redeployed it; slip scanning's server side works again. Its direct `.update()`
calls on `slip_queue` still bypass `apply_server_op` (spec §6.2) — that routing is a
larger refactor, tracked as an open follow-up, not done in slice 6.
`notify-event` was separately broken (legacy FCM API shutdown, unrelated to this
migration) and rebuilt onto FCM HTTP v1 in slice 6 task 5 — see the `is_paid_off`
paragraph below for the one place the non-atomic-batch consequence bit a payment path;
push delivery-priority hints (`android.priority: 'high'`, `apns-priority: '10'`) were
added in slice 6 task 6 so notifications aren't OS-deprioritized once the owner sets the
`FCM_SERVICE_ACCOUNT` secret.

### Original remote-deployment prerequisite (historical — resolved above)

_(Recorded at the time this ADR was first written, slice 5 task 6; kept for the
historical record since the spec explicitly calls for durable decision trails. See the
"Update" note above for current reality.)_

The oplog protocol described in this ADR existed in `supabase/migrations/0001_baseline.sql`
and this repo's local test suite (real Postgres via the local Supabase Docker stack), but
had not yet been deployed to the linked production Supabase project. The previously
deployed remote still ran the OLD `merge_*`-RPC schema. Deploying a destructive baseline
squash to a real project was flagged as a production action requiring explicit human
approval before being run.

## Status

**Accepted, and now live in production.** The protocol is fully implemented and tested
locally (`SyncEngine`, `SyncScheduler`, the two-device convergence harness, and the local
Supabase/pgTAP suite) **and** deployed to the linked remote Supabase project as of
2026-07-04 (see above) — `SyncEngine` round-trips against production, not just the local
stack.

## Consequences

- **Positive:** ten `merge_*` RPCs collapse to four generic ones; conflict resolution is
  server-seq order, not client clocks — the three-timestamp-format class of bug in the
  deep review structurally cannot recur. Soft-delete tombstones make deletes an ordinary
  idempotent op instead of a special case. The oplog doubles as an actor-aware audit
  trail (no separate, drift-prone audit table to keep in sync).
- **Positive:** `SyncOrchestrator`, `PendingSyncEnqueuer`, `PendingSyncEnqueuerAdapter`,
  `PendingSyncTable`, and the local `pending_sync` table are deleted in this task (slice 5
  task 6) — see `.superpowers/sdd/task-6-report.md` for the full deletion/survival
  breakdown. `RestoreService` and `rowConverters` are **kept**: `RestoreService` still
  drives first-install/reinstall household **discovery** (Supabase doesn't yet expose a
  "list my households" pull; `sync_pull` needs a `household_id` the client doesn't have
  yet on a bare reinstall), invoked as a non-blocking background task from `App.tsx`
  (never gating first paint). This is a real, tracked follow-up: fold discovery into a
  `SyncEngine`-native pull once that RPC exists, then retire `RestoreService` for real.
- **Negative / cost:** the non-atomic per-op-savepoint batch (§6.3) means a multi-op
  logical write can be observed torn if interrupted mid-batch. This bit the debt-payment
  write path concretely: `LogDebtPaymentUseCase` used to push a third, independent
  `update` op carrying a client-computed `is_paid_off` alongside the two `increment` ops
  — a transient rejection of the balance-decrement op while the `is_paid_off` op still
  applied could show "paid off" against a nonzero remote balance until DLQ retry. Fixed
  in this task by deriving `is_paid_off` server-side (`BEFORE INSERT OR UPDATE` trigger on
  `public.debts`, baseline §9g) instead of trusting a client-computed value — the client
  no longer sends that field at all. See `.superpowers/sdd/task-6-report.md` for the full
  decision trace.
- **Negative / cost:** compaction is deferred, not solved (§6.5 above) — a household
  approaching ~50k ops needs this ADR revisited before it becomes a real pull-latency or
  storage problem.
- **Resolved (was Negative / cost):** the remote deployment gap noted when this ADR was
  first written is closed — see the "Remote deployment — DONE" section above. The app has
  been live for real users on the Play internal track since slices 1–5 shipped; the oplog
  protocol has round-tripped against the production remote since the 2026-07-04 cutover.
- **Tests / verification:** `npx jest --selectProjects app` (unit/integration tier,
  `SyncEngine.test.ts`/`SyncScheduler.test.ts` and friends), `npm run test:realsql`
  (real better-sqlite3 against the actual migration chain — proves local schema/trigger
  behavior, e.g. `tests/realsql/debtPayment.test.ts`'s oplog-shape assertions and
  `tests/realsql/migrations.test.ts`'s 0014 drop), `npx jest --selectProjects twodevice`
  (the two-device convergence property harness against a live local Postgres — proves
  §6.1/§6.3/§6.11 end-to-end: no lost writes, increments sum correctly, deletes
  propagate, resends are idempotent), and `supabase test db` (pgTAP against the local
  Supabase stack — RLS/membership/column-allowlist behavior). All four must be green
  before this ADR's protocol is considered verified for the LOCAL/test environment; none
  of them exercise the actual production remote (see the deployment prerequisite above).
