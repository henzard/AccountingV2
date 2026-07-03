# Spec Review — 2026-07-03

**Documents under review:**

- Spec: `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md`
- Plan (slice 1): `docs/superpowers/plans/2026-07-03-proving-ground-scaffolding.md`

**Method (weighsoft-spec-review):** Phase 0 sectioning/risk-rank → Phase 1 intrinsic quality (1 agent) → Swarm A internet accuracy (1 agent, 12 load-bearing claims, primary sources) → Swarm B code conformance (adversarial agent, earlier session pass) + reverse traceability code→spec (1 agent, 40 surfaces) → Phase 4 NFR coverage gate (1 agent) → Phase 5 adjudication (this doc) → fixes applied same-session. Deterministic tools: grep/diff against real files; Spectral/axe/Lighthouse N/A (no OpenAPI doc, no web UI in scope). Discipline lenses exercised: DB, backend, API(RPC), security, performance, UX (where the spec touches UI), reliability/NFR. UI/a11y lenses: N/A for this spec's scope (data-layer rebuild; UI items are one-off fixes with their own criteria).

**Headline:** 46 findings adjudicated → 3 plan blockers, 1 spec design contradiction (High), 9 protocol gaps, 8 undocumented surfaces, 13 NFR gaps, 1 stale dependency claim. **All fixed in the spec/plan same-session.** 0 findings required a human product-intent decision (one resolution flagged for veto, below).

---

## 1. Adjudicated traceability matrix

Verdict legend — A (accuracy vs internet): ✔ Accurate / ✖ Inaccurate / ⏳ Outdated. B (vs code): ✔ Implemented-as-claimed / ✖ Wrong / ⬚ Gap. Adjudication: severity → action. All "FIXED" actions are already applied.

### Blockers (would have failed or misled implementation)

| #   | Section | Finding                                                                                                                                                               | A   | B   | Severity | Action                                                                                             |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | -------- | -------------------------------------------------------------------------------------------------- |
| 1   | Plan T3 | Two `008_*.sql` files collide on `schema_migrations` version PK → fresh `db reset` dies (CLI source: `^([0-9]+)_` version regex + `version` PK)                       | ✔   | ✖   | Critical | FIXED: T3 renames `008_user_preferences`→`010`; citation corrected to CLI-source mechanism         |
| 2   | Plan T4 | `005:79` trigger reads `NEW.created_at`; `household_members` has only `joined_at` → EVERY fresh-DB member insert fails (also breaks invites & merge on fresh deploys) | —   | ✖   | Critical | FIXED: T4 expects the failure, adds migration `020_fix_member_sync_trigger` (uses `NEW.joined_at`) |
| 3   | Plan T2 | `envelopes.target_amount_cents`/`target_date` in Drizzle schema but in NO local migration — conformance test could never pass as planned                              | —   | ✖   | High     | FIXED: T2 pre-declares the failure, adds local migration `0010_envelope_targets`                   |
| 4   | Plan T1 | better-sqlite3 ≥12.10 dropped Node 20 prebuilds (Node 20 left LTS) → unpinned install source-compiles, fails on Windows w/o VS Build Tools                            | ⏳  | —   | High     | FIXED: pinned `better-sqlite3@~12.9.1` with rationale                                              |

### Spec design contradictions (Phase 1)

| #   | Sections                         | Finding                                                                                                                             | Severity | Action                                                                                                                                                        |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | §3 vs §6.6                       | Rollover wizard "adjust allocations" vs "identical inserts" idempotency — divergent offline adjustments would be silently discarded | High     | FIXED: commit shape = unadjusted deterministic-id inserts + adjustments as separate update ops merged by seq order. **Flagged for owner veto** (see §4 below) |
| C2  | §5 tier 2 vs build order vs plan | Contract-test placement stated divergently in 3 places                                                                              | Medium   | FIXED: tier-2 def annotated "slice 2"; plan "deviation" reworded to "per spec build order"                                                                    |
| C3  | §3 vs §5                         | "celebrations subscribe" vs celebrations out-of-scope                                                                               | Medium   | FIXED: publisher + existing-notification re-point in scope; new subscribers Phase 2                                                                           |
| C4  | §1 vs §6.3                       | "membership once per batch" vs per-household-group validation                                                                       | Medium   | FIXED: §1 now defers to §6.3                                                                                                                                  |
| C5  | §1 vs §2 vs §6.9                 | Op contract defined divergently (`table` vs `table_name`; `v` only in §6.9)                                                         | High     | FIXED: §1 is now the single canonical wire-op definition incl. `v: 1`; `table_name` documented as the stored column for wire field `table`                    |
| C6  | §1 vs §4                         | Duplicate pusher-trigger lists already drifted (NetInfo missing in §1)                                                              | Low      | FIXED: §1 defers to §4's single list                                                                                                                          |
| C7  | §5 tier 1 vs build order         | Tier-1 test content (repos/UnitOfWork/rollover) can't exist in slice 1 which claims "tiers 1–2 in CI"                               | Medium   | FIXED: "tier = harness + tests accruing per slice" note added                                                                                                 |
| C8  | §5 Risks                         | Derived-balance "measured" had no pass/fail criterion (untestable gate)                                                             | Medium   | FIXED: < 15 ms on 10k-ledger in tier-1 harness, else trigger-maintained column, decision in slice-3 plan                                                      |
| C9  | §6.10                            | "re-pulls the affected row" used an undefined mechanism (pull is cursor-based)                                                      | Medium   | FIXED: read-only `sync_row_state(...)` RPC defined                                                                                                            |
| C10 | Plan T1/T3                       | Commit-message skip-path mismatch (T1 S10); contingency-edited migrations never staged (T3 S5)                                      | Medium   | FIXED: conditional commit message; `supabase/migrations/` added to `git add`                                                                                  |
| C11 | Plan Done-means                  | Asserted CI runs realsql with no step verifying it                                                                                  | Low      | FIXED: `npx jest --listTests` verification added to T1 S9                                                                                                     |

