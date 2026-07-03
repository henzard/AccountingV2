# Remediation Queue — AccountingV2

**Last updated:** 2026-06-20 (merged subagent reviews)  
**Branch:** `feat/comprehensive-qa-test-suite`  
**Baseline:** 236 suites · 2,013 tests · all green  
**Coverage:** 89.38% lines · 78.23% branches · 84.30% functions · 88.91% statements

**Sources:** QA Lead cycles (Jun 2026), [`/weighsoft-quality-review` subagent](83c5e57f-a1b7-4c34-9ba7-92163b5f4ee4), [`/weighsoft-security-review` Red Team](fd042b87-566d-4f9c-8d03-5e6ea8c66947), `docs/known-gaps/*`, `docs/findings.json`.

**Totals:** Tier 0 = 12 · Tier 1 (quality) = 35 · Tier 2 (security) = 18 open + 5 verified-fixed · Tier 3 = 8 backlog refs

---

## How to use this queue

| Status        | Meaning                             |
| ------------- | ----------------------------------- |
| `open`        | Not started — needs fix or decision |
| `in-progress` | Someone is working it               |
| `fixed`       | Shipped with regression test        |
| `deferred`    | Accepted risk / future sprint       |
| `wontfix`     | Intentional by design               |

**Priority:** Fix `Critical` and `High` before merge to production. Architectural items (Tier 0) need a dedicated sync sprint — do not pretend tests alone resolve them.

---

## Tier 0 — Architectural known gaps (sync / data integrity)

Documented in tests with `KNOWN-GAP` markers. Full write-ups: [`docs/known-gaps/lww-data-loss.md`](known-gaps/lww-data-loss.md), [`docs/known-gaps/restore-ordering.md`](known-gaps/restore-ordering.md).

| ID          | Sev    | Status | Title                                              | Location                                          | Fix (summary)                               | Effort |
| ----------- | ------ | ------ | -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------- | ------ |
| LWW-001     | High   | open   | Concurrent `spentCents` increments lost to LWW     | `merge_envelope` RPC                              | Delta-based SQL for counter fields          | L      |
| LWW-002     | High   | open   | Same as LWW-001 — Kruger multi-user scenario       | `src/__tests__/sync/concurrent-user-sync.test.ts` | Same as LWW-001                             | L      |
| LWW-003     | High   | open   | Debt `outstandingBalanceCents` absolute overwrite  | `merge_debt` RPC                                  | Server-side `original - total_paid`         | M      |
| LWW-004     | Medium | open   | No field-level merge — whole row dropped           | All `merge_*` RPCs                                | Per-column timestamps or CRDT               | L      |
| LWW-005     | Medium | open   | Merge RPC returns success when LWW rejects row     | `SyncOrchestrator.ts` + RPCs                      | Return `conflict` flag + user toast         | M      |
| RESTORE-001 | High   | open   | Restore overwrites local dirty rows                | `RestoreService.ts` ~177                          | `onConflictDoNothing` when `isSynced=false` | M      |
| RESTORE-002 | Medium | open   | `pending_sync` not cleared after restore overwrite | `RestoreService.ts`                               | DELETE stale pending rows post-restore      | S      |
| RESTORE-003 | High   | open   | Row is `isSynced=false` but holds remote data      | `restoreTable()`                                  | Combine RESTORE-001 + conditional conflict  | M      |
| SOFTDEL-001 | High   | open   | Hard DELETE locally, no tombstone                  | `DeleteTransactionUseCase.ts`                     | Soft-delete + query filters                 | L      |
| SOFTDEL-002 | High   | open   | Hard DELETE on Supabase push                       | `SyncOrchestrator.ts:186`                         | Tombstone upsert instead of `.delete()`     | L      |
| SOFTDEL-003 | High   | open   | Deletes don't propagate to offline devices         | Sync + restore                                    | End-to-end tombstone pipeline               | L      |
| SOFTDEL-004 | Medium | open   | Restore never purges orphaned local rows           | `RestoreService.restoreTable()`                   | Delete locals not in remote set             | M      |

---

## Tier 1 — Quality review (`/weighsoft-quality-review` 2026-06-20)

**Health scores (from coverage + [quality subagent](83c5e57f-a1b7-4c34-9ba7-92163b5f4ee4)):**

| Layer          | Score | Notes                                                          |
| -------------- | ----- | -------------------------------------------------------------- |
| Tests          | 82    | 2,013 tests; API replica drift; mock-only “integration” suites |
| UX             | 74    | Several screens still show empty state on hook error           |
| UI             | 80    | Theme tokens mostly adopted; slip flow uneven                  |
| API            | 76    | Edge functions auth'd; Jest replicas lag Deno prod             |
| Backend        | 84    | Use cases clean; sync orchestration gaps                       |
| Database       | 79    | Missing restore indexes; local SQLite FK off                   |
| Sync (Agent G) | 62    | No pull channel; DLQ silent; batch limit 100                   |

