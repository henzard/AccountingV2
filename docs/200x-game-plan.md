# AccountingV2 — The 200x Game Plan

**Date:** 2026-07-02
**Method:** 94-agent deep review — 16 subsystem code reviewers (line-level), 9 internet researchers (competitors, stack, sync, AI, gamification, security, a11y, monetization), plus independent adversarial verification of every critical/high finding. Full findings: [docs/reviews/2026-07-02-deep-review-findings.md](reviews/2026-07-02-deep-review-findings.md).

---

## 1. The Verdict

**Overall grade: C.** The bones are good — integer-cents money everywhere, a real clean-architecture intent, offline-first SQLite, a strict CI gate, honest engineering culture (the repo documents its own known gaps). But **the three loops the app exists for are all broken in production**:

| Core loop                     | Status                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Monthly envelope budgeting    | **Broken** — there is no period rollover; envelopes vanish every payday                                        |
| Multi-household collaboration | **Broken** — invite create AND accept both fail 100% since migration 019                                       |
| Cross-device sync of money    | **Corrupting** — envelope balances never sync from transactions; deletes resurrect; edits during sync are lost |

Subsystem grades: Domain C/C/C-/C- · Data C+/**D+ (sync)**/C- · Infrastructure C · UI C+/C-/C+/C+/C+ · **Supabase D+** · Tests C+ · App shell C.

The 200x path is not a rewrite. It is: **fix the broken loops → make the data layer trustworthy → then spend the app's real structural advantages (offline-first + household + Ramsey method + OCR) on features no competitor can match.**

---

## 2. Verified Critical & High Findings (fix list)

Every item below was confirmed by an independent verifier agent reading the actual code.

### Critical — the app is broken today

1. **Invite acceptance dead**: client calls `rpc('join_household_via_invite', { invite_code })` but 019 defines the param as `p_invite_code` → PGRST202 every time. `AcceptInviteUseCase.ts:51`
2. **Invite creation dead**: 019 revokes INSERT on `invitations` but `CreateInviteUseCase.ts:36` still inserts directly → permission denied every time. `019_batch1_security_hardening.sql:265`
3. _(Same root cause class)_ **Fresh-database migration chain cannot apply**: 010 duplicates 008's policies with no idempotency guard → `supabase db reset` dies. `010_user_preferences.sql:13`

### High — money correctness

4. **`spentCents` never syncs**: transactions update envelope balances locally but never enqueue the envelope → remote/other-device balances stale; whole-row LWW clobbers concurrent spends. `CreateTransactionUseCase.ts:92-104`
5. **No period rollover exists**: envelopes are keyed by `periodStart`; at payday the query returns zero rows. Modal falsely says "envelopes have been reset". Sinking funds lose visible progress; Baby Steps 1 & 3 regress monthly. `PeriodRolloverModal.tsx:35`, `ReconcileBabyStepsUseCase.ts:35-43`
6. **Snowball order is creation order, not smallest-balance-first** — the core Ramsey ordering is never enforced. `SnowballPayoffProjector.ts:29`
7. **Money input misparse**: `"1,234.56"` saves R1.23; `"1 000"` saves R1.00 — with a success toast. Same class in AddReading (NaN cents). `AddTransactionScreen.ts:28-32`
8. **LogDebtPayment lost-update**: balance written from a stale snapshot, non-transactional with totalPaid. `LogDebtPaymentUseCase.ts:43-60`
9. **DeleteTransaction corrupts balances on double-delete** (no existence check before decrement). `DeleteTransactionUseCase.ts:27-40`
10. **ConfirmSlip double-tap duplicates every transaction** (no idempotency/status guard). `ConfirmSlipUseCase.ts:42-64`

### High — sync engine (grade D+)

