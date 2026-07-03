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
3. UnitOfWork, derived balances, envelope scopes  <-- in review (this doc)
      |
4. Rollover engine + wizard (deterministic envelope ids)
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

**State: in-review (Task 6 of 6 complete; slice PR pending).**

| Task | Summary                                                                                                                                                                               | Commit(s)                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | Derived-balance read model `getEnvelopeSpentCents` (SUM over ledger); perf-gated 3ms/10k rows (target <15ms)                                                                          | `1b0740c`                                                                                                           |
| 2    | `UnitOfWork` + `createSyncedRepo` — writes append exactly one local oplog row atomically; phantom-op guard on no-op writes                                                            | `4d6d986` + `56e045c`                                                                                               |
| 3    | Envelope + transaction use cases rewired onto UnitOfWork; no `spent_cents` writes; exactly-one-op verified                                                                            | `452bbf5`                                                                                                           |
| 4    | Migration 0012 drops `envelopes.spent_cents` + `is_synced` (~25 files touched); repos wired to derived balances                                                                       | `7415c63` + fix `f4761b1` (SyncOrchestrator dead `isSynced` update removed — was throwing `SQLITE_ERROR` post-0012) |
| 5    | Presentation layer verified/rewired onto derived balances; 0 raw `spent_cents` column reads remain; two deleted-machinery call sites documented as non-crashing (slice-5-owned) shims | `efea317`                                                                                                           |
| 6    | EMF reconcile mechanism reviewed for removal — **kept, not removed** (see disposition below); status doc (this file); spec as-built note; final gate                                  | pending                                                                                                             |

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

**State: pending.** Not started.

### Slice 5 — SyncEngine + Realtime + DLQ inbox + boot rework

**State: pending.** Gated on building test tier 3 (two-device property harness) first,
per spec §5 risk mitigation. Not started.

### Slice 6 — One-off fixes + delete dead machinery + e2e/CD gate + protocol ADR

**State: pending.** Not started. Owns: `ConfirmSlipUseCase` atomicity fix (above),
deletion of `SyncOrchestrator`/`PendingSyncEnqueuer`/`RestoreService`/`AuditLogger` once
every domain is oplog-backed, `merge_*` RPC removal, protocol contract ADR, authenticated
e2e tier + CD hard-dependency on it.

## Notes

- "DELIVERED + Play" means merged to `master` and live on the Google Play internal
  testing track, per the existing CD pipeline (slice 1/2 only — slices 3+ are app-internal
  refactors with no store-facing surface change yet).
- Slice 3's own plan: `docs/superpowers/plans/2026-07-03-slice3-unitofwork-derived-balances.md`.
- Full target-state spec: `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md`.
