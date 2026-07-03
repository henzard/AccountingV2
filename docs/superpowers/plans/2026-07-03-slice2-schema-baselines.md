# Slice 2: Schema Baselines + Oplog Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the drifted 22-migration Supabase chain and 11-migration local chain with clean baselines, and land the server half of the oplog sync protocol (spec §1, §6, §7) — proven by the slice-1 testing tiers.

**Architecture:** One squashed baseline migration per side, derived from the live schema (the proving ground guards equivalence), plus NEW objects: server `oplog` + `sync_push`/`sync_pull`/`sync_row_state`/`apply_server_op`, `private.is_household_member`, rebuilt RLS/grants, rebuilt invite RPCs, `job_log`, `score_history`, local `oplog`/`sync_cursor`. Spec: `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md` (§1, §2, §6, §7 bind this slice).

**Tech Stack:** Supabase (Postgres 17, pgTAP), Drizzle + expo-sqlite, better-sqlite3 test tier.

## Global Constraints

- TypeScript strict; `npx tsc --noEmit`, `npx eslint src/ --max-warnings 0` green; app Jest project green with coverage thresholds 80/60; `npm run test:realsql` green; `supabase db reset` + `supabase test db` green. ALL must pass at the end of EVERY task.
- Spec §6 and §7 are binding: canonical wire op `{v:1, op_id, household_id, table, row_id, op_type, payload, actor_user_id, device_id, client_created_at}`; per-household advisory lock in EVERY oplog writer; per-op savepoints, response `[{op_id, status:'applied'|'rejected', code}]`; duplicate `op_id` → `'applied'`; payload column allowlist; `sync_pull` max `p_limit` 500; server `oplog` RLS SELECT for household members, all DML revoked.
- **Staged-scope note (refines spec §2):** `spent_cents`, `is_synced`, local `audit_events` are KEPT in this slice — their readers are rewired in slice 3 which also drops them. The 10 `merge_*` RPCs, `delete_sync_row`, `claim_invite`, `lookup_invite_by_code`, `user_households` + its trigger ARE deleted here: remote sync is intentionally dark in dev builds until slice 5 (all CI suites are hermetic and stay green).
- Timestamps on the server: `timestamptz` everywhere in the new baseline; columns that clients still write as ISO TEXT keep accepting ISO-8601 strings (Postgres casts them).
- The app is NOT launched. The linked remote project is NOT touched — local + CI only (`supabase db reset` is always local).
- Every SQL object the plan deletes must appear in a `DROP ... IF EXISTS` block of the baseline so a re-run over an old local DB converges.

---

### Task 1: Server baseline — squash 001–022 into one migration

**Files:**

- Create: `supabase/migrations_new/0001_baseline.sql` (working name; directory swap happens in Step 5)
- Delete: `supabase/migrations/001...022_*.sql` (all 22, at Step 5)
- Test: existing `supabase/tests/rls_cross_household.test.sql` must still pass

**Interfaces:**

- Produces: a single `0001_baseline.sql` containing: all 15 public tables (DDL as they exist in the live local DB after 022 — dump them, do not hand-transcribe), with `updated_at`/`created_at` converted to `timestamptz` and `deleted_at timestamptz` added to the 8 household-scoped entity tables; the 4 surviving functions (`check_and_reserve_slip_slot`, `check_and_reserve_notify_send`, `cleanup_old_slip_images`, `validate_slip_path`); the slip-images storage policies and pg_cron schedule from 006/007/015; NEW tables `job_log (id bigserial PK, job text, detail jsonb, created_at timestamptz default now())` and `score_history (id text PK, household_id text references households(id), period_start text not null, score int not null, components jsonb, created_at timestamptz default now())`.
- Explicitly ABSENT (with `DROP IF EXISTS` guards at the top): all `merge_*` functions, `delete_sync_row`, `claim_invite`, `lookup_invite_by_code`, `sync_household_member_to_user_households` + trigger, `user_households` table. `cleanup_old_slip_images` is re-pointed: its failure-audit INSERTs write to `job_log` instead of `audit_events` (server `audit_events` table is dropped — nothing else reads it server-side; the LOCAL audit_events table stays until slice 3).
- RLS/policies/grants are NOT in this file — Task 2 owns them (baseline enables RLS on every table but declares no policies, so Task 1 alone leaves the DB locked-down-not-broken).

