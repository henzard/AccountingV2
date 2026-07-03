# Slice 3: UnitOfWork + Derived Balances + Envelope Scopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make transactions the single source of truth for envelope spend (derive `spentCents`, stop storing it), introduce a UnitOfWork that appends oplog entries atomically with entity writes, split envelopes into period vs persistent scope, and rewire every domain use case and presentation call site off the deleted machinery — WITHOUT breaking the shipped app (old sync goes cleanly dark).

**Architecture:** A `createSyncedRepo` factory whose writes append a local oplog row in the same SQLite transaction (replacing the `PendingSyncEnqueuer` per-use-case pattern); a derived-balance read model (repository query / SQL view summing non-deleted transactions); envelope `scope` derived from `envelope_type`; transactions no longer mutate `envelopes.spent_cents` (column dropped in migration 0012). Spec: `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md` §3, §8.

**Tech Stack:** Drizzle + expo-sqlite, better-sqlite3 realsql tier, Zustand, React Native.

## Global Constraints

- TypeScript strict; `npx tsc --noEmit`, `npx eslint src/ --max-warnings 0` green; `npx jest --selectProjects app --coverage` green + thresholds 80/60; `npm run test:realsql` green; `supabase db reset` + `supabase test db` green (server untouched this slice, must stay green). ALL pass at end of EVERY task.
- **The app must keep running against the unchanged remote.** Old `SyncOrchestrator`/`pending_sync` stay wired until slice 5 — but this slice STOPS writing to `pending_sync` (writes go to the local `oplog` instead). Result: the old sync drains an empty queue → dark cleanly, no crash. Do NOT delete `SyncOrchestrator`/`PendingSyncEnqueuer` here (slice 6 owns deletion); just stop feeding them.
- Money stays integer cents. `EnvelopeEntity` public helpers (`getRemainingCents`, `getPercentRemaining`, `isOverBudget`) keep their signatures — only their `spentCents` INPUT source changes.
- Derived-balance performance gate (spec §5): the per-period all-envelopes balance query must run < 15 ms in the realsql tier against a seeded 10k-transaction ledger; if it fails, fall back to a trigger-maintained column (record the decision).
- Envelope scope: `period` = spending, income, utility; `persistent` = sinking_fund, emergency_fund, savings, (legacy baby_step maps to emergency_fund per spec). Period-scoped balance sums transactions in the same period; persistent sums all-time.
- Local migration 0012 drops `envelopes.spent_cents` and `is_synced` columns (SQLite: table-rebuild pattern). Dev installs uninstall/reinstall (checksum guard).

---

### Task 1: Derived-balance read model + performance gate (realsql, TDD)

**Files:** Create `src/data/local/balances/EnvelopeBalanceQuery.ts` (a function taking the Drizzle db + householdId + period, returning `Map<envelopeId, spentCents>` via a single grouped SUM over non-deleted transactions, period-aware by scope); Create `tests/realsql/envelopeBalance.test.ts` (correctness across scopes + a seeded 10k-tx `< 15ms` perf assertion + a conservation property with fast-check). NO schema change yet (spent_cents still present, unused by this query).

**Interfaces:** Produces `getEnvelopeSpentCents(db, householdId, periodStart): Promise<Map<string, number>>` — period-scoped envelopes sum transactions where `transaction_date` falls in the envelope's period; persistent envelopes sum all-time. Consumed by Task 3's repository and Task 5's hooks.

TDD: write the test (seed households, envelopes of both scopes, transactions; assert sums match hand-computed; assert 10k-row query < 15 ms; property: sum of all envelope spends == sum of all transaction amounts) → implement query → green. If perf fails, add a covering index on `transactions(household_id, envelope_id, transaction_date, deleted_at)` and re-measure; if still failing, record the trigger-column fallback decision in the report and implement that instead.

---

### Task 2: UnitOfWork + createSyncedRepo factory (writes append oplog atomically)

**Files:** Create `src/data/uow/UnitOfWork.ts` (a `runInUnitOfWork(db, fn)` wrapping a `db.transaction`, exposing an op-appender); Create `src/data/uow/createSyncedRepo.ts` (given a Drizzle table + scope config, derives `insert/update/softDelete/increment` that each write the entity row AND append the matching local `oplog` row — `op_id` = uuid, `op_type`, `payload` = changed fields, `device_id`, `client_created_at`, `pushed_at` null — in ONE transaction); Create `src/infrastructure/device/deviceId.ts` (app-scoped random UUID persisted in local storage, spec §7.7); Test `tests/realsql/unitOfWork.test.ts` + `tests/realsql/createSyncedRepo.test.ts`.

**Interfaces:** `createSyncedRepo(db, { table, tableName })` → `{ insert(row), update(id, householdId, fields), softDelete(id, householdId), increment(id, householdId, field, delta, clamp) }`, each returning the affected row and guaranteeing exactly one oplog row appended in the same tx. `getDeviceId(): Promise<string>`. UUIDs via the `uuid` package's v4 (deviceId) — NOT expo-crypto for v5 (that's rollover, slice 4).

