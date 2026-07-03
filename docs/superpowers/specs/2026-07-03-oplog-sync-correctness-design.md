# Oplog Sync & Correctness Rebuild — Design

**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan
**Source:** [docs/200x-game-plan.md](../../200x-game-plan.md) Phases 0+1, merged; findings in [docs/reviews/2026-07-02-deep-review-findings.md](../../reviews/2026-07-02-deep-review-findings.md)

## Decisions log

| Decision          | Choice                                                                                                    | Rationale                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Production status | Not launched, no data to protect                                                                          | Destructive schema changes and migration squashes are allowed    |
| Scope             | Game-plan Phases 0+1 merged into one "make it correct" effort                                             | No live users → building band-aids then replacing them is waste  |
| Sync scope        | Full sync v2 including Realtime household channels and DLQ inbox UI                                       | User choice                                                      |
| Test bar          | Full proving ground (4 real-engine test tiers)                                                            | Half the reviewed bugs shipped because no test executes real SQL |
| Architecture      | **Approach C: server-sequenced oplog protocol** (replaces per-table LWW merge RPCs)                       | User choice; pre-launch is the only cheap time to do it          |
| Engineering bar   | Strict TS, ESLint `--max-warnings 0`, Jest coverage 80/60, local Supabase via Docker for all server tests | Binds ALL six slices, not just slice 1's plan                    |

## 1. Architecture: the oplog sync protocol

Mutations become facts in an append-only log; sync becomes log replication.

### Local (SQLite)