Excludes Tier 0 IDs (LWW/RESTORE/SOFTDEL). See also Tier 2 for security overlap on RLS/PostgREST.

### Sync & orchestration

| ID          | Sev      | Domain | Status | Title                                                                    | Location                                         | Fix                                                                                                           | Effort |
| ----------- | -------- | ------ | ------ | ------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------ |
| QR-SYNC-001 | Critical | sync   | open   | No incremental pull — other members' changes never reach local replicas  | `App.tsx:88-179`, `RestoreService.ts`            | Add `PullService` (cursor/`updated_at` per table) on reconnect, household switch, foreground; skip dirty rows | L      |
| QR-SYNC-002 | High     | sync   | open   | Module-level `isSyncRunning` silently drops overlapping sync calls       | `SyncOrchestrator.ts:63,76`                      | Queue/mutex: chain runs or drain until empty                                                                  | M      |
| QR-SYNC-003 | High     | sync   | open   | `.limit(100)` with no loop — item 101+ waits indefinitely                | `SyncOrchestrator.ts:92-93`                      | Re-query until empty or paginate with cursor                                                                  | S      |
| QR-SYNC-004 | High     | sync   | open   | `deadLettered` count never surfaced to user                              | `App.tsx:127-136`, `SyncOrchestrator.ts:146-151` | Toast + Settings “Sync issues” list with retry                                                                | M      |
| QR-SYNC-005 | Medium   | sync   | open   | Partial restore failures silent                                          | `RestoreService.ts:168,133`                      | Log per-table failures; return `{ partial, failedTables }`                                                    | S      |
| QR-SYNC-006 | High     | sync   | open   | `isSynced=true` without `updatedAt` snapshot guard (R2 claim unverified) | `SyncOrchestrator.ts:224-229`                    | `WHERE updated_at = snapshot` on mark-synced; reconcile `findings.json`                                       | M      |
| QR-SYNC-007 | Medium   | sync   | open   | `spentCents` can drift from `SUM(transactions)`                          | Domain + sync                                    | Reconciliation on boot                                                                                        | M      |

### Tests & coverage

| ID          | Sev    | Domain | Status | Title                                                                        | Location                                      | Fix                                                 | Effort |
| ----------- | ------ | ------ | ------ | ---------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------- | ------ |
| QR-TEST-001 | High   | tests  | open   | `merge-rpc-contracts.test.ts` duplicates map, never calls `SyncOrchestrator` | `merge-rpc-contracts.test.ts:22-35`           | Mock Supabase; assert `rpc(name,{r})` per table     | M      |
| QR-TEST-002 | High   | tests  | open   | `notify-event-handler` replica skips auth/membership/IDOR checks             | `notify-event-handler.test.ts:27-69`          | Match prod handler or shared module + 401/403 tests | M      |
| QR-TEST-003 | High   | tests  | open   | Deno notify-event suite only tests payload helper                            | `notify-event/__tests__/notify-event.test.ts` | Full handler tests (auth, membership, FCM)          | M      |
| QR-TEST-004 | Medium | tests  | open   | `non-atomic-writes` tautological spentCents assertions                       | `non-atomic-writes.test.ts:237-260`           | Assert rollback when update throws                  | S      |
| QR-TEST-005 | High   | tests  | open   | `babyStepsSyncIntegration` uses pure mock DB, not SQLite                     | `babyStepsSyncIntegration.test.ts`            | One in-memory Drizzle round-trip test               | L      |
| QR-TEST-006 | High   | tests  | open   | `CreateTransactionUseCase` “updates spentCents” only checks call count       | `CreateTransactionUseCase.test.ts:67-74`      | Assert `.set({ spentCents: prior + amount })`       | S      |
| QR-TEST-007 | Medium | tests  | open   | `snowball-lifecycle` mutates entities in memory, bypasses use case           | `snowball-lifecycle.test.ts:54-64`            | Drive via `LogDebtPaymentUseCase`                   | M      |
| QR-TEST-008 | Medium | tests  | open   | Slip RPC test uses `imageCount`; schema has `image_uris`                     | `merge-rpc-contracts.test.ts:156-173`         | Fix fixture + assert `image_uris` in payload        | S      |
| QR-TEST-009 | High   | tests  | open   | Zero coverage: `LineItemRow.tsx`                                             | `slipScanning/components/LineItemRow.tsx`     | Component tests for edit/validation                 | S      |
| QR-TEST-010 | High   | tests  | open   | Low coverage: `SlipCaptureScreen` ~47%                                       | `SlipCaptureScreen.tsx`                       | Camera permission, multi-shot, errors               | M      |
| QR-TEST-011 | High   | tests  | open   | No Detox E2E on PR branches                                                  | `ci.yml:42-43`                                | Smoke E2E on PR or nightly                          | M      |
| QR-TEST-012 | Medium | tests  | open   | No sync property tests (R7)                                                  | —                                             | Fault-injection harness                             | L      |
| QR-TEST-013 | Medium | tests  | open   | Scenario seed not run against live Supabase                                  | `scenarioSeed.ts`                             | Staging integration (4 users, 2 HH, 200 tx)         | L      |