11. **Edits during a sync run silently lost** (stale snapshot pushed, queue row unconditionally deleted). `SyncOrchestrator.ts:106-135`
12. **Deletes resurrect across devices** — tombstone schema (0009) is entirely dead code; hard delete + LWW upsert = ghost rows. `SyncOrchestrator.ts:185-191`
13. **Restore clobbers dirty local rows, then pushes the stale data back**. `RestoreService.ts:170-194`
14. **Sync only fires at boot/reconnect** — a full day of online logging never pushes. `App.tsx:127-181`
15. **Restore truncates at 1000 rows** (no pagination) and swallows errors — established households silently lose history on reinstall. `RestoreService.ts:163-166`
16. **DLQ silently discards user data**; 7-day age rule dead-letters long-offline changes on their first failure. `SyncOrchestrator.ts:142-151`
17. **Write + audit + sync-enqueue never atomic** — crash window strands rows unsynced forever. Repeated in every use case and repository. `DrizzleSlipQueueRepository.ts:40-51` et al.
18. **Baby-step writes never enqueued at all** — progress never uploads. `ReconcileBabyStepsUseCase.ts:137`

### High — security & backend

19. **`inv_insert` RLS policy is a tautology** (`hm.household_id = household_id` binds to itself → always true). `019:92`
20. **Removing a member never revokes access** — `user_households` only syncs on INSERT; no DELETE trigger. `005:85`
21. **Any member can delete the owner's membership row or erase audit history** via `delete_sync_row` (no role check). `019:223`
22. **LWW compares TEXT timestamps in three inconsistent formats** (client ISO vs `NOW()::text` vs `AT TIME ZONE`). `008:103`, `016:45`
23. **Push notifications are 100% dead**: notify-event posts to the FCM Legacy API, shut down mid-2024. `supabase/functions/notify-event/index.ts:103`
24. **FCM token survives sign-out** — the next user of the device receives the previous user's financial notifications. `SettingsScreen.tsx:45`

### High — UX & app shell

25. **Slip scanning is unreachable** — no button anywhere navigates to the camera; the queue's empty state references a camera button that doesn't exist. `SlipQueueScreen.tsx:163-190`
26. **Tapping a completed slip crashes** (missing `extraction` param). `SlipQueueScreen.tsx:153-154`
27. **No password reset flow exists** — forgotten password = permanently locked out of financial data. `LoginScreen.tsx:123`
28. **Switching households never restores that household's data** — user lands on an empty/stale dataset with no indication. `HouseholdPickerScreen.tsx:21`
29. **Cold start blocks first paint on an un-timed Supabase call**; blank white screen, forever on failure; initSession runs twice and re-runs on every token refresh. `App.tsx:203-258`
30. **Envelope type selector missing `sinking_fund`/`emergency_fund`** — two live navigation paths preselect types the control can't render; sinking-fund creation is broken. `AddEditEnvelopeScreen.tsx:211-221`
31. **Migration/test theater**: no test executes real SQL (which is how invalid migration 0007 shipped); security tests grep source strings; e2e journeys never authenticate; CD publishes to Play without waiting for e2e. `jest.config.js:15`, `cd.yml:30`

_(Refuted and therefore excluded: the 16KB page-size Play-blocker claim. ~180 further medium/low findings are in the findings digest.)_

---

## 3. What's Genuinely Good — Keep and Build On

- **Integer cents end-to-end.** No float money anywhere. Rare and precious.
- **Result<T, DomainError> discipline** across all use cases.
- **BudgetPeriodEngine boundary tests** (year crossover, Feb 28, payday windows).
- **Slip scanning is the one true hexagonal slice** — ports, adapters, DI, real tests.
- **extract-slip edge function defense-in-depth**: auth → membership → consent → ownership → idempotency → size cap → advisory-lock rate limit → prompt-injection allowlisting. This is the pattern the rest of the backend should copy.
- **Invite-code crypto is correct** (unbiased modulo, confusable chars excluded, server-side join).
- **Early-crash observability stack** (pre-import handler, boot capture, checksummed migrations).
- **Strict CI PR gate** (prettier, tsc, eslint max-warnings 0, coverage thresholds), zero snapshot tests.
- **PULSE dashboard design ambition** (Fraunces numerals, arc gauges, tabular-nums) — it just needs to be promoted into the token system instead of living as a fork.
- **Retry/backoff machinery in the sync queue** is genuinely solid — the bugs are in what surrounds it.

---

## 4. The Game Plan

### Phase 0 — Stop the Bleeding (1–2 weeks)

_Every item is a verified production breakage with a small, known fix._