- Every domain mutation writes the entity table **and** appends an op to a local `oplog` table in the same SQLite transaction. This subsumes three reviewed bug classes: non-atomic write/audit/enqueue, the lost-edit race (ops are immutable — a new edit is a new op), and missed enqueues (append happens inside the repository write itself).
- **Canonical wire op** (this is THE op contract; §2's stored rows and §6 both reference it): `{v: 1, op_id (uuid), household_id, table, row_id, op_type: insert|update|delete|increment, payload (changed fields only, or {field, delta, clamp} for increment), actor_user_id (null for system ops), device_id, client_created_at}`. The local oplog stores the wire field `table` in its `table_name` column; no other renames exist.
- Deletes are ops → tombstone behavior falls out naturally; local rows get `deleted_at` for instant undo.

### Server (Supabase)

- `sync_push(p_ops jsonb)` — one SECURITY DEFINER RPC replacing all ten `merge_*` functions. Validates household membership once per household group within the batch (§6.3), applies each op to canonical tables (field-level updates; arithmetic for `increment` ops so concurrent household spends cannot clobber each other), records each op in a server `oplog` table with a per-household monotonic `seq` (bigserial). `op_id` is unique → retries idempotent by construction.
- `sync_pull(p_household_id, p_after_seq, p_limit)` — returns ops after the client's cursor, paginated. **Replaces RestoreService entirely**: fresh install = pull from seq 0; steady-state = pull from cursor. Eliminates the 1000-row restore truncation and restore-clobbers-dirty-rows (unpushed local ops simply replay on top).
- No client clocks in conflict resolution: server sequence order is the resolution order. The three-timestamp-format LWW class of bugs ceases to exist.

### Client sync engine

- **Pusher**: drains unpushed local ops in order, batched, drain-until-empty; reuses the existing capped-exponential-backoff machinery. Trigger list is defined once, in §4 (sync-on-write, AppState foreground, NetInfo reconnect, Realtime nudge).
- **Puller**: per-household cursor; triggered by the same events plus a Supabase Realtime subscription on the household's oplog as a "new seq" nudge (never the sole trigger); applies remote ops locally, skipping own `device_id` ops.
- **DLQ inbox** in Settings for permanently rejected ops (retry/discard).

### Data-model change riding along

`envelopes.spent_cents` is deleted from both schemas. Balances are a per-period `SUM(transactions)` read model, making the stale-sync / double-delete / double-confirm corruption class structurally impossible.

## 2. Schema baselines & fate of existing machinery

### Local SQLite: one baseline migration (replaces journal entries 0000–0010, incl. slice 1's 0010_envelope_targets)

- All entity tables, minus `envelopes.spent_cents`, plus `deleted_at` on every user-data table.
- `oplog` table: `(op_id PK, seq_local autoincrement, household_id, table_name, row_id, op_type, payload JSON, actor_user_id, device_id, client_created_at, pushed_at NULL, retry_count, next_attempt_at, dead_lettered_at)`, indexed `(pushed_at, next_attempt_at)`. Replaces `pending_sync` — the outbox is the unpushed tail of the log. Rows with `pushed_at` set are pruned promptly (on ack or a small retention window): the local oplog is an outbox, not the audit copy — the server log is. Entity tables drop their now-redundant `is_synced` columns.
- `sync_cursor` table: `(household_id, last_pulled_seq)`.
- FK constraints with explicit `ON DELETE` + `PRAGMA foreign_keys=ON`; CHECK constraints mirroring Postgres (non-negative cents, enum values); `journal_mode=WAL`; `busy_timeout`.
- `audit_events` deleted: the oplog is the audit trail, actor-aware (fixes "audit records no actor"). The future household activity feed reads the oplog.
- `score_history` table included now (written at rollover) so gamification revival needs no schema change later.

### Supabase: one baseline migration (replaces the full 001–020 chain as it stands after slice 1's dedupe and trigger fix)

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
- The legacy `baby_step` envelope type (allowed by the current CHECK constraint) is retired in the baseline: existing rows migrate to `emergency_fund` (persistent scope); the type is removed from the enum.

### Rollover engine

`StartNewPeriodUseCase`: when `BudgetPeriodEngine.isNewPeriodWithin` fires, copy forward last period's period-scoped envelopes (allocations copied; spent derives to zero), driven by a 3-step wizard (review last period → adjust allocations → commit) replacing the lying `PeriodRolloverModal`. Idempotent per period. Runs as ordinary oplog'd writes, so it syncs. **Commit shape (binds §6.6):** the wizard emits the UNADJUSTED copy-forward as deterministic-id insert ops, followed by the user's allocation adjustments as separate update ops — so two devices rolling the same period offline produce identical inserts (deduped server-side) while divergent adjustments resolve deterministically by seq order like any other field update; nothing is silently discarded wholesale.

### Atomic money fixes

- Debt payment: one SQL `UPDATE ... SET balance = MAX(0, balance - :amt), total_paid = total_paid + :applied`, emitted as an `increment` op.
- Transaction delete: fetch-then-soft-delete inside the transaction; envelope balance self-corrects via the view.
- Slip confirm: status guard + op-level idempotency; empty item lists rejected.
- Snowball ordering defaults to smallest-balance-first (tie-break: higher interest rate).

### Domain events

Use cases emit typed events (`PeriodRolled`, `DebtPaidOff`, `EnvelopeOverspent`, `BabyStepCompleted`) through a publisher port. This effort ships the publisher and event emission plus re-pointing the EXISTING notification triggers; new subscribers (score progression, celebrations, coaching) attach in Phase 2 and are out of scope here (§5).

### Slice-3 as-built note (2026-07-03)

What actually shipped for this section, task by task (full detail: `.superpowers/sdd/task-{1..6}-report.md`):

- **Derived balances**: `getEnvelopeSpentCents(db, householdId, periodStart)` in
  `src/data/local/balances/EnvelopeBalanceQuery.ts` — a single grouped `SUM` over
  non-deleted transactions, period-aware by scope. Measured 3ms/10k rows against the
  <15ms gate (no trigger-column fallback needed).
- **UnitOfWork + oplog**: `src/data/uow/UnitOfWork.ts` (`runInUnitOfWork`) +
  `src/data/uow/createSyncedRepo.ts` land the entity write and its local `oplog` row in
  one SQLite transaction — an op can no longer be forgotten. A phantom-op guard was added
  (fix commit `56e045c`) so no-op writes don't append a spurious oplog row.
  `CreateEnvelopeUseCase`/`UpdateEnvelopeUseCase`/`ArchiveEnvelopeUseCase`/
  `CreateTransactionUseCase`/`DeleteTransactionUseCase` all route through it; none of them
  write `envelopes.spent_cents` or enqueue onto `pending_sync` anymore.
- **Schema**: migration 0012 drops `envelopes.spent_cents` and `is_synced` from every
  entity table that had it. This forced a wider `isSynced`-field purge than envelopes
  alone (repositories/use cases for debts, meter readings, households, baby steps, slip
  queue, user consent, audit events — see Task 4 report) because dropping the column
  broke anything still treating it as a required field.
- **Envelope scope**: `getEnvelopeScope()` in `EnvelopeEntity.ts` — `'period'`
  (spending/income/utility) vs `'persistent'` (sinking_fund/emergency_fund/savings/legacy
  baby_step). Persistent envelopes derive balance from the all-time ledger, fixing the
  monthly Baby-Step regression structurally (Task 1).
- **Presentation**: verified zero raw `spent_cents` column reads remain (Task 5). Two
  deleted-machinery call sites (`PendingSyncEnqueuer` in `MeterSetupStep.tsx`,
  `RestoreService` in `JoinHouseholdScreen.tsx`) are documented, non-crashing shims —
  genuinely blocked on domains/engines this slice doesn't own (meter-reading oplog
  migration, the slice-5 `sync_pull` puller), not oversights.
