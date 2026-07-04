# AccountingV2 — Oplog Sync Correctness Rebuild: Complete

**Status:** All 6 slices delivered (1-5 merged and live on the Google Play internal
testing track; slice 6 in-review, PR pending → merge → Play). This document is the final
summary of the rebuild triggered by the 2026-07-02 deep review. For the full narrative
trail, see `docs/plan-execution-status.md` (per-slice/per-task detail),
`docs/adr/0001-oplog-sync-protocol.md` (the binding protocol contract), and
`docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md` (the approved
design this rebuild implemented).

---

## 1. Where this started

**`docs/200x-game-plan.md`** (2026-07-02): a 94-agent deep review — 16 subsystem code
reviewers reading line-by-line, 9 internet researchers, plus independent adversarial
verification of every critical/high finding (full findings:
`docs/reviews/2026-07-02-deep-review-findings.md`).

**Overall grade: C.** The bones were good — integer-cents money throughout, a real
clean-architecture intent, offline-first SQLite, a strict CI gate, and an engineering
culture honest enough to document its own known gaps. But the review found **the three
loops the app exists for were all broken in production**:

| Core loop                     | Status before this rebuild                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Monthly envelope budgeting    | **Broken** — no period rollover; envelopes vanished every payday                                                  |
| Multi-household collaboration | **Broken** — invite create _and_ accept both failed 100% of the time since migration 019                          |
| Cross-device sync of money    | **Corrupting** — envelope balances never synced from transactions; deletes could resurrect; concurrent edits lost |

Plus a `D+`-grade sync engine (10 per-table `merge_*` RPCs, client-clock last-write-wins,
three different timestamp formats compared against each other), a `D+`-grade Supabase
backend, and a long tail of money-correctness bugs (misparsed money input, non-atomic
debt payments, double-delete corruption, non-idempotent slip confirmation).

## 2. What the six slices delivered

| #   | Slice                                           | What shipped                                                                                                                                                                                                                                                                                   | State                                            |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Proving-ground scaffolding                      | Real-SQLite + real-Postgres test tiers added to CI (the `realsql`/`twodevice` tiers this whole rebuild was verified against); 5 real bugs fixed along the way                                                                                                                                  | DELIVERED + Play                                 |
| 2   | Schema baselines + contract tests               | Squashed server + local baseline migrations; the new oplog protocol's schema (`oplog`, `sync_cursor`, the four RPCs); CodeRabbit caught 1 Critical + 2 Major, fixed pre-merge                                                                                                                  | DELIVERED + Play                                 |
| 3   | UnitOfWork, derived balances, envelope scopes   | `envelopes.spent_cents` deleted — balances are now always derived from the transaction ledger (`getEnvelopeSpentCents`), closing the "balances never sync" corruption loop at the root; `UnitOfWork`/`createSyncedRepo` make one atomic local write = one atomic oplog append, by construction | DELIVERED + Play                                 |
| 4   | Rollover engine + wizard                        | Real period rollover (`StartNewPeriodUseCase`, deterministic cross-device `uuidv5` ids) replaces the "envelopes vanish every payday" bug — the monthly budgeting loop works again; found and fixed a real Baby-Step 1/3 regression along the way                                               | DELIVERED + Play                                 |
| 5   | SyncEngine + Realtime + DLQ inbox + boot rework | Production `SyncEngine`/`SyncScheduler` replace the old `merge_*`/LWW design; two-device convergence property harness against real Postgres as the risk gate; Sync Health/DLQ inbox UI; **remote deployed 2026-07-04** — the oplog baseline is live in production, not just locally            | DELIVERED + Play                                 |
| 6   | One-off fixes + tier-4 e2e + CD gate            | See below                                                                                                                                                                                                                                                                                      | in-review (this task; PR pending → merge → Play) |

Slice 6's six tasks:

1. `extract-slip` re-pointed off the dropped `user_households` table (broken by the
   slice-5 remote cutover) and redeployed.
2. `ConfirmSlipUseCase` atomicity fix — the last Critical carried from the original deep
   review (a multi-item slip confirmation could partially commit on failure).
3. Shared, locale-safe `parseMoneyInput` wired into all 4 money-entry screens — kills the
   `"1,234.56"` → R1.23 misparse class.
4. Slip-scanning camera FAB (was unreachable) + full password-reset flow.
5. `notify-event` rebuilt onto FCM HTTP v1 (the legacy API was shut down by Google in
   2024 — push was 100% dead).
6. **This task**: FCM delivery-priority hints restored; tier-4 authenticated e2e journey
   wired into CI; the CD-races-CI gap closed; final consolidation (this document +
   updated ADR + updated status doc).

## 3. The remote deployment

On 2026-07-04, with explicit owner authorization, the linked production Supabase project
was backed up (schema + data + roles — it held 0 household data and a handful of test
accounts, so this was a safe cutover) and dump-and-recreated onto the new oplog baseline.
`sync_push`/`sync_pull`/`sync_row_state`/`apply_server_op` are live; every old `merge_*`
RPC is gone. This is the single production action in the entire rebuild that required
(and received) explicit human sign-off before running, per the spec's own rule that a
destructive baseline squash against a real project is never an autonomous decision.