### Swarm A — internet accuracy (12 claims)

| Claim                                                                    | Verdict       | Note                                                                                                                          |
| ------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Advisory-lock fix for bigserial visibility race                          | ✔ (2 caveats) | FIXED: §6.1 now requires ALL writers (incl. `apply_server_op`) take the lock; `hashtextextended` internal-function note added |
| bigserial pre-commit assignment / outbox race is real                    | ✔             | —                                                                                                                             |
| Supabase CLI version-PK collision mechanism                              | ✔             | Citation corrected (issues #2564/#4417 were wrong root causes; CLI source is the evidence)                                    |
| `supabase test db` no-tests behavior version-dependent                   | ✔             | Plan already hedges (pgTAP step lands with first test)                                                                        |
| `setup-cli@v1`                                                           | ⏳            | FIXED: `@v2`                                                                                                                  |
| pgTAP + `request.jwt.claims` auth simulation                             | ✔             | JSON-claims form works via `auth.uid()` coalesce fallback                                                                     |
| SQLite non-constant ADD COLUMN default error                             | ✔             | Exact message confirmed                                                                                                       |
| Jest 30 multi-project / root-only coverageThreshold / `--selectProjects` | ✔             | Plan places everything correctly                                                                                              |
| drizzle-orm `getTableConfig`/`is`/`SQLiteTable` exports                  | ✔             | Verified against installed 0.45.2                                                                                             |
| Realtime postgres_changes needs publication + RLS SELECT                 | ✔             | Matches §6.7                                                                                                                  |
| FCM legacy shutdown 2024; HTTP v1 from Deno                              | ✔             | Supabase official example exists                                                                                              |
| UUIDv5 in Expo                                                           | ✔ (nit)       | FIXED: §6.6 names the `uuid` package's `v5()` (expo-crypto can't do v5)                                                       |
| expo-splash-screen current API                                           | ✔             | —                                                                                                                             |

### Swarm B reverse — undocumented code surfaces (8)

| Surface                                                                                                                                   | Why it mattered                                                                                               | Action                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `user_consent` (+ server table + repo + `merge_user_consent`)                                                                             | Per-user table (no household_id) structurally can't ride the household oplog; surviving slip flow gates on it | FIXED: §8 per-user-table exception (direct RLS-scoped DML for `user_preferences`/`user_consent`/`user_fcm_tokens`) |
| `extract-slip` reads deleted `user_households` (index.ts:89)                                                                              | Surviving function breaks when the table dies                                                                 | FIXED: §6.2 re-points to `private.is_household_member`                                                             |
| AuditLogger in 9 screens; Enqueuer in MeterSetupStep; RestoreService in JoinHouseholdScreen; raw `spentCents` column selects in 2 screens | "Domain rewired" (slice 3) never covered presentation                                                         | FIXED: §8 + build-order slice 3 now says "domain AND presentation call sites"                                      |
| `user_preferences` theme sync                                                                                                             | In no fate list; baseline could silently drop it                                                              | FIXED: §8 (in baseline, per-user exception)                                                                        |
| EMF reconcile store/use cases (written by deleted SyncOrchestrator)                                                                       | Orphaned mechanism                                                                                            | FIXED: §8 — deleted; persistent-EMF scope obsoletes it                                                             |
| Local notification scheduler (payday preflight overlaps rollover wizard)                                                                  | Unstated fate                                                                                                 | FIXED: §8 — survives; preflight deep-links to wizard (slice 4)                                                     |
| Slip-cleanup cron logs failures into deleted `audit_events`                                                                               | Surviving cron, dead error sink                                                                               | FIXED: §6.2 — server-only `job_log` table                                                                          |
| `ask-advisor`/`process-slip` are empty `.gitkeep` dirs (spec audited phantom code)                                                        | Spec inaccuracy                                                                                               | FIXED: §6.2 — placeholders deleted in slice 6                                                                      |