TDD: prove (a) an insert writes entity + exactly one oplog row atomically; (b) a thrown error inside the tx rolls back BOTH (no orphan oplog row, no orphan entity); (c) softDelete sets deleted_at + appends a delete op; (d) increment appends an increment op with {field,delta,clamp}. Add `uuid` dep if not present.

---

### Task 3: Rewire envelope + transaction use cases onto UnitOfWork + derived balances

**Files:** Modify `src/domain/transactions/CreateTransactionUseCase.ts` (stop mutating envelope.spent_cents; write the transaction via the synced repo; no envelope write at all — balance is derived), `DeleteTransactionUseCase.ts` (soft-delete the transaction via repo; existence-checked; no envelope decrement), `src/domain/envelopes/CreateEnvelopeUseCase.ts` / `UpdateEnvelopeUseCase.ts` / `ArchiveEnvelopeUseCase.ts` (use the synced repo + UnitOfWork instead of `PendingSyncEnqueuerAdapter`; add `scope` derivation), `EnvelopeEntity.ts` (add `scope` getter from `envelopeType`; helpers unchanged). Update the affected `__tests__`. Add `IClock`/`IIdGenerator` ports if the use cases need injectable time/ids for testability.

**Interfaces:** Use cases take repository ports (already defined in `src/domain/ports`) + the UnitOfWork. `EnvelopeEntity.scope: 'period' | 'persistent'`. CreateTransaction no longer references spentCents anywhere.

TDD per use case: existing tests updated to assert the transaction/envelope write + oplog append (via in-memory or realsql repo), and that NO spent_cents mutation happens. Fixes ride along: DeleteTransaction existence check (deep-review finding), atomic writes.

---

### Task 4: Local migration 0012 — drop spent_cents + is_synced; derived-balance wiring in repositories

**Files:** Create `src/data/local/migrations/0012_derive_balances.sql` (SQLite table-rebuild dropping `envelopes.spent_cents` and the `is_synced` columns from all entity tables) + journal idx 12 + migrations.js; Modify `DrizzleEnvelopeRepository.ts` + `src/data/local/schema/envelopes.ts` (remove spentCents column; repository read methods call `getEnvelopeSpentCents` and attach the derived value to returned entities); Modify other schema files to drop `is_synced`. Update realsql conformance (it will enforce the schema matches).

**Interfaces:** `DrizzleEnvelopeRepository.listByHousehold(householdId, periodStart)` returns envelopes with derived `spentCents`. Schema no longer has `spent_cents`/`is_synced`.

TDD: realsql migration test (0012 applies clean over a seeded DB; spent_cents gone; conformance passes); repository test proving derived spentCents matches the ledger.

---

### Task 5: Presentation rewiring — spentCents readers + deleted-machinery call sites

**Files:** Modify the presentation files that read `spentCents` off entities (DashboardScreen, ForecastScreen, EnvelopePickerSheet, AddTransactionScreen, SlipScanningScreen, budget/sinking screens — the derived value flows through hooks unchanged, so most need no change; the two RAW column selects `SlipScanningScreen.tsx` + `AddTransactionScreen.tsx` MUST switch to the repository/hook); replace the AuditLogger direct imports in the 9 screens (route through UnitOfWork audit or drop — audit_events local table stays but writes go via the oplog actor; confirm per spec §8); replace `PendingSyncEnqueuer` import in `MeterSetupStep.tsx` and `RestoreService` import in `JoinHouseholdScreen.tsx` (the latter → an initial `sync_pull` stub or leave a TODO wired to slice 5 with a working fallback that doesn't crash). Update hooks (`useEnvelopes` etc.) to source derived balances.

**Interfaces:** No screen reads a physical `spentCents` column; all go through hooks/repositories. No presentation file imports `PendingSyncEnqueuer`/`AuditLogger`/`RestoreService` directly (or, where slice-5-owned, a documented non-crashing shim).

TDD: app jest suite green (the screen tests already assert rendered balances — they must still pass with the derived source); add a test that the two ex-raw-column screens render correct spend.

---

### Task 6: EMF reconcile removal + final verification + status doc

**Files:** Delete `emergencyFundReconcileStore` + `ReconcileEmergencyFundTypeUseCase` (obsoleted by persistent EMF scope, spec §8) and their call sites/tests; update `docs/plan-execution-status.md`; append slice-3 as-built notes to the spec §3.

- [ ] Full gate: realsql + app-coverage + tsc + eslint + `supabase db reset`/`test db` all green.
- [ ] Verify the app boots and old sync drains empty (reason about App.tsx: pending_sync now never written → SyncOrchestrator no-ops, no throw).
- [ ] Commit; slice PR.

## Done means

- `envelopes.spent_cents` gone; balances derived from the transaction ledger, perf-gated < 15 ms on 10k rows.
- Every envelope/transaction write goes through UnitOfWork and appends exactly one local oplog row atomically; nothing writes `pending_sync` anymore.
- Envelope scope (period/persistent) live; persistent EMF fixes the monthly Baby-Step regression structurally.
- No presentation file reads a raw spent_cents column or imports deleted-machinery adapters (or does so via a documented non-crashing slice-5 shim).
- App suite/tsc/eslint/realsql/pgTAP all green; app still runs against the unchanged remote (old sync dark, not broken).