### UX / accessibility

| ID        | Sev    | Domain | Status | Title                                                           | Location                            | Fix                                         | Effort |
| --------- | ------ | ------ | ------ | --------------------------------------------------------------- | ----------------------------------- | ------------------------------------------- | ------ |
| QR-UX-001 | High   | ux     | open   | `BudgetScreen` shows empty state on hook error                  | `BudgetScreen.tsx:35,73-78`         | Error banner + retry (like TransactionList) | S      |
| QR-UX-002 | High   | ux     | open   | `SinkingFundsScreen` same                                       | `SinkingFundsScreen.tsx:31,47-52`   | Error banner + retry                        | S      |
| QR-UX-003 | Medium | ux     | open   | `ForecastScreen` same                                           | `ForecastScreen.tsx:33,55-57`       | Error banner + retry                        | S      |
| QR-UX-004 | High   | ux     | open   | `DashboardScreen` no error from hooks                           | `DashboardScreen.tsx:50-51`         | Inline error on hero/budget sections        | M      |
| QR-UX-005 | Medium | ux     | open   | `MeterDashboardScreen` failures show blank cards                | `MeterDashboardScreen.tsx:37-65`    | `error` state + retry                       | S      |
| QR-UX-006 | Medium | ux     | open   | `LogPaymentScreen` missing debt shows disabled form, no message | `LogPaymentScreen.tsx:29-41`        | “Debt not found” + back                     | S      |
| QR-UX-007 | Medium | ux     | open   | `EnvelopeCard` missing a11y label/role                          | `EnvelopeCard.tsx:29`               | `accessibilityLabel` on ripples             | S      |
| QR-UX-008 | Medium | ux     | open   | Delete `IconButton` below 24×24 target                          | `TransactionListScreen.tsx:158-164` | `size={24}` or hitSlop                      | S      |

### API, database, tooling

| ID          | Sev    | Domain       | Status | Title                                           | Location                                                    | Fix                                                               | Effort |
| ----------- | ------ | ------------ | ------ | ----------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| QR-API-001  | High   | api          | open   | notify-event missing payload validation         | `notify-event/index.ts:42-43`                               | Required fields → 400; try/catch JSON                             | S      |
| QR-API-002  | High   | api          | open   | Jest handler replicas drift from Deno prod      | `extract-slip-gaps.test.ts`, `notify-event-handler.test.ts` | Export shared `handle()` importable by both                       | M      |
| QR-DB-001   | High   | database     | open   | Missing indexes on restore hot paths            | `RestoreService.ts:163-166`                                 | `idx_transactions_household_id`, `idx_envelopes_household_period` | S      |
| QR-DB-002   | Medium | database     | open   | No index on `pending_sync` queue columns        | `pendingSync.ts`, `SyncOrchestrator.ts:83-92`               | Composite index on DLQ/retry/created_at                           | S      |
| QR-DB-003   | Medium | database     | open   | Local SQLite: `PRAGMA foreign_keys` not enabled | `src/data/local/`                                           | Enable FK + Drizzle declarations                                  | M      |
| QR-CODE-001 | Medium | code-quality | open   | GitHub Actions floating `@v4` tags              | `ci.yml`, `cd.yml`                                          | Pin to commit SHA                                                 | S      |
| QR-CODE-002 | Low    | code-quality | open   | `findings.json` metrics stale                   | `docs/findings.json`                                        | Refresh to 2013 tests + current fixes                             | S      |

---

## Tier 2 — Security review (`/weighsoft-security-review` Red Team 2026-06-20)

> **Caveat:** Automated + LLM review reduces risk but cannot prove the system unhackable. Human review required for auth, money, and multi-tenant isolation.

### Verified fixed (do not re-open)

