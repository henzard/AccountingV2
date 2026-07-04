# Plan Execution Status — Oplog Sync Correctness Rebuild

Tracks execution of `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md`
against its six-slice build order. Updated at the end of each slice (or task, for the
slice currently in flight). Source of truth for "what's actually shipped" vs. the spec's
end-state description — the spec describes the full 6-slice target; this doc says where
we really are.

## Slice graph

```
1. Proving-ground scaffolding (tiers 1-2 in CI)
      |
2. Schema baselines (server) + contract tests
      |
3. UnitOfWork, derived balances, envelope scopes
      |
4. Rollover engine + wizard (deterministic envelope ids)  <-- in review (this doc)
      |
5. SyncEngine + Realtime + DLQ inbox + boot rework (two-device harness gate)
      |
6. One-off fixes + delete dead machinery + e2e/CD gate + protocol ADR
```

Each slice is independently shippable and green (spec §5 "Build order"). A slice does not
start until the previous one is DELIVERED (merged + green on the relevant CD/Play track).

## Per-slice state

### Slice 1 — Proving-ground scaffolding

**State: DELIVERED + Play.** PR #112 merged; real-SQLite + real-Postgres test tiers added
to CI, 5 real bugs fixed along the way. Currently on the Play internal track.

### Slice 2 — Schema baselines, both sides, + contract tests

**State: DELIVERED + Play.** PR #114 merged, CD publish green. CodeRabbit caught 1 Critical
(`validate_slip_path` soft-deleted-member bypass) + 2 Major (`user_consent` missing write
path, `join_household_via_invite` duplicate-membership TOCTOU) — all fixed before merge.
pgTAP 50/50. On the Play internal track alongside slice 1.

### Slice 3 — UnitOfWork, derived balances, envelope scopes

**State: DELIVERED + Play.** PR #115 merged, CD publish green. CodeRabbit caught 6 Major

- 2 Minor on the slice PR (uuid crash risk fixed via `expo-crypto`, period leak,
  cross-household write guard, non-atomic audit, over-broad catch, query scoping) — all
  fixed before merge. On the Play internal track alongside slices 1-2.

| Task | Summary                                                                                                                                                                               | Commit(s)                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | Derived-balance read model `getEnvelopeSpentCents` (SUM over ledger); perf-gated 3ms/10k rows (target <15ms)                                                                          | `1b0740c`                                                                                                           |
| 2    | `UnitOfWork` + `createSyncedRepo` — writes append exactly one local oplog row atomically; phantom-op guard on no-op writes                                                            | `4d6d986` + `56e045c`                                                                                               |
| 3    | Envelope + transaction use cases rewired onto UnitOfWork; no `spent_cents` writes; exactly-one-op verified                                                                            | `452bbf5`                                                                                                           |
| 4    | Migration 0012 drops `envelopes.spent_cents` + `is_synced` (~25 files touched); repos wired to derived balances                                                                       | `7415c63` + fix `f4761b1` (SyncOrchestrator dead `isSynced` update removed — was throwing `SQLITE_ERROR` post-0012) |
| 5    | Presentation layer verified/rewired onto derived balances; 0 raw `spent_cents` column reads remain; two deleted-machinery call sites documented as non-crashing (slice-5-owned) shims | `efea317`                                                                                                           |
| 6    | EMF reconcile mechanism reviewed for removal — **kept, not removed** (see disposition below); status doc (this file); spec as-built note; final gate                                  | `0e7f856` (+ CodeRabbit fix `aea6360` pre-merge)                                                                    |

**Carried forward (Critical, not a regression — pre-existing on the shipped build, recorded
spec §4.5):** `ConfirmSlipUseCase.execute` wraps its multi-item write loop in
`await this.db.transaction(async (tx) => …)`. Drizzle's expo-sqlite driver runs
`transaction()` synchronously in `'sync'` mode and does not await an async callback —
`COMMIT` fires at the callback's first `await`, before every item write completes. A
2-item slip where item 2 fails leaves item 1 permanently committed, breaking the
all-or-nothing guarantee. Found in slice-3 Task 3 review; every existing test mocks
`db.transaction`, hiding it. **Owned by slice 6** (spec §4, item 5): read/validate first
(outside any transaction), then perform every item write in one synchronous
`runInUnitOfWork` call; add a realsql test against the real driver proving partial-failure
rollback.

