# Oplog Sync & Correctness Rebuild — Design

**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan
**Source:** [docs/200x-game-plan.md](../../200x-game-plan.md) Phases 0+1, merged; findings in [docs/reviews/2026-07-02-deep-review-findings.md](../../reviews/2026-07-02-deep-review-findings.md)

## Decisions log

| Decision          | Choice                                                                              | Rationale                                                        |
| ----------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Production status | Not launched, no data to protect                                                    | Destructive schema changes and migration squashes are allowed    |
| Scope             | Game-plan Phases 0+1 merged into one "make it correct" effort                       | No live users → building band-aids then replacing them is waste  |
| Sync scope        | Full sync v2 including Realtime household channels and DLQ inbox UI                 | User choice                                                      |
| Test bar          | Full proving ground (4 real-engine test tiers)                                      | Half the reviewed bugs shipped because no test executes real SQL |
| Architecture      | **Approach C: server-sequenced oplog protocol** (replaces per-table LWW merge RPCs) | User choice; pre-launch is the only cheap time to do it          |

## 1. Architecture: the oplog sync protocol

Mutations become facts in an append-only log; sync becomes log replication.

### Local (SQLite)

- Every domain mutation writes the entity table **and** appends an op to a local `oplog` table in the same SQLite transaction. This subsumes three reviewed bug classes: non-atomic write/audit/enqueue, the lost-edit race (ops are immutable — a new edit is a new op), and missed enqueues (append happens inside the repository write itself).
- Op shape: `{op_id (uuid), household_id, table, row_id, op_type: insert|update|delete|increment, payload (changed fields only, or delta for increment), actor_user_id, device_id, client_created_at}`.
- Deletes are ops → tombstone behavior falls out naturally; local rows get `deleted_at` for instant undo.

### Server (Supabase)

- `sync_push(p_ops jsonb)` — one SECURITY DEFINER RPC replacing all ten `merge_*` functions. Validates household membership once per batch, applies each op to canonical tables (field-level updates; arithmetic for `increment` ops so concurrent household spends cannot clobber each other), records each op in a server `oplog` table with a per-household monotonic `seq` (bigserial). `op_id` is unique → retries idempotent by construction.
- `sync_pull(p_household_id, p_after_seq, p_limit)` — returns ops after the client's cursor, paginated. **Replaces RestoreService entirely**: fresh install = pull from seq 0; steady-state = pull from cursor. Eliminates the 1000-row restore truncation and restore-clobbers-dirty-rows (unpushed local ops simply replay on top).
- No client clocks in conflict resolution: server sequence order is the resolution order. The three-timestamp-format LWW class of bugs ceases to exist.

### Client sync engine

- **Pusher**: drains unpushed local ops in order, batched; sync-on-write (debounced), AppState foreground trigger, drain-until-empty; reuses the existing capped-exponential-backoff machinery.
- **Puller**: per-household cursor; triggered by the same events plus a Supabase Realtime subscription on the household's oplog as a "new seq" nudge (never the sole trigger); applies remote ops locally, skipping own `device_id` ops.
- **DLQ inbox** in Settings for permanently rejected ops (retry/discard).

### Data-model change riding along

`envelopes.spent_cents` is deleted from both schemas. Balances are a per-period `SUM(transactions)` read model, making the stale-sync / double-delete / double-confirm corruption class structurally impossible.

## 2. Schema baselines & fate of existing machinery

### Local SQLite: one baseline migration (replaces 0001–0010)

- All entity tables, minus `envelopes.spent_cents`, plus `deleted_at` on every user-data table.
- `oplog` table: `(op_id PK, seq_local autoincrement, household_id, table_name, row_id, op_type, payload JSON, actor_user_id, device_id, client_created_at, pushed_at NULL, retry_count, next_attempt_at, dead_lettered_at)`, indexed `(pushed_at, next_attempt_at)`. Replaces `pending_sync` — the outbox is the unpushed tail of the log.
- `sync_cursor` table: `(household_id, last_pulled_seq)`.
- FK constraints with explicit `ON DELETE` + `PRAGMA foreign_keys=ON`; CHECK constraints mirroring Postgres (non-negative cents, enum values); `journal_mode=WAL`; `busy_timeout`.
- `audit_events` deleted: the oplog is the audit trail, actor-aware (fixes "audit records no actor"). The future household activity feed reads the oplog.
- `score_history` table included now (written at rollover) so gamification revival needs no schema change later.