| Item                                           | Fix                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| notify-event IDOR (push to any user)           | Target `userId` household membership check — `notify-event/index.ts:60-75` |
| merge_slip_queue schema mismatch               | Migration `018_security_fixes.sql`                                         |
| merge_slip_queue creator-only authz            | Restored in 018                                                            |
| notify-event secret leakage                    | Generic `Server misconfigured` response                                    |
| extract-slip auth + household + slip ownership | `extract-slip/index.ts:65-117`                                             |

### Open findings ([security subagent](fd042b87-566d-4f9c-8d03-5e6ea8c66947))

**Fix first:** SEC-RT-001 → SEC-RT-002 → SEC-RT-003 → SEC-RT-004 → SEC-RT-005/006.

| ID         | Sev          | Status | Title                                                                 | Location                                        | OWASP / CWE     | Exploit / fix                                                                                 | Confidence                |
| ---------- | ------------ | ------ | --------------------------------------------------------------------- | ----------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------- | ------------------------- |
| SEC-RT-001 | **Critical** | open   | Any user can join any household via direct `household_members` INSERT | `005_security_and_sync_correctness.sql:173-175` | A01 / CWE-862   | RLS only checks `user_id = auth.uid()` — no invite. Restrict to `accept_household_invite` RPC | confirmed                 |
| SEC-RT-002 | **Critical** | open   | Direct `user_households` INSERT grants access to any household        | `002_rls_policies.sql:17-18`                    | A01 / CWE-639   | Tighten WITH CHECK or remove client INSERT; trigger-only population                           | confirmed                 |
| SEC-RT-003 | High         | open   | Direct PostgREST PATCH bypasses merge RPC LWW guards                  | `002_rls_policies.sql:27-55`, `011`             | API3 / CWE-841  | REVOKE table DML for `authenticated`; writes only via `merge_*` RPCs                          | confirmed                 |
| SEC-RT-004 | High         | open   | Migration 018 dropped completed-slip overwrite protection             | `018_security_fixes.sql:59-72`                  | A04 / CWE-362   | Restore 007 guard: block overwrite when `status='completed'`                                  | confirmed                 |
| SEC-RT-005 | High         | open   | `inv_insert` allows invites for households user doesn't belong to     | `008_phase2_data_integrity.sql:13-15`           | A01 / CWE-285   | WITH CHECK household membership + owner role                                                  | confirmed                 |
| SEC-RT-006 | High         | open   | `lookup_invite_by_code` brute-forceable, no expiry filter             | `008_phase2_data_integrity.sql:24-46`           | A07 / CWE-307   | Filter expired/used; rate limit; increase entropy                                             | confirmed                 |
| SEC-RT-007 | Medium       | open   | notify-event push spam by any household member                        | `notify-event/index.ts:42,101-117`              | A04 / CWE-799   | Rate limit; max title/body length; server-triggered only                                      | confirmed                 |
| SEC-RT-008 | Medium       | open   | Any member can set `user_level=3` via merge_household                 | `016_lww…sql:216`                               | A01 / CWE-269   | Remove from client-writable merge; server-computed                                            | confirmed                 |
| SEC-RT-009 | Medium       | open   | `getSession()` may accept revoked JWT without server check            | `SupabaseAuthService.ts:31-39`                  | A07 / CWE-613   | Use `getUser()` on foreground + sensitive paths                                               | confirmed                 |
| SEC-RT-010 | Medium       | open   | Local SQLite unencrypted — full financial history on rooted device    | `src/data/local/db.ts:7-8`                      | MASVS / CWE-311 | SQLCipher + Keystore-derived key                                                              | confirmed                 |
| SEC-RT-011 | Medium       | open   | extract-slip accepts unlimited `images_base64` array length           | `extract-slip/index.ts:80-83`                   | A04 / CWE-400   | Reject if length ∉ [1,5] before rate-limit                                                    | confirmed                 |
| SEC-RT-012 | Medium       | open   | Rate-limit griefing via pending slip rows                             | `008…sql:81-88`                                 | A04 / CWE-770   | Count only processing/completed; per-user cap                                                 | confirmed                 |
| SEC-RT-013 | Medium       | open   | Members can inject fake `audit_events`                                | `005…sql:483`                                   | A09 / CWE-117   | Deny authenticated INSERT; service-role triggers only                                         | confirmed                 |
| SEC-RT-014 | Medium       | open   | DELETE sync bypasses merge RPC; silent zero-row delete                | `SyncOrchestrator.ts:185-188`                   | A01 / CWE-863   | Route via `delete_*` RPC; fail if 0 rows                                                      | needs manual confirmation |
| SEC-RT-015 | Low          | open   | FCM legacy HTTP API deprecated                                        | `notify-event/index.ts:103`                     | A02 / CWE-1104  | Migrate to HTTP v1 + OAuth2                                                                   | confirmed                 |
| SEC-RT-016 | Low          | open   | CD pipeline omits Deno edge tests                                     | `cd.yml` vs `ci.yml`                            | CICD / CWE-693  | Add `deno test supabase/functions/` to cd-gate                                                | confirmed                 |
| SEC-RT-017 | Low          | open   | Firebase Test Lab uses `continue-on-error: true`                      | `cd.yml:117`                                    | CICD / CWE-693  | Remove once API enabled                                                                       | confirmed                 |
| SEC-RT-018 | Low          | open   | Password policy client-only (≥8 chars)                                | `SignUpScreen.tsx:37-39`                        | A07 / CWE-521   | Enforce in Supabase Auth dashboard                                                            | needs manual confirmation |