**EMF reconcile disposition — KEPT, not removed.** See task-6 report
(`.superpowers/sdd/task-6-report.md`) for the full trace. Short version: the spec's
"deleted machinery" table (§8) attributes duplicate-EMF creation to the period-scope
balance-reset bug, and claims persistent scope (this slice) makes reconciliation
"structurally unnecessary." That's not what the code shows: duplicate `emergency_fund`
envelopes are created when two devices/onboarding flows independently call
`CreateEnvelopeUseCase` with `envelopeType: 'emergency_fund'` before either syncs — a
create-time race, unrelated to how the balance is computed. Nothing shipped in slice 3
(or planned for slice 4's rollover engine) adds a uniqueness check preventing that race.
Removing `emergencyFundReconcileStore` / `ReconcileEmergencyFundTypeUseCase` /
`DuplicateEmfBanner` today would leave two live "Emergency Fund" envelopes permanently
visible on the Budget screen after such a race, with no consolidation and no user
notification — a real feature regression, not a dead-code removal. Left in place;
flagged for slice 4/6 to either add a create-time uniqueness guard (then retire this
mechanism for real) or keep it as the permanent safety net.

### Slice 4 — Rollover engine + wizard

**State: in-review (Task 4 of 4 complete; slice PR pending).**

| Task | Summary                                                                                                                                                                                                                                                                                 | Commit(s)           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1    | `StartNewPeriodUseCase` — real period rollover: copies period-scoped envelopes forward, skips persistent/archived; deterministic `uuidv5` target ids for cross-device idempotency                                                                                                       | `0722ea8`           |
| 2    | EMF create-time duplicate guard in `CreateEnvelopeUseCase` (rejects a second active `emergency_fund` per household); latent boolean-binding fix                                                                                                                                         | `8feaa43`           |
| 3    | `RolloverWizard` (review → adjust → commit) replaces the lying `PeriodRolloverModal`                                                                                                                                                                                                    | `2bee155`           |
| 4    | Baby Step 1/3 rollover regression test + fix (`ReconcileBabyStepsUseCase` read the EMF period-filtered instead of scope-aware — real remaining bug, fixed); 2 Task-3 minors folded in (dismiss-during-commit guard, allocation-state reset); status doc; spec as-built note; final gate | pending (this task) |

**Product decision (surfaced for owner, default chosen):** the rollover wizard's
dismiss-without-commit path does not acknowledge the period, so it re-pops on every
dashboard visit until the user actually commits — a deliberate "forces the monthly
review" default, stricter than the old (also-non-dismissible) modal. Owner can switch
to an ack-on-dismiss "remind me later" behavior later if the forced-review default
proves too aggressive in practice.

**Baby Step regression disposition:** this was a real remaining bug, not already fixed
by slices 3+4's balance/copy-forward work alone. Persistent EMF scope stops the
_balance_ resetting monthly and the rollover engine correctly never recreates the EMF
row, but `ReconcileBabyStepsUseCase`'s envelope read still filtered by strict
`period_start` equality, which excludes the persistent EMF the instant the household
rolls onto a new period (its `period_start` column is fixed at creation and never
updated). Fixed by switching to the same `envelopeScopeCondition` predicate already used
by `StartNewPeriodUseCase`/`getEnvelopeSpentCents`. Regression-proven both ways in
`tests/realsql/babyStepRolloverRegression.test.ts` (fails pre-fix, passes post-fix,
verified by reverting and re-applying the fix).

### Slice 5 — SyncEngine + Realtime + DLQ inbox + boot rework

**State: in-review (Task 6 of 6 complete; slice PR pending).** Full local gate green:
`npm run test:realsql`, `npx jest --selectProjects twodevice`, `npx jest --selectProjects
app --coverage` (2032 tests, 87.57%/75.8%/83.82%/88.1% stmt/branch/func/line — above the
80/60 floor), `npx tsc --noEmit`, `npx eslint src/ --ext .ts,.tsx --max-warnings 0`, and
`supabase db reset && supabase test db` (54/54 pgTAP) all green.

| Task | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Commit(s)                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1    | Migrated every remaining domain writer (debts, baby steps, meter readings, households, slip queue, user consent) off `pending_sync`/`PendingSyncEnqueuer` onto `createSyncedRepo`/oplog; recorded 2 follow-ups (debt `is_paid_off` divergence, EMF-reconcile disposition)                                                                                                                                                                                                                                                                                                                                                                                                                                 | `5cb1709` + `2344464` + `38ba25e` |
| 2    | Two-device convergence property harness (tier 3) driving real server RPCs against local Supabase — the slice's risk-mitigation gate, built and green before the production engine existed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `443743e` + `0ecd11d`             |
| 3    | Production `SyncEngine` — pusher + puller, validated against the Task-2 harness with the real engine; puller resilience + dead-letter/increment guard fixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `b11893b` + `5c5f425`             |
| 4    | `SyncScheduler` — Realtime nudge + after-write/foreground/reconnect triggers, `syncStore` wiring, DLQ surfacing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `20e64d1`                         |
| 5    | Sync Health / DLQ inbox screen; `App.tsx` boot rework — cuts over to `SyncEngine`/`SyncScheduler`, local-only boot gate (never network-gated); boot-resilience fix (degrade gracefully on local init throw instead of hanging splash)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `07aa7d7` + `cac6266`             |
| 6    | This task. Deleted `SyncOrchestrator`/`PendingSyncEnqueuer`/`PendingSyncEnqueuerAdapter`/`PendingSyncTable`/`ISyncEnqueuer` + the local `pending_sync` table (migration 0014); kept `RestoreService`/`rowConverters` (still-live discovery path) and the EMF reconcile mechanism (re-verified live, re-wired onto `SyncScheduler.onSyncSuccess` after Task 5's cutover silently orphaned its old trigger); fixed a latent bug where `AuditLogger` still wrote into the about-to-be-dropped `pending_sync` table; closed the debt `is_paid_off` divergence via a server-side derive trigger (baseline §9g); wrote `docs/adr/0001-oplog-sync-protocol.md`. Full trace: `.superpowers/sdd/task-6-report.md`. | pending (this task's commit)      |

**EMF reconcile disposition — reconfirmed KEPT, not removed (third review of the same
question; see task-6-report.md for the full trace).** The slice-3 Task-6 and slice-4
as-built dispositions already recorded in this doc were correct and are reconfirmed: the
create-time race (two offline devices each creating their own `emergency_fund` envelope
before either syncs) is still open today — the slice-4 create-time guard and the local
`0013_emf_unique.sql` unique index only close the SAME-DEVICE half of it (the index's own
comment says so explicitly). What Task 6 found NEW: Task 5's `App.tsx` boot-rework cutover
removed the only call site that ever fired the reconcile trigger
(`syncOrchestrator.syncPending().then(...)`) without replacing it, silently orphaning a
mechanism this doc already described as "kept... as the permanent safety net." Task 6
treats this as a Task-5 regression, not a reason to finally delete the mechanism, and
re-wires it via a new generic `SyncScheduler.onSyncSuccess` hook called from `App.tsx`'s
composition root (data layer still never imports `domain/*` — the hook is generic, the
EMF-specific behavior is supplied by `App.tsx`).

**Debt `is_paid_off` divergence — CLOSED.** The Task-1-review follow-up (spec
"Slice-5 follow-ups") is fixed: `supabase/migrations/0001_baseline.sql` §9g adds a
`BEFORE INSERT OR UPDATE` trigger on `public.debts` that derives `is_paid_off` from
`outstanding_balance_cents` unconditionally, server-side. `LogDebtPaymentUseCase` no
longer pushes a third `update` op for it — down to 2 oplog ops per payment (both
`increment`). Proven at both layers: `tests/realsql/debtPayment.test.ts` (local SQLite
oplog shape) and `supabase/tests/oplog_protocol.test.sql` Probe 13 (real Postgres trigger
behavior, run via `supabase test db`).

### Slice 6 — One-off fixes + delete dead machinery + e2e/CD gate + protocol ADR

**State: pending. No plan file exists yet** (`docs/superpowers/plans/` has no
`slice6-*.md`). Most of this slice's originally-scoped work (dead-machinery deletion,
protocol ADR) was pulled forward into slice 5 task 6 above once it became clear slice 5
couldn't be called done without them. What's left, still unowned by any slice:

- **`ConfirmSlipUseCase` atomicity fix (Critical, carried forward — not a regression,
  pre-existing on the shipped build).** `ConfirmSlipUseCase.execute` wraps its multi-item
  write loop in `await this.db.transaction(async (tx) => …)`. Drizzle's expo-sqlite driver
  runs `transaction()` synchronously in `'sync'` mode and does not await an async
  callback — `COMMIT` fires at the callback's first `await`, before every item write
  completes. A 2-item slip where item 2 fails leaves item 1 permanently committed,
  breaking the all-or-nothing guarantee. Found in slice-3 Task 3 review; every existing
  test mocks `db.transaction`, hiding it. Fix: read/validate first (outside any
  transaction), then perform every item write in one synchronous `runInUnitOfWork` call;
  add a realsql test against the real driver proving partial-failure rollback. **Not
  touched by slice 5 task 6** — confirmed still slice-6-scope, unchanged.
- **Remote deployment of the oplog baseline** (flagged in `docs/adr/0001-oplog-sync-protocol.md`)
  — a production action requiring explicit human approval; the app cannot round-trip
  against the real Supabase project until `0001_baseline.sql` is deployed there.
- **Compaction/retention revisit** at ~50k ops/household (ADR §6.5 deferral).
- **`RestoreService` retirement** — fold household discovery into a `SyncEngine`-native
  pull once a "list my households" pull RPC exists, then delete `RestoreService`/
  `rowConverters` for real.
- Authenticated e2e tier + CD hard-dependency on it (original slice-6 scope, not started).

## Notes

- "DELIVERED + Play" means merged to `master` and live on the Google Play internal
  testing track, per the existing CD pipeline (slices 1-3; slice 4+ are app-internal
  refactors with no store-facing surface change yet, riding the same CD pipeline once
  merged).
- Slice 3's own plan: `docs/superpowers/plans/2026-07-03-slice3-unitofwork-derived-balances.md`.
- Full target-state spec: `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md`.
