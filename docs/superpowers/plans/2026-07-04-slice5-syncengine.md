# Slice 5: SyncEngine (oplog drain) + Realtime + DLQ inbox + boot rework

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). ALSO consult weighsoft-sync-safety before touching any push/pull/apply/cursor code.

**Goal:** Bring remote sync back to life on the oplog protocol: a SyncEngine that pushes the local oplog to `sync_push`, pulls peers' ops via `sync_pull` with a per-household cursor, applies them locally, nudged by Supabase Realtime; a DLQ inbox in Settings; and a boot rework that renders from local SQLite first (no network gate). This is the riskiest slice — build the two-device convergence harness (spec test tier 3) FIRST and gate all engine-into-UI wiring on it.

**Architecture:** `SyncEngine` replaces `SyncOrchestrator` + `RestoreService` + the NetworkObserver→sync wiring. Pusher drains unpushed oplog rows (`pushed_at IS NULL`) in `seq_local` order, batched, via `supabase.rpc('sync_push', {p_ops})`; classifies per-op responses (applied → set `pushed_at`/prune; rejected → dead-letter). Puller loops `supabase.rpc('sync_pull', {p_household_id, p_after_seq, p_limit})` from `sync_cursor.last_pulled_seq`, applies each op to local tables in one transaction, advances the cursor in the SAME transaction, skips own `device_id`. Triggers: debounced after-write, AppState foreground, NetInfo reconnect, Realtime `postgres_changes` nudge on the household oplog. Spec: `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md` §1, §4, §6, §7.

**Tech Stack:** Supabase JS (rpc + Realtime), Drizzle + expo-sqlite, better-sqlite3 + pglite (or local supabase) for the two-device harness, Zustand (syncStore), React Native.

## Global Constraints

- All gates green every task: realsql, app-coverage (80/60), tsc, eslint, `supabase db reset`+`supabase test db`.
- **weighsoft-sync-safety rules are binding**: no committed local write may be lost or fail to replicate; cursor advances ONLY in the same transaction as a successfully-applied pull batch; own-device ops skipped on pull; duplicate op_id push → treated applied (server contract §6.11); pusher never marks pushed_at on a rejected op.
- Old machinery (`SyncOrchestrator`, `PendingSyncEnqueuer`, `PendingSyncTable`, `RestoreService`, `rowConverters`, `NetworkObserver`→sync wiring) is REPLACED by SyncEngine and DELETED in this slice's cleanup task (this is where slice-3's "don't delete yet" lifts). BUT the domains still writing to `pending_sync` (debt/babyStep/meter/slip/consent/household — anything not yet on createSyncedRepo) MUST be migrated onto createSyncedRepo/oplog in this slice OR their writes stop syncing. Task 1 audits which domains still use the old enqueuer and migrates them.
- Boot: first paint gates on LOCAL SQLite only (never the network); SyncEngine starts after the navigator mounts; auth listener filters to SIGNED_IN (spec §4). expo-splash-screen keeps the native splash up during local init.
- RPC calls carry a 30s AbortController timeout (spec §7.1); on timeout release the single-flight guard, classify transient.
- Money integer cents; increment ops apply with the floor_zero clamp matching the server.

---

### Task 1: Migrate remaining domains onto createSyncedRepo (kill pending_sync writes)

**Files:** Audit `grep -rln "PendingSyncEnqueuer\|enqueue(" src/domain src/data/repositories` — migrate debt (LogDebtPayment/CreateDebt), baby steps (Reconcile/Toggle/Stamp/Seed), meter readings (LogMeterReading), household (CreateHousehold/AcceptInvite), slip (ConfirmSlip), user consent writes onto createSyncedRepo (oplog) instead of the old enqueuer. Update tests.

**Interfaces:** After this task, NOTHING writes `pending_sync`; every entity write appends an oplog op. `grep pending_sync src/domain src/data/repositories` (excluding the table def + old machinery slated for deletion) returns nothing. Debt payment stays an atomic increment op (spec — the total_paid pattern). This also fixes the deep-review "baby-step writes never enqueued" finding.

TDD per domain: existing tests updated to assert oplog append (not pending_sync enqueue). realsql proof that each write produces exactly one oplog op.

---

### Task 2: Two-device convergence harness (tier 3) — THE GATE, build FIRST

**Files:** Create `tests/realsql/twoDevice/harness.ts` (two independent SQLite DBs = two devices, each with its own oplog/cursor, sharing one server — local supabase or an in-memory server model that runs the REAL sync_push/sync_pull SQL) + `tests/realsql/twoDevice/convergence.test.ts`.

**Interfaces:** A harness that, given a sequence of per-device operations (write/edit/delete/increment/push/pull/offline/reconnect in any interleaving), runs them through the REAL pusher/puller logic + the REAL server RPCs, and asserts: both devices converge to identical entity state; no committed write lost; increment ops sum correctly under concurrency; duplicate pushes are no-ops; deletes propagate (soft). Property-based (fast-check) interleaving fuzzer. **No SyncEngine→UI wiring (Tasks 4-6) may proceed until this harness is green.**