The cutover had one piece of fallout, closed within slice 6: edge functions weren't
redeployed as part of the swap, so `extract-slip` broke (fixed in slice 6 task 1).
`notify-event` was separately broken for an unrelated reason (the 2024 FCM legacy API
shutdown) and rebuilt in slice 6 task 5.

## 4. Before / after

|                       | Before (2026-07-02 review)                                                                                | After (this rebuild)                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Envelope balances     | Local `spent_cents` column, never synced from transactions — correct on one device, stale everywhere else | Always derived from the transaction ledger (`getEnvelopeSpentCents`) — no stored balance to desync, by construction |
| Period rollover       | Did not exist — envelopes disappeared every payday                                                        | `StartNewPeriodUseCase` + `RolloverWizard`, deterministic cross-device ids                                          |
| Sync protocol         | 10 per-table `merge_*` RPCs, client-clock LWW, 3 incompatible timestamp formats                           | One append-only, server-sequenced oplog; 4 generic RPCs; server-seq ordering, not client clocks                     |
| Invite create/accept  | Both failed 100% (param-name and grant mismatches from migration 019)                                     | Rebuilt on the new baseline's RLS/grants; server-sequenced, not affected by the old bugs                            |
| Money input           | `"1,234.56"` silently saved as R1.23                                                                      | `parseMoneyInput` rejects ambiguous input with an inline error, never coerces                                       |
| Debt payments         | Non-transactional stale-snapshot write; 3 independently-applied oplog ops (torn-write risk)               | Single local transaction, SQL-expression increments; `is_paid_off` server-derived — 2 ops                           |
| Slip confirmation     | Double-tap duplicated every transaction; multi-item commits could tear on failure                         | Idempotent; reads-first-then-one-transaction; real-driver rollback proven                                           |
| Push notifications    | Legacy FCM API (shut down by Google, 2024) — 100% dead                                                    | FCM HTTP v1, per-token send, dead-token pruning, delivery-priority hints                                            |
| Password reset        | Did not exist                                                                                             | Full deep-link-token flow                                                                                           |
| Slip-scan entry point | Unreachable (empty state referenced a button that didn't exist)                                           | Camera FAB reachable, consent-gated                                                                                 |
| e2e coverage          | Three journeys, none of which actually authenticated                                                      | Tier-4 authenticated journey: sign up → onboard → create envelope → add transaction → verify                        |
| CD safety             | `cd.yml` could publish to Play before `ci.yml`'s DB/e2e tiers (a separate workflow) had a chance to fail  | `build-and-publish` hard-depends on the full unit/integration/DB/e2e train within `cd.yml` itself                   |
| Remote backend        | Old `merge_*`-RPC schema                                                                                  | Oplog baseline live in production (deployed 2026-07-04)                                                             |

## 5. What's left

- **`FCM_SERVICE_ACCOUNT` secret** — `notify-event` is deployed and gracefully no-ops
  until the owner runs `supabase secrets set FCM_SERVICE_ACCOUNT='<service-account-json>'`.
  Live push does not fire before that. This is the only remaining action item that
  requires the human owner, not an agent.
- **`extract-slip` → `apply_server_op` routing** — its direct `.update()` calls on
  `slip_queue` still bypass the oplog (spec §6.2); only the membership check was fixed.
- **`user_fcm_tokens` is single-token-per-user** — a second device's sign-in silently
  replaces the first device's push token. No multi-device push today.
- **`RootNavigator` duplicate test files** (`root-navigator.test.tsx` /
  `RootNavigator.test.tsx`, case-differing) — overlapping coverage, should be
  consolidated.
- **`ConfirmSlipUseCase` validation duplication** — flagged during slice 6 task 2's
  review; extract to a shared helper if a third call site appears.
- **Compaction/retention** — the oplog replays full history on every fresh install; no
  snapshotting yet. Explicit deferral (ADR §6.5), revisit trigger: ~50,000 ops for a
  single household.
- **`RestoreService` retirement** — still the only reinstall/household-discovery path
  until a "list my households" pull RPC exists; retire it once that lands.
- **Tier-4 e2e first real run** — the authenticated journey (`e2e/journeys/
authenticatedJourney.e2e.ts`) is written, type-checked, and lint-checked, but has not
  been executed anywhere yet (no Android emulator was available while building it). Its
  first real run will be the next CI push to `master`.

## References

- Game plan / original review verdict: `docs/200x-game-plan.md`
- Full findings: `docs/reviews/2026-07-02-deep-review-findings.md`
- Design spec: `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md`
- Protocol contract: `docs/adr/0001-oplog-sync-protocol.md`
- Slice/task execution detail: `docs/plan-execution-status.md`
- Slice 6 plan: `docs/superpowers/plans/2026-07-04-slice6-oneoffs-tier4.md`
- This task's detailed report: `.superpowers/sdd/task-6-report.md` (local, not committed)