- [ ] **Step 1: Dump the live schema as the squash source**

```bash
supabase db reset
docker exec supabase_db_AccountingV2 pg_dump -U postgres -d postgres --schema-only --schema=public --no-owner --no-privileges > /tmp/live_schema.sql
```

Use `/tmp/live_schema.sql` as the authoritative DDL for the 15 tables + 4 surviving functions. Do not copy policies/grants/deleted functions from it.

- [ ] **Step 2: Author `0001_baseline.sql`** with the structure: (1) DROP-guards block; (2) tables (timestamptz conversion: every `created_at`/`updated_at`/`joined_at`/`*_at` TEXT column becomes `timestamptz`; add `deleted_at timestamptz` to households, household_members, envelopes, transactions, debts, meter_readings, baby_steps, slip_queue); (3) surviving functions verbatim from the dump except `cleanup_old_slip_images`'s audit INSERT → `INSERT INTO job_log(job, detail) VALUES ('cleanup_old_slip_images', jsonb_build_object(...))`; (4) new tables; (5) `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for every table; (6) storage bucket/policies + cron schedule.

- [ ] **Step 3: Stage the swap** — move the 22 old files out, move `0001_baseline.sql` in, `supabase db reset`. Expected: clean finish.

- [ ] **Step 4: Temporarily skip the pgTAP suite** (it needs Task 2's policies): confirm `supabase test db` fails ONLY on missing policies (permission/zero-row differences), not on schema errors.

- [ ] **Step 5: Commit** (old migrations deleted + baseline added). Do NOT push until Task 2 restores the pgTAP suite to green.

---

### Task 2: `private.is_household_member` + RLS/grants rebuild

**Files:**

- Modify: `supabase/migrations/0001_baseline.sql` (extend — the baseline is still unreleased, one file stays the whole truth)
- Test: `supabase/tests/rls_cross_household.test.sql` (must pass again), extended per Step 3

**Interfaces:**

- Produces: `private.is_household_member(hid text) returns boolean` — `STABLE SECURITY DEFINER SET search_path = ''`, body: `select exists (select 1 from public.household_members m where m.household_id = hid and m.user_id = (select auth.uid())::text and m.deleted_at is null)`. Schema `private` is NOT exposed via PostgREST.
- Every household-scoped table gets 1 SELECT policy: `create policy <t>_select on public.<t> for select to authenticated using (private.is_household_member(household_id));` (households uses `private.is_household_member(id)`). Per-user tables (`user_preferences`, `user_fcm_tokens`, `user_consent`) get `user_id = (select auth.uid())::text` policies (SELECT for all three; INSERT/UPDATE for user_preferences; INSERT/UPDATE/DELETE for user_fcm_tokens — spec §8). `invitations`: SELECT for household members. No INSERT/UPDATE/DELETE policies on synced tables — writes go through RPCs only.
- Grants: SELECT to `authenticated, anon` on all client-read tables (mirroring slice-1's 022); per-user DML grants as above; ALL to `service_role`; `job_log`/`notify_send_log` service_role-only.
- pgTAP green again: 4/4 existing probes.

Steps: (1) extend baseline with `create schema if not exists private;` + helper + policies + grants; (2) `supabase db reset && supabase test db` → 4/4; (3) add two new pgTAP probes — member of A cannot SELECT B's `transactions` and `debts` (seed one row each); (4) commit.

---

### Task 3: Server `oplog` + `sync_push`/`sync_pull`/`sync_row_state`/`apply_server_op`

**Files:**

- Modify: `supabase/migrations/0001_baseline.sql` (extend)
- Create: `supabase/tests/oplog_protocol.test.sql` (the contract — written FIRST, drives the implementation)

**Interfaces (binding, spec §6/§7):**

- `oplog (seq bigserial, op_id uuid PK, household_id text not null references households(id), table_name text not null, row_id text not null, op_type text not null check (op_type in ('insert','update','delete','increment')), payload jsonb, actor_user_id uuid, device_id text not null, client_created_at timestamptz, applied_at timestamptz default now())`, index `(household_id, seq)`, RLS SELECT via `is_household_member`, in `supabase_realtime` publication, all DML revoked (RPC-only).
- `sync_push(p_ops jsonb) returns jsonb` — SECURITY DEFINER, `SET search_path=''`. Semantics: group ops by household preserving order → per group: membership check (whole group rejected `code='not_member'` if false), `pg_advisory_xact_lock(hashtextextended(household_id, 0))` → per op in order, inside a savepoint: reject unknown `v`≠1/table/op_type (`code='unsupported'`); `insert into oplog ... on conflict (op_id) do nothing` — conflict → `status='applied'` (duplicate-ack §6.11) and skip apply; validate payload keys against the per-table allowlist (all columns minus `id,household_id` and server-managed fields; violation → `code='forbidden_column'`); target-row household check for update/delete/increment (`code='wrong_household'`); apply: insert (row exists with same id → treat as applied no-op, §6.6), update (jsonb fields → columns), delete (`set deleted_at = now()` — soft), increment (`payload {field, delta, clamp}`; `clamp='floor_zero'` → `greatest(0, col + delta)`); any error → rollback savepoint, remove the oplog row, `status='rejected'` with SQLSTATE as code. Returns array of `{op_id, status, code}` in input order.
- `sync_pull(p_household_id text, p_after_seq bigint, p_limit int default 200) returns setof oplog` — SECURITY INVOKER is fine (RLS covers it) but must cap `p_limit` at 500 and order by seq.
- `sync_row_state(p_household_id text, p_table text, p_row_id text) returns jsonb` — membership-checked, table-allowlisted, returns `to_jsonb(row)` or null.
- `apply_server_op(...)` — helper for edge functions/crons: takes the same op fields, takes the SAME advisory lock, applies + records exactly like one sync_push op (shared implementation — extract a common `private.apply_one_op(...)`). `extract-slip`'s direct `.update()` calls are NOT rewired in this slice (slice 6 owns the function edit); the helper just must exist and be proven.
- Table allowlist for ops: households, household_members, envelopes, transactions, debts, meter_readings, baby_steps, slip_queue.

- [ ] **Step 1: Write `supabase/tests/oplog_protocol.test.sql` FIRST** — pgTAP, seeding one household/user like the existing suite, covering at minimum: (1) push insert → row in entity table + oplog seq assigned; (2) duplicate op_id resend → `applied`, no double row; (3) push for a household the caller isn't a member of → `rejected/not_member`; (4) update with `household_id` in payload → `rejected/forbidden_column`; (5) update targeting another household's row_id → `rejected/wrong_household`; (6) delete → `deleted_at` set, row still present; (7) increment with floor_zero clamps at 0; (8) one bad op in a batch of 3 → the other 2 applied; (9) sync_pull returns ops after cursor in seq order and respects the 500 cap; (10) sync_row_state returns the row for members, null-or-error for non-members; (11) insert whose row already exists with same id → `applied` no-op; (12) two sequential pushes get monotonically increasing seq. Run `supabase test db`: all of these FAIL (functions don't exist).

- [ ] **Step 2: Implement in the baseline** until `supabase test db` is fully green (existing 6 RLS probes + the new protocol file).

- [ ] **Step 3: Commit.**

---

### Task 4: Rebuilt invite RPCs + client call-site alignment + RPC signature contract test

**Files:**

- Modify: `supabase/migrations/0001_baseline.sql` (add `create_invitation`, rebuilt `join_household_via_invite`)
- Modify: `src/domain/households/CreateInviteUseCase.ts` (call the RPC instead of direct INSERT)
- Modify: `src/domain/households/AcceptInviteUseCase.ts` (param `p_invite_code`; remove the RestoreService coupling ONLY if trivially separable — otherwise leave restore wiring for slice 3 and just fix the RPC name/param)
- Create: `tests/realsql/rpcContract.test.ts`
- Test: pgTAP additions in `supabase/tests/invites.test.sql`

**Interfaces:**

- `create_invitation(p_household_id text) returns jsonb` — SECURITY DEFINER; verifies caller is an OWNER member; generates the 6-char code server-side reusing the unbiased-alphabet logic from `CreateInviteUseCase` (32-char alphabet, no 0/O/1/I); inserts with 48h expiry; returns `{id, code, expires_at}`.
- `join_household_via_invite(p_invite_code text)` — same contract as the 019 version (validate/consume invite, insert membership) but against the new baseline.
- `tests/realsql/rpcContract.test.ts`: parses `supabase/migrations/*.sql` for `CREATE OR REPLACE FUNCTION public.<name>(<args>)` signatures, greps `src/` for `rpc('<name>', {...})` call sites, and asserts every named argument at every call site matches a `p_`-prefixed parameter of the SQL signature. This is the drift gate that would have caught the invite bug.
- pgTAP: owner can create an invitation; non-owner cannot; second user joins via the code and becomes a member; expired/consumed codes rejected.

Steps: TDD — pgTAP + contract test first (both fail), implement SQL + client edits, all suites green (`test:realsql`, app jest, `supabase test db`, tsc, eslint), commit.

---

### Task 5: Local SQLite additions — `oplog`, `sync_cursor`, `score_history` (migration 0011) + Drizzle schema

**Files:**

- Create: `src/data/local/migrations/0011_oplog_foundations.sql` (+ journal entry idx 11, + `migrations.js` import — same mechanics as slice 1's 0010)
- Create: `src/data/local/schema/oplog.ts`, `src/data/local/schema/syncCursor.ts`, `src/data/local/schema/scoreHistory.ts`; modify `src/data/local/schema/index.ts` (export them)
- Test: realsql conformance test covers the new tables automatically; add `tests/realsql/oplog.test.ts` asserting the outbox index exists (`PRAGMA index_list(oplog)`) and inserts round-trip

**Interfaces (spec §2):**

- `oplog`: `op_id text PK, seq_local integer autoincrement-unique, household_id text, table_name text, row_id text, op_type text, payload text (JSON), actor_user_id text, device_id text, client_created_at text, pushed_at text, retry_count integer default 0, next_attempt_at text, dead_lettered_at text` + index on `(pushed_at, next_attempt_at)`.
- `sync_cursor`: `household_id text PK, last_pulled_seq integer not null default 0`.
- `score_history`: `id text PK, household_id text, period_start text, score integer, components text (JSON), created_at text`.
- NOTE: SQLite autoincrement requires `INTEGER PRIMARY KEY AUTOINCREMENT`; since `op_id` is the PK, model `seq_local` as `integer` with a unique index and use `rowid` ordering — document the choice in the schema file. The LOCAL local-chain squash (spec §2's "one baseline migration") is DEFERRED to slice 3 alongside the column drops; this task only adds.

Steps: TDD — write `oplog.test.ts` + run conformance (fails: tables missing) → migration + schema files → `npm run test:realsql` green → tsc/eslint/app-jest green → commit.

---

### Task 6: Final verification + docs

- [ ] Full local gate: `npm run test:realsql && npx jest --selectProjects app --coverage --silent && npx tsc --noEmit && npx eslint src/ --ext .ts,.tsx --max-warnings 0 && supabase db reset && supabase test db` — all green.
- [ ] Update `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md` §2 with a short "as-built" note: staged scope (kept columns/tables until slice 3), and the two-directory swap outcome.
- [ ] Append delivery entry to `docs/plan-execution-status.md` (create if absent: phase graph + per-slice state).
- [ ] Commit; PR per the phase pipeline.

## Done means

- One server baseline migration replaces 22; `supabase db reset` + full pgTAP (RLS + oplog protocol + invites) green locally and in CI.
- The oplog protocol RPCs exist and are proven by the behavior suite (12+ probes).
- Invite create + accept work end-to-end against local Supabase (the two criticals from the deep review are dead).
- RPC-signature contract test guards client↔SQL drift.
- Local oplog/sync_cursor/score_history exist with Drizzle schemas; realsql green.
- App suite/tsc/eslint untouched-green; remote sync documented as dark until slice 5.