- **SyncOrchestrator**: the dead `isSynced`-marker update (ran after every successful
  upsert, throwing `SQLITE_ERROR` post-0012 since the column no longer exists) was
  removed (Task 4 fix, commit `f4761b1`). Its dequeue mechanism (`pending_sync` row
  deletion on success) is untouched and remains the real dequeue path for every
  not-yet-rewired domain.
- **EMF reconcile mechanism** (`emergencyFundReconcileStore`,
  `ReconcileEmergencyFundTypeUseCase`, duplicate-EMF banner): **NOT removed**, contrary to
  this section's "deleted machinery" framing (§8 table). Task 6 traced every consumer
  end-to-end (`App.tsx` → `SyncOrchestrator.syncPending` → `emfFlipped` →
  `emergencyFundReconcileStore` → `DuplicateEmfBanner` on `BudgetScreen`) and found the
  mechanism still live and load-bearing: persistent envelope scope fixes the _balance_
  resetting monthly, but does nothing to prevent _creating_ two `emergency_fund`
  envelopes in the first place — `CreateEnvelopeUseCase` has no uniqueness check, so two
  devices independently designating an emergency fund before either syncs still produces
  two active EMF envelope rows today, exactly as before this slice.
  `BabyStepEvaluator.findEMF` already tie-breaks to the oldest envelope so Baby Steps 1/3
  don't miscompute, but without the reconcile mechanism the Budget screen would show both
  duplicate envelopes as "Emergency Fund" forever, with no consolidation and no user
  notification — a real feature regression, not dead-code removal. Left in place;
  tracked in `docs/plan-execution-status.md` for slice 4 (rollover engine) or slice 6 to
  either add a create-time uniqueness guard (then retire this mechanism for real) or keep
  it permanently.

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
   - **CRITICAL (found slice-3 review, pre-existing on the shipped build):** `ConfirmSlipUseCase.execute` wraps its multi-item loop in `await this.db.transaction(async (tx) => …)`. Drizzle's expo-sqlite driver runs `transaction()` synchronously in `'sync'` mode and does NOT await an async callback — `COMMIT` fires at the callback's first `await`, before the item writes complete. Reproduced: a 2-item slip where item 2 fails leaves item 1 permanently committed, breaking the all-or-nothing guarantee. All existing tests mock `db.transaction`, hiding it. FIX here: do all validation/reads first (async, outside any transaction), then perform every item insert in ONE synchronous `runInUnitOfWork` transaction (each appends its oplog op); add a realsql test exercising the REAL driver (not a mocked db) proving partial-failure rolls back every item. Fold together with the op_id idempotency + status guard.
6. Envelope type selector gains the missing types; when the screen is opened with `preselectedType` of `sinking_fund` or `emergency_fund` (the two live navigation paths), that type renders as a fixed read-only chip instead of an unmatched segmented control.
7. Dashboard score inputs: real period length and meter flag replace hardcoded `30`/`false`.

## 5. Proving ground, build order, risks

### Test tiers (all real engines)