### Supabase: one baseline migration (replaces 001–019)

- Entity tables with `timestamptz` throughout and `deleted_at`; server `oplog` with `seq bigserial`, unique `op_id`, index `(household_id, seq)`.
- RLS rebuilt once, correctly: `(select auth.uid())` pattern, `TO authenticated` on every policy, one `private.is_household_member(hid)` SECURITY DEFINER helper (pinned `search_path`) reading `household_members` directly. The `user_households` mirror table and its INSERT-only trigger are deleted — structurally fixing "removed member keeps access forever".
- RPCs: `sync_push`, `sync_pull`, `create_invitation` (server-generates the code; fixes the revoked-INSERT breakage), `join_household_via_invite` (signature verified against client call sites by a contract test), plus surviving slip machinery (`check_and_reserve_slip_slot`, cleanup cron).
- Direct DML on all synced tables stays revoked; the oplog RPCs are the only write path (preserves defense-in-depth).

### Deleted machinery

`RestoreService`, `PendingSyncEnqueuer`, `PendingSyncTable`, `SyncOrchestrator` per-table routing, all `merge_*` RPCs, `delete_sync_row`, `rowConverters` (payloads written snake_case once at the boundary), `user_households`, `audit_events` + `AuditLogger`, dead dashboard/shared components identified in the review.

### Surviving machinery

Backoff/DLQ retry logic (ported into the pusher), invite-code crypto, the slip-scanning hexagon and `extract-slip` edge function, all domain calculators and their tests, Drizzle schema style, migration-checksum boot guard, early-crash observability stack.

## 3. Domain layer

### UnitOfWork + real ports

- Domain use cases depend on repository ports (`IEnvelopeRepository`, `ITransactionRepository`, …) plus `IClock`/`IIdGenerator`, wired in a composition root in `src/application/`.
- One schema-driven factory `createSyncedRepo(table)` derives find/insert/update/softDelete/increment; write methods automatically append the matching op inside the same SQLite transaction. Writes and ops are the same call — an op cannot be forgotten.
- Every port ships an in-memory implementation for use-case tests (no more hand-mocked Drizzle chains).
- dependency-cruiser rule fails CI on `domain → data/infrastructure` imports.

### Derived balances

`spentCents` becomes a read model: SQL view summing non-deleted transactions — per `(envelope_id, period)` for period-scoped envelopes, all-time per envelope for persistent ones. `EnvelopeEntity` helpers unchanged; they receive a computed value.

### Envelope scopes

- `scope: 'period'` (spending, income, utility): period-keyed as today.
- `scope: 'persistent'` (sinking_fund, emergency_fund, savings): no period; balance derived from the envelope's all-time transaction ledger. Sinking-fund progress stops vanishing monthly; Baby Steps 1/3 reconcile against the persistent EMF — the monthly regression becomes impossible.

### Rollover engine

`StartNewPeriodUseCase`: when `BudgetPeriodEngine.isNewPeriodWithin` fires, copy forward last period's period-scoped envelopes (allocations copied; spent derives to zero), driven by a 3-step wizard (review last period → adjust allocations → commit) replacing the lying `PeriodRolloverModal`. Idempotent per period. Runs as ordinary oplog'd writes, so it syncs.

### Atomic money fixes

- Debt payment: one SQL `UPDATE ... SET balance = MAX(0, balance - :amt), total_paid = total_paid + :applied`, emitted as an `increment` op.
- Transaction delete: fetch-then-soft-delete inside the transaction; envelope balance self-corrects via the view.
- Slip confirm: status guard + op-level idempotency; empty item lists rejected.
- Snowball ordering defaults to smallest-balance-first (tie-break: higher interest rate).

### Domain events

Use cases emit typed events (`PeriodRolled`, `DebtPaidOff`, `EnvelopeOverspent`, `BabyStepCompleted`) through a publisher port; notifications, score, and celebrations subscribe.

## 4. Client sync engine & one-off fixes

### SyncEngine (replaces SyncOrchestrator + RestoreService + NetworkObserver wiring)