TDD: write the convergence assertions first against a stub engine, then they drive Task 3's engine implementation.

---

### Task 3: SyncEngine core (pusher + puller) — gated on Task 2 harness

**Files:** Create `src/data/sync/SyncEngine.ts` (pusher, puller, single-flight, backoff, cursor, DLQ classification); reuse the good backoff/retry logic ported from SyncOrchestrator. Test via the Task-2 harness + realsql.

**Interfaces:** `SyncEngine.push()`, `.pull(householdId)`, `.sync(householdId)` (push then drain-pull). Pusher: batch unpushed oplog by seq_local, `rpc('sync_push')`, per-op applied→pushed_at+prune / rejected→dead_lettered_at + classify (permanent vs transient); transient → capped backoff (no 7-day discard). Puller: from cursor, `rpc('sync_pull')` loop until short page, apply each op in one tx, advance cursor same tx, skip own device_id, 30s timeout. Idempotent apply (op already applied → skip). Must pass the Task-2 convergence harness.

TDD: harness green + realsql unit tests for each classification branch.

---

### Task 4: Realtime nudge + triggers + syncStore

**Files:** Modify SyncEngine (Realtime subscription on household oplog → pull; debounced after-write; AppState foreground; NetInfo reconnect); publish status into `src/presentation/stores/syncStore.ts` (last synced, pending count, syncing/error) — the currently-dead fields. Modify NetworkObserver usage (SyncEngine subsumes the sync-trigger wiring; OfflineBanner keeps working off syncStore.isOnline).

**Interfaces:** SyncEngine subscribes to `supabase.channel(...).on('postgres_changes', {table:'oplog', filter:household_id})` as a NUDGE (never the sole trigger — pull triggers are the guarantee, spec §6.7). syncStore reflects live state. Realtime auth uses the oplog RLS SELECT policy (slice 2).

TDD: after-write triggers a debounced push; a simulated realtime event triggers a pull; syncStore updates; Realtime-down still syncs via foreground/reconnect.

---

### Task 5: DLQ inbox UI + boot rework

**Files:** Create `src/presentation/screens/settings/SyncHealthScreen.tsx` (last synced, pending count, manual sync, DLQ list with retry/discard per spec §6.10 discard = re-pull row state); wire into Settings. Rework `App.tsx` boot: expo-splash-screen (add dep), first paint on local SQLite only, SyncEngine starts post-mount, auth listener filters SIGNED_IN, initSession no double-run / no token-refresh re-run (deep-review boot findings); household switch re-points the puller cursor (fixes "switch shows empty data").

**Interfaces:** Settings → Sync Health screen. Boot never blocks on network; a hung RPC can't deadlock (timeout + single-flight release). DLQ discard calls `sync_row_state` to refresh the diverged row (spec §6.10). Accessibility WCAG AA on the new screen.

TDD: boot renders from local without network (mock offline); DLQ retry re-pushes; discard re-pulls the row; household switch pulls the new household's ops.

---

### Task 6: Delete dead machinery + final verification + ADR

**Files:** Delete `SyncOrchestrator`, `PendingSyncEnqueuer`, `PendingSyncTable`, `RestoreService`, `rowConverters`, `emergencyFundReconcileStore` + `ReconcileEmergencyFundTypeUseCase` (now that createSyncedRepo migration + EMF DB index make them obsolete — VERIFY no live consumer first), and the `pending_sync` local table (migration 0014 drop) + server-side old sync tables if any. Write the protocol ADR (spec §6.5 compaction deferral, the whole contract). Update status doc.

- [ ] Full gate green + two-device harness green.
- [ ] `grep -rn "SyncOrchestrator\|PendingSyncEnqueuer\|RestoreService\|pending_sync" src` returns only the deletion/migration + comments.
- [ ] Boot-safety: reason about the full boot + first sync against the REAL remote (this slice makes remote sync live again — but the remote is still the OLD schema until it's migrated; DECISION POINT: does this slice migrate the remote (supabase db push to the linked project) or does the app now point at a fresh/reset remote? This must be resolved — the oplog RPCs exist on the baseline but NOT on the deployed remote. Flag to the human: deploying the baseline to the remote is a production action requiring explicit approval.)
- [ ] Commit; slice PR.

## Done means

- SyncEngine pushes/pulls the oplog; two-device convergence harness green (no lost writes, increments sum, deletes propagate, idempotent).
- Realtime nudge + all triggers live; syncStore reflects real state; DLQ inbox usable.
- Boot renders from local SQLite instantly, never network-gated; household switch restores correctly.
- All old sync machinery deleted; nothing writes pending_sync.
- Protocol ADR written.
- **Open decision for the human**: remote deployment of the oplog baseline (production action) — the app can't actually round-trip to the real remote until sync_push/sync_pull exist there.