1. **Real-SQLite tier**: Jest on better-sqlite3; applies the baseline migration; repository/UnitOfWork/rollover/derived-view tests against real SQL; fast-check property tests for money invariants (no op sequence creates or destroys cents; rollover conserves allocations; op replay idempotent).
2. **Real-Postgres tier**: CI runs `supabase start` + `db reset` per PR; pgTAP adversarial RLS suite (two users, two households, every table, anon + cross-household CRUD); RPC signature contract tests (these land in slice 2 with the rebuilt RPCs — the tier's harness lands in slice 1). Note: "tier" means the harness plus whatever tests exist at each slice; tier 1's repository/UnitOfWork/rollover tests accrue as slices 3–4 deliver those components.
3. **Two-device simulation harness**: two in-memory SQLite "devices" running the real SyncEngine against local Supabase; property-based interleavings (write/edit/delete/offline/sync/switch) asserting convergence, no data loss, cent conservation. **Gate: no UI work sits on the sync protocol until this harness is green.**
4. **Authenticated e2e**: Detox against local Supabase — sign up → onboard → envelope → transaction → rollover, plus a two-account invite round-trip. CD publishes only after the full train (fix `branches: ['*']` glob; CD hard-depends on e2e).

### Build order — six independently-green slices

1. Proving-ground scaffolding (tiers 1–2 in CI)
2. Schema baselines, both sides, + contract tests (RPC signature contract tests land here, with the rebuilt RPCs)
3. UnitOfWork, repo factory, ports, derived balances, envelope scopes — domain AND presentation call sites rewired (§8)
4. Rollover engine + wizard (with deterministic envelope ids — see §6)
5. SyncEngine + Realtime + DLQ inbox + boot rework — **this slice builds test tier 3 (two-device harness) first** and is gated on it
6. One-off fixes batch + deletion of dead machinery + **test tier 4 (authenticated e2e + CD gating)** + ADR documenting the protocol contract

### Risks & mitigations

- **Novel protocol** → within slice 5, the two-device property harness (tier 3) is built and green before the engine is wired into any UI.
- **Realtime reliability** → treated as an optional nudge; pull triggers are the guarantee.
- **Derived-balance query performance** → measured in the real-SQLite tier against a seeded 10k-transaction ledger before committing to the view shape. Pass criterion: the per-period all-envelopes balance query completes in < 15 ms in the tier-1 harness; if it fails, fall back to an indexed materialized column maintained by SQLite triggers, with the decision recorded in the slice-3 plan.
- **Scope creep** → each slice is shippable; if priorities shift, stop at any slice boundary with a green build.

### Out of scope (later phases)

Dashboard v2 / gamification / streaks / celebrations (Phase 2), household roles & activity feed & realtime-collaboration UX beyond data sync (Phase 3), monetization, on-device AI, meter OCR, EAS Update/MMKV/FlashList platform modernization (Phase 2 — except where a slice touches the same code anyway).

## 6. Protocol contract — resolutions from the adversarial review (2026-07-03)

These bind slice 2 (server contract) and slice 5 (engine) implementations.

1. **Seq visibility race.** A naive bigserial + "pull after cursor" loses ops: seq N+1 can commit and be pulled while seq N's transaction is still open, advancing the cursor past N forever. Resolution: EVERY oplog writer — `sync_push` AND `apply_server_op` (§6.2) — takes `pg_advisory_xact_lock(hashtextextended(p_household_id::text, 0))`, serializing writes per household so per-household seq order equals commit order. `sync_pull` is per-household, so cursors can never skip an in-flight op. (`hashtextextended` is a pg_catalog internal — stable since PG 11 because hash partitioning depends on it — but the slice-2 implementation must add a one-line comment noting it is not in the SQL docs.)
2. **Server-origin writes must produce ops.** Any server-side mutation of a synced table (edge functions, cron jobs) goes through a shared SQL helper `apply_server_op(...)` that updates the canonical table AND appends the oplog row (`device_id = 'server'`, `actor_user_id` = the affected user where known) in one transaction. `extract-slip`'s direct `.update()` calls on `slip_queue` are refactored onto this in slice 2, and its membership check (which today reads the DELETED `user_households` table at index.ts:89) is re-pointed to `private.is_household_member`. The slip-cleanup cron likewise; its failure records (which today INSERT into the deleted `audit_events`) move to a small server-only `job_log` table (not synced, not client-visible). The `ask-advisor` and `process-slip` directories under `supabase/functions/` are empty `.gitkeep` placeholders — deleted in slice 6 cleanup.
3. **`sync_push` batch semantics.** Ops apply in the client's `seq_local` order, each in its own savepoint; the batch is NOT atomic. The response is per-op: `[{op_id, status: 'applied' | 'rejected', code}]` — the client marks applied ops pushed and dead-letters exactly the rejected ones. A batch spanning multiple households is grouped per household server-side, with membership validated per group and the advisory lock taken per group.
4. **Server-side op validation.** Before apply: (a) the target row's actual `household_id` must equal the op's `household_id` (closing the current `merge_transaction`-class hole); (b) a per-table column allowlist — payloads may never set `id`, `household_id`, `seq`, or actor/device fields; (c) type and CHECK validation. Violations reject that op with a permanent code. **As-built clarification (2026-07-03):** "server-managed fields" means fields the server stamps for ordering/attribution (`seq`, and any future actor/device columns) — NOT `created_at`/`updated_at`. Those are client-authored on insert (an offline-created row legitimately carries the client's creation time) and are never used for conflict resolution (seq is), so they stay in the writable allowlist. The entity tables carry no `seq`/actor/device columns today, so allowlist = all columns minus `id`, `household_id`.
5. **Fresh-install pull & compaction.** Pre-launch, full op-history replay from seq 0 is the restore mechanism and is acceptable. Snapshot-plus-tail compaction (and oplog retention vs. its role as audit trail) is an explicitly deferred decision, recorded in the slice-6 ADR with a revisit trigger (~50k ops per household). Large payloads (e.g. slip `raw_response_json`) stay out of op payloads — ops reference storage objects instead.
6. **Rollover idempotency across devices.** `StartNewPeriodUseCase` derives copied-envelope ids deterministically — UUIDv5 (via the `uuid` package's `v5()`; note `expo-crypto` alone cannot do v5) over `(householdId, periodStart, sourceEnvelopeId)` — so two devices rolling the same period offline generate identical INSERT ops, and the server treats an insert whose row already exists with the same id as an idempotent no-op returning `status: 'applied'`. User allocation adjustments are emitted as separate UPDATE ops (see §3 rollover commit shape), so divergent adjustments merge by seq order instead of being discarded with the insert.
7. **Realtime authorization.** The server `oplog` table gets an RLS SELECT policy (`private.is_household_member(household_id)`) and joins the `supabase_realtime` publication so household members can subscribe to `postgres_changes`; all DML on it remains revoked (RPCs are the only writers).
8. **Increment ops.** Payload is `{field, delta, clamp: 'none' | 'floor_zero'}`; server and local apply share the same clamp semantics. The puller commits `sync_cursor` advancement in the same local SQLite transaction as the batch it applied.
9. **Protocol versioning.** The op shape carries `v: 1`. Ops with unknown `v`, `table`, or `op_type` are rejected with a permanent code; client-version upgrade paths are a named non-goal for v1 (ADR).
10. **DLQ discard semantics.** Discarding a dead-lettered op also refreshes the affected row from the server via a read-only `sync_row_state(p_household_id, p_table, p_row_id)` RPC (membership-checked like `sync_pull`) and applies the returned state locally, so a discarded local write cannot leave the row silently diverged forever.
11. **Duplicate-op acknowledgement.** An op whose `op_id` already exists in the server oplog (app killed between server apply and client ack, then resent) returns `status: 'applied'` — never `rejected` — so the pusher marks it pushed instead of dead-lettering a write that succeeded.

## 7. Operational requirements (coverage-gate additions, 2026-07-03)

1. **RPC timeouts.** Every `sync_push`/`sync_pull`/`sync_row_state` call carries a client-side timeout (30 s via AbortController). On timeout the single-flight guard is released and the attempt is classified transient — a hung call on a flaky mobile network must never deadlock sync until app restart.
2. **Puller failure behavior.** Pull failures (network or local apply) reuse the pusher's classification and capped backoff. A batch whose local apply fails rolls back without advancing the cursor and retries as transient; the cursor only ever advances in the same local transaction as a successfully applied batch (§6.8).
3. **Erasure vs the permanent oplog.** Account/household deletion is satisfied by hard-deleting (or redacting `payload` + `actor_user_id` in) the affected server oplog rows. No component may assume the log is append-only forever — the activity feed and any future compaction must tolerate holes. Recorded in the slice-6 ADR alongside compaction (§6.5). This keeps the Play-required account-deletion feature (game plan Phase 2) implementable without a protocol redesign.
4. **Sync telemetry and log hygiene.** The SyncEngine logs push/pull/dead-letter outcomes through the Logger facade (counts, op_ids, error codes — NEVER op payloads, which are financial data) and reports non-transient sync errors to Crashlytics. Op payloads must not appear in logs or crash reports anywhere.
5. **`sync_pull` limits.** The server enforces a maximum `p_limit` (500). Full-history initial pull is accepted pre-launch; the §6.5 compaction trigger covers growth.
6. **Single-process assumption.** v1 assumes only the foreground app process writes SQLite (WAL + `busy_timeout` cover transient contention). Background-task sync is a named non-goal until explicitly revisited.
7. **`device_id`.** An app-scoped random UUID generated at first launch and stored in local app storage — never a hardware identifier (Play data-safety relevant).
8. **Money-input grammar (§4 fix 2, made concrete).** Accepted: digits with at most one decimal separator, where both `.` and `,` are accepted as the decimal separator (en-ZA/af-ZA convention), max 2 decimals; optional single leading currency symbol and whitespace are stripped; anything else (multiple separators, spaces between digits) is rejected with an inline error, never coerced.
9. **No rollback path pre-launch (accepted risk).** EAS Update is out of scope until Phase 2, so a broken protocol build is remediated by a store release; the server can reject a bad client via the op `v` field. Accepted because no external users exist.
10. **Dev-install transition.** The baseline migrations have no in-place upgrade path: existing dev installs are wiped via uninstall/reinstall, and the boot checksum guard rejecting the old journal is expected. Pre-launch only.

## 8. Surface-fate addendum (reverse traceability, 2026-07-03)

Fates for every surface the original spec left unassigned:

| Surface                                                                                                                | Fate                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Per-user tables** (`user_preferences`, `user_consent`, `user_fcm_tokens`)                                            | Stay OUTSIDE the household-scoped oplog (they have no `household_id`). They keep direct RLS-scoped DML (`user_id = (select auth.uid())`) as a documented **per-user exception** to "RPCs are the only write path"; `merge_user_consent` dies with the other merge RPCs and `user_consent` becomes local-plus-direct-upsert like `user_preferences`. All three tables are in the server baseline.                                                 |
| **Presentation call sites of deleted machinery**                                                                       | Slice 3's rewiring explicitly includes the presentation layer: AuditLogger imports in 9 screens, `PendingSyncEnqueuer` in `MeterSetupStep.tsx`, `RestoreService` in `JoinHouseholdScreen.tsx`/`AcceptInviteUseCase` (replaced by an initial `sync_pull` with progress UI), and the raw `envelopesTable.spentCents` column selects in `SlipScanningScreen.tsx:76` and `AddTransactionScreen.tsx:74` (replaced by the derived-balance read model). |
| **EMF reconcile mechanism** (`emergencyFundReconcileStore`, `ReconcileEmergencyFundTypeUseCase`, duplicate-EMF banner) | Deleted. The persistent-scope EMF (§3) makes duplicate-EMF reconciliation structurally unnecessary; remove with slice 3/4.                                                                                                                                                                                                                                                                                                                       |
| **Local notification stack** (`LocalNotificationScheduler`, preferences, `notificationStore`)                          | Survives. The payday "fill your envelopes" preflight notification is re-pointed to deep-link into the slice-4 rollover wizard.                                                                                                                                                                                                                                                                                                                   |
| **NetworkObserver / OfflineBanner**                                                                                    | The SyncEngine owns network state: it subsumes NetworkObserver and feeds `syncStore.isOnline`, so `OfflineBanner` keeps working unchanged.                                                                                                                                                                                                                                                                                                       |
| **`extractSlipContract.ts`** (lives in the otherwise-deleted `src/data/sync/`)                                         | Survives; moves next to the slip-scanning infrastructure it serves.                                                                                                                                                                                                                                                                                                                                                                              |
| **Existing e2e journeys** (`login`, `addEnvelope`, `syncRoundTrip`)                                                    | Superseded by tier 4's authenticated journeys in slice 6; deleted or rewritten there, never left asserting the old sync stack.                                                                                                                                                                                                                                                                                                                   |
| **`ask-advisor` / `process-slip` function dirs**                                                                       | Empty `.gitkeep` placeholders — deleted in slice 6 (§6.2).                                                                                                                                                                                                                                                                                                                                                                                       |