1. Fix invite RPC param name + add `create_invitation` SECURITY DEFINER RPC (findings 1, 2, 19).
2. Fix migration 010 duplicate policies; add `supabase db reset` to CI so this class can never ship again (3, 31).
3. Shared locale-safe money-input sanitizer used by AddTransaction, AddReading, AddDebt, AddEditEnvelope (7).
4. Default snowball ordering to smallest-balance-first (6).
5. Atomic single-UPDATE debt payment; existence-checked transaction delete; idempotent slip confirm (8, 9, 10).
6. Enqueue envelope updates with transactions, baby-step writes, inside one `db.transaction` (4, 17, 18).
7. Add camera FAB to SlipQueue; guard SlipConfirm params (25, 26).
8. `resetPasswordForEmail` + ResetPassword screen (27).
9. FCM HTTP v1 migration in notify-event; delete token on sign-out (23, 24).
10. Boot: expo-splash-screen, gate first paint on local DB only, restore/sync in background, filter auth events (29).
11. Add missing envelope types to the selector (30).
12. `user_households` DELETE trigger; role checks in `delete_sync_row`; remove `audit_events` from its allowlist (20, 21).

### Phase 1 — Make the Data Layer Trustworthy (2–4 weeks)

_The theme: transactions become the single source of truth, and sync becomes something you can watch working._

1. **Derive `spentCents` from the transaction ledger** (SQL view / repository SUM per period). Kills the entire bug class: missed enqueues, LWW clobbering, double-delete drift, double-confirm duplication.
2. **StartNewPeriodUseCase — the "New Month Ceremony"**: type-aware copy-forward (spending resets, sinking/savings/EMF accumulate), triggered by `isNewPeriodWithin`, driven by a 3-step rollover wizard (review last period → adjust allocations → commit). Model the emergency fund as a household-level persistent fund.
3. **Unit of Work**: one `db.transaction` for entity write + audit + pending_sync everywhere; startup sweep re-enqueues `isSynced=false` orphans.
4. **Finish the tombstone pipeline end-to-end**: local soft-delete, remote `deleted_at` + LWW in merge RPCs, filtered queries, retention purge — enables universal undo in the UI.
5. **Sync v2**: debounced sync-on-write, AppState foreground trigger, drain-until-empty batching; conditional queue-row deletion (fixes lost-edit race); incremental pull via `updated_at` watermark + Supabase Realtime household channels; restore pagination + dirty-row guard; DLQ inbox UI with retry/discard; migrate LWW to `timestamptz` with server-stamped timestamps.
6. **Test tier that touches reality**: better-sqlite3 Jest project replaying real migrations; pgTAP adversarial RLS suite (two users, two households, every table); hermetic e2e against `supabase start` with authenticated journeys; gate Play publishing on the full train; `(select auth.uid())` perf pass + Security Advisor in CI.
7. **Hexagon enforcement**: repository/audit/clock/id ports with in-memory test kit; dependency-cruiser rule failing CI on domain→data imports.

### Phase 2 — 10x the Experience (4–8 weeks)

_The theme: the app should feel alive, fast, and motivating — not a form-filling utility._

1. **Reactive local-first UI**: Drizzle live queries (or invalidation bus) — every screen updates instantly on write and on sync pull; kills the reload-on-focus treadmill and the skeleton flash.
2. **Dashboard v2 — next-best-action, not a report**: "Safe to spend today" hero (remaining ÷ days left), one contextual action card (fund underfunded envelope / log yesterday / pay snowball), envelope quick-actions bottom sheet (spend, move money, recent transactions), fixed FAB.
3. **Debt snowball as the emotional engine**: live debt-free date pinned to the dashboard (EveryDollar's hero feature — ship it free and offline), what-if extra-payment slider (the projector already supports it — it's dead code today), payoff mountain chart, per-debt thermometers, interest-saved odometer, debt-payoff celebrations reusing the baby-steps celebration architecture.
4. **Sub-10-second transaction entry**: amount-first keypad, payee autocomplete, predicted envelope; capture-first option (FAB → camera → OCR → confirm). Editable OCR confirm screen with items-vs-total reconciliation. Offline capture queue with background upload.
5. **Score & gamification made real**: fix the hardcoded score inputs, persist score history at rollover (revives the dead leveling loop), logging streak with 2 monthly grace days (Duolingo-validated), Baby-Step badges, fresh-start prompts at period boundaries, and an explicit "anxiety budget" — at most one loss-framed signal per day.
6. **Onboarding: first win in 90 seconds**: 3 questions + log-first-transaction finale (current funnel honestly advertises 12 minutes); resumable wizard state.
7. **Trust & compliance**: biometric app lock + privacy screen, account deletion, data export (CSV), sync-status row in settings, Play data-safety + financial-features declarations, targetSdk 36 before the Aug 2026 deadline.
8. **Platform modernization** (research-validated, low-risk): EAS Update with phased rollouts + crash-aware rollback (the single biggest operational win — currently zero OTA capability), MMKV for Zustand/flags, FlashList v2 in the 11 list screens, Reanimated 4 for celebrations, Victory Native XL for charts, PULSE promoted into the token system, full TalkBack sweep + 48dp targets + 200% font-scale survival. Stay on react-navigation 7 (don't migrate to expo-router); stay on the hand-rolled sync engine (don't adopt PowerSync/ElectricSQL/Legend-State — verdict: close the pull gap instead, reassess only if sync scope keeps growing).