- **Pusher**: drains unpushed ops in `seq_local` order, ~50 ops per `sync_push` batch. Error classification: permanent rejections (validation/authz) dead-letter immediately with a user notification; transient failures retry forever with capped backoff. The 7-day age discard is removed.
- **Puller**: loops `sync_pull` until a short page; applies each batch in one local transaction; fires a table-invalidation event consumed by live queries (no more manual `reload()`).
- **Triggers**: debounced after-write (~300 ms), AppState foreground, NetInfo reconnect, Realtime nudge. Single-flight guard retained.
- **Visible state**: engine publishes to `syncStore`; Settings gains a sync-status row (last synced, pending count, manual sync) and the DLQ inbox.
- **Boot**: `expo-splash-screen` through local init only; first paint gates on SQLite, never network; engine starts after navigator mounts; auth listener filters to `SIGNED_IN`; household switch re-points the puller (cursor 0 if new) with progress UI.

### One-off fixes in scope (each with a test)

1. Invites: baseline RPCs + SQL-signature contract test; ShareInvite stops burning a code per mount.
2. Money input: one shared locale-safe parser rejecting ambiguous input (`1,234.56`, `1 000`) with inline errors; used by AddTransaction, AddReading, AddDebt, AddEditEnvelope.
3. Push: `notify-event` rebuilt on FCM HTTP v1 (service-account OAuth in Deno); token table keyed `(user_id, token)`; token deleted + rotated on sign-out.
4. Password reset: `resetPasswordForEmail` + deep-linked ResetPassword screen.
5. Slip flow: camera FAB on SlipQueue; SlipConfirm loads persisted extraction when the param is missing; completed slips open read-only.
6. Envelope type selector gains missing types (sinking fund / emergency fund render as preselected chip).
7. Dashboard score inputs: real period length and meter flag replace hardcoded `30`/`false`.

## 5. Proving ground, build order, risks

### Test tiers (all real engines)

1. **Real-SQLite tier**: Jest on better-sqlite3; applies the baseline migration; repository/UnitOfWork/rollover/derived-view tests against real SQL; fast-check property tests for money invariants (no op sequence creates or destroys cents; rollover conserves allocations; op replay idempotent).
2. **Real-Postgres tier**: CI runs `supabase start` + `db reset` per PR; pgTAP adversarial RLS suite (two users, two households, every table, anon + cross-household CRUD); RPC signature contract tests.
3. **Two-device simulation harness**: two in-memory SQLite "devices" running the real SyncEngine against local Supabase; property-based interleavings (write/edit/delete/offline/sync/switch) asserting convergence, no data loss, cent conservation. **Gate: no UI work sits on the sync protocol until this harness is green.**
4. **Authenticated e2e**: Detox against local Supabase — sign up → onboard → envelope → transaction → rollover, plus a two-account invite round-trip. CD publishes only after the full train (fix `branches: ['*']` glob; CD hard-depends on e2e).

### Build order — six independently-green slices

1. Proving-ground scaffolding (tiers 1–2 in CI)
2. Schema baselines, both sides, + contract tests
3. UnitOfWork, repo factory, ports, derived balances, envelope scopes — domain rewired
4. Rollover engine + wizard
5. SyncEngine + Realtime + DLQ inbox + boot rework — gated on the two-device harness
6. One-off fixes batch + deletion of dead machinery + ADR documenting the protocol contract

### Risks & mitigations

- **Novel protocol** → the two-device property harness lands before any UI depends on the engine (slice 1 → 5 ordering).
- **Realtime reliability** → treated as an optional nudge; pull triggers are the guarantee.
- **Derived-balance query performance** → measured in the real-SQLite tier against a seeded 10k-transaction ledger before committing to the view shape; indexes chosen from the measurement.
- **Scope creep** → each slice is shippable; if priorities shift, stop at any slice boundary with a green build.

### Out of scope (later phases)

Dashboard v2 / gamification / streaks / celebrations (Phase 2), household roles & activity feed & realtime-collaboration UX beyond data sync (Phase 3), monetization, on-device AI, meter OCR, EAS Update/MMKV/FlashList platform modernization (Phase 2 — except where a slice touches the same code anyway).