Also resolved: `extractSlipContract.ts` survives (moves); existing e2e journeys superseded in slice 6; NetworkObserver/`isOnline` banner ownership → SyncEngine (§8); `is_synced` columns dropped in baseline (§2).

### Phase 4 — NFR gaps (13)

| Gap                                                                        | Sev  | Action                                                                       |
| -------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------- |
| No RPC timeouts — hung call deadlocks the single-flight guard forever      | High | FIXED: §7.1 (30 s AbortController, release guard, transient)                 |
| Right-to-erasure vs immutable oplog-as-audit-trail (Play account deletion) | High | FIXED: §7.3 (hard-delete/redact ops; nothing may assume append-only-forever) |
| Puller error/backoff unspecified                                           | Med  | FIXED: §7.2                                                                  |
| Duplicate `op_id` resend must ack `applied`, not `rejected`                | Med  | FIXED: §6.11                                                                 |
| No sync telemetry / payload-PII log rule                                   | Med  | FIXED: §7.4                                                                  |
| Local pushed ops never pruned                                              | Med  | FIXED: §2 (prune on ack)                                                     |
| Dev-install transition only in plan, not spec                              | Med  | FIXED: §7.10                                                                 |
| Money grammar not concrete (ZA comma-decimal)                              | Low  | FIXED: §7.8                                                                  |
| No server cap on `p_limit`                                                 | Low  | FIXED: §7.5 (max 500)                                                        |
| Single-process SQLite assumption unstated                                  | Low  | FIXED: §7.6                                                                  |
| `device_id` nature undefined (Play data-safety)                            | Low  | FIXED: §7.7 (app-scoped random UUID)                                         |
| No rollback/kill-switch pre-launch — decision, not accident                | Low  | FIXED: §7.9 (accepted risk, recorded)                                        |
| Plan's engineering constraints didn't bind slices 2–6                      | Low  | FIXED: decisions-log row                                                     |

Explicitly verified as already covered (no gap): app-kill mid-pull cursor semantics, Realtime-as-nudge fallback, cursor storage sensitivity, clock-free ordering, pusher batch size.

## 2. Per-discipline summary

| Lens               | Verdict                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB / migrations    | ⛔→✅ 3 real live bugs found by the review itself (008 collision, 005 trigger, envelope-column drift) — all now pre-declared + fixed in the slice-1 plan |
| Backend / protocol | ⚠️→✅ 1 High contradiction (rollover idempotency) + op-contract single-sourcing + 11 protocol/NFR clauses added                                          |
| API (RPCs)         | ✅ contract-test placement fixed; `sync_row_state` + duplicate-ack semantics defined                                                                     |
| Security           | ✅ per-user-table RLS exception documented; device_id + PII-in-logs rules added; erasure commitment added                                                |
| Performance        | ✅ derived-balance gate now has a threshold; pull caps added                                                                                             |
| UX                 | ✅ (scope-limited) envelope-chip criterion made testable; DLQ/rollover flows spec'd                                                                      |
| a11y / UI          | N/A for this spec (data-layer rebuild) — game-plan Phase 2 owns the a11y sweep                                                                           |

## 3. Requirements-quality summary (Phase 1)

Both docs graded well above average on testability (plan steps quote exact expected failure messages). 6 contradictions (C1–C6), 2 untestable gates, glossary drift on `op`/`tier`/`pull` — all fixed. Zero placeholder/TBD defects found.

## 4. Escalations to the spec owner

**None blocking.** One resolution to veto if you disagree:

- **C1 (rollover conflicts):** I chose _"unadjusted copy-forward inserts + adjustments as separate update ops, merged by seq order"_ — meaning if both partners roll the same period offline and adjust the same envelope differently, the later-synced adjustment wins (standard field-level LWW, deterministic). The alternative was first-device-wins-wholesale (simpler, but silently discards the second device's entire adjustment set). Current spec text implements the former.

## 5. Verification trail

- Swarm B blockers independently re-verified by the orchestrator against raw files before any fix was applied (`005:79` trigger column, missing `target_amount_cents` grep, 008/010 diff).
- All fixes applied to the spec/plan in this session; see git history of `docs/superpowers/` on branch `docs/oplog-sync-correctness-spec`.
- Re-loop note: slice-1 execution itself is the re-verification for the three DB blockers (the plan's expected-failure steps now encode them).