### Phase 3 — Leapfrog the Market (8–16 weeks)

_The theme: spend the structural advantages nobody else has._

1. **Households as the headline** (Monarch wins couples but has 2.2/5 Trustpilot on sync reliability; this app's local-first design can actually deliver): roles & ownership transfer, member attribution on every transaction ("Sipho spent R450 from Groceries"), household activity feed powered by the existing audit trail, Realtime live budgets, weekly shared digest, joint milestones, deep-link/QR invites with household preview.
2. **Intelligence, offline-first**: payee→envelope self-learning rules (Actual Budget's killer feature), recurring-transaction detection powering commitment-aware forecasting ("Groceries runs dry on the 22nd"), a data-driven Margin Finder (EveryDollar claims $3,015 average found — from a questionnaire; this app has real transactions), weekly recap, slip line-item price intelligence, meter-photo OCR reusing the slip pipeline, and eventually a Ramsey-voice coach grounded in local data (Cleo proved 20x engagement; on-device tiers via ML Kit GenAI / executorch keep it private).
3. **Monetization** (research-benchmarked): one household plan at **R-equivalent of $59–79/yr**, undercutting EveryDollar Premium ($79.99) with the household angle no one prices for; free tier = full manual solo budgeting (the aha moment); premium = household sync, OCR, intelligence, coaching; 30-day full trial (17–32-day trials convert 42.5% vs 25.5%); invite codes as the viral loop (free members join a paid household, then start their own); Play billing grace/dunning from day one (31% of Play churn is involuntary); "money found" number instrumented in week 1 — it's the single strongest retention lever in this category.

---

## 5. Positioning — the 200x thesis

> **"The budgeting app for households doing the Baby Steps — works offline, syncs instantly, and never loses a cent."**

- **EveryDollar** (the direct competitor, relaunched Jan 2026) is weak on Android, paywalls the debt-free date, and has no offline story. Beat it on Android quality, price, and offline.
- **YNAB** is $109/yr, methodology-heavy, and its credit-card model is its biggest churn driver — never copy it; card spending just decrements the envelope and the card is a debt in the snowball (exactly the Ramsey view).
- **Monarch** owns couples but is drowning in sync-reliability complaints — reliability is the wedge.
- **Actual Budget** validates local-first envelope budgeting but is self-hosted nerd-ware — this app is its consumer-grade cousin.

The advantages are already in the codebase: offline-first SQLite, multi-household invites, receipt OCR, the full Ramsey domain model. Phases 0–1 make them true; Phases 2–3 make them visible.

## 6. How to execute

- Work Phase 0 as a single remediation branch series (most fixes are &lt; 50 LOC each, all have file:line references above and in the findings digest).
- Every Phase 0/1 fix lands with a test that would have caught it (real-SQL tier where relevant — half these bugs shipped because no test executes real SQL).
- Re-run this review after Phase 1; the sync engine and Supabase subsystems should move from D+ to B before any Phase 3 feature work.

_Full evidence, including ~180 additional medium/low findings and all research citations: [docs/reviews/2026-07-02-deep-review-findings.md](reviews/2026-07-02-deep-review-findings.md)._