**Cross-refs:** SEC-RT-004/014 overlap SOFTDEL/restore tiers. SEC-RT-006 overlaps Tier 3 #7. Android backup rules verified sound — residual risk is SEC-RT-010 (local DB encryption).

---

## Tier 3 — Backlog from prior audit (`docs/findings.json` → `next[]`)

| #   | Item                               | Sev    | Status             |
| --- | ---------------------------------- | ------ | ------------------ |
| 1   | Pin GitHub Actions to commit SHAs  | Medium | open → QR-CODE-001 |
| 2   | FCM HTTP v1 migration              | Medium | open → SEC-RT-015  |
| 3   | Sync property tests (R7)           | Medium | open → QR-TEST-012 |
| 4   | Detox E2E for financial flows      | High   | open → QR-TEST-011 |
| 5   | Maintain >80% line coverage        | Low    | fixed (89%)        |
| 6   | Enable SQLite foreign keys         | Medium | open → QR-DB-003   |
| 7   | Rate limit `lookup_invite_by_code` | Medium | open → SEC-RT-006  |
| 8   | Pull-based convergence channel     | Medium | open → QR-SYNC-001 |

---

## Work completed (reference — do not re-queue)

| Date       | Work                                                                   | Tests / evidence                    |
| ---------- | ---------------------------------------------------------------------- | ----------------------------------- |
| 2026-06-19 | Comprehensive test suite (+772 tests)                                  | 1,982 → 2,013 total                 |
| 2026-06-19 | Migration 017 — merge RPC regressions from 016                         | `migration-016-regressions.test.ts` |
| 2026-06-19 | Migration 018 — security fixes (slip_queue, user_households)           | `security-audit-findings.test.ts`   |
| 2026-06-19 | Atomic transaction create/delete (`db.transaction()`)                  | `non-atomic-writes.test.ts`         |
| 2026-06-19 | notify-event auth + IDOR fix                                           | Edge function + security tests      |
| 2026-06-19 | Snowball projector rewrite + meter duplicate guard                     | Domain tests                        |
| 2026-06-19 | Screen error handling (TransactionList, BusinessExpense, doSave catch) | Screen tests                        |
| 2026-06-20 | QA Cycle 1: 8 defects fixed                                            | Commit `09df8ba`                    |
| 2026-06-20 | QA Cycle 2: zero new defects                                           | Two clean cycles                    |

---

## Recommended sprint order

1. **Security blockers:** SEC-RT-001 + SEC-RT-002 (unauthorized household join) → SEC-RT-003 (PostgREST bypass) → SEC-RT-004 (slip regression).
2. **Sync sprint (Tier 0):** RESTORE-001 → SOFTDEL pipeline → LWW deltas + QR-SYNC-001 (pull service).
3. **UX error sweep:** QR-UX-001 through QR-UX-004 + QR-SYNC-004 (DLQ visibility).
4. **Test hardening:** QR-TEST-002/003 (edge functions), QR-TEST-011 (Detox E2E gate).
5. **Hardening:** SEC-RT-006 (invite brute-force), QR-CODE-001 (SHA pins), SEC-RT-015 (FCM v1).

---

## Related documents

- [`docs/findings.json`](findings.json) — repo-review grade B audit (needs refresh)
- [`docs/audit-report.html`](audit-report.html) — visual audit report
- [`docs/known-gaps/lww-data-loss.md`](known-gaps/lww-data-loss.md)
- [`docs/known-gaps/restore-ordering.md`](known-gaps/restore-ordering.md)
- [`.claude/skills/weighsoft-qa-lead/SKILL.md`](../.claude/skills/weighsoft-qa-lead/SKILL.md) — QA Lead protocol used for cycles
