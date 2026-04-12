# Baby Steps Tracker + Zero-Based Budgeting — Implementation Plan

**Date:** 2026-04-12
**Spec:** [`docs/superpowers/specs/2026-04-12-baby-steps-tracker-design.md`](../specs/2026-04-12-baby-steps-tracker-design.md)
**Status:** Ready to execute

---

## For the agent executing this plan

Use **`superpowers:executing-plans`** (for human-reviewed checkpoint execution) or
**`superpowers:subagent-driven-development`** (for in-session parallel task dispatch).
Follow phases in order — each phase is mergeable on its own. Within a phase, honour the
task order: later tasks assume earlier tasks landed.

- Before touching code, read the spec section anchored in each task header.
- Every domain write to `baby_steps` **must** set `isSynced = false` (spec §Sync / isSynced invariant).
- Every new/changed file should land with its unit test in the same commit where practical.
- If you hit ambiguity, stop and surface it — do not guess domain rules.

---

## Phase 1 — Data layer (schema, migration, sync wiring)

**Goal:** landing this phase alone keeps the app compiling, existing features untouched, and
creates the durable substrate (local columns, Drizzle schema, Supabase migration, sync table
map) everything downstream relies on.

Spec refs: §Data model, §Sync integration.

- [ ] **1.1** Add `'income'` to the TS `EnvelopeType` union in `src/domain/envelopes/EnvelopeEntity.ts` (existing values preserved: `'spending' | 'savings' | 'emergency_fund' | 'baby_step' | 'utility'`). No runtime effect yet.
- [ ] **1.2** Edit `src/data/local/schema/babySteps.ts` to add columns `isManual: integer(..., { mode: 'boolean' }).notNull().default(false)` and `celebratedAt: text('celebrated_at')`. (Spec §Drizzle schema edits — without this, writes no-op.)
- [ ] **1.3** Create local migration `src/data/local/migrations/0003_baby_steps_columns.sql`:
  ```sql
  ALTER TABLE baby_steps ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE baby_steps ADD COLUMN celebrated_at TEXT;
  ```
- [ ] **1.4** Run `drizzle-kit generate` to regenerate `src/data/local/migrations/migrations.js` and `meta/_journal.json`. Reconcile filename slot if it collides; commit the regenerated artifacts.
- [ ] **1.5** Create Supabase migration `supabase/migrations/003_baby_steps_and_income_envelopes.sql` containing:
  - `CREATE TABLE IF NOT EXISTS public.baby_steps (...)` with full column set (spec §Supabase remote migration).
  - Unique index `idx_baby_steps_household_step` on `(household_id, step_number)`.
  - RLS policies mirroring `envelopes` (household-scoped).
  - Drop/re-add `envelope_type` check constraint to include `'income'` if one exists; otherwise no-op comment.
  - `merge_baby_step(...)` PL/pgSQL RPC that preserves `celebrated_at` when `EXCLUDED.celebrated_at IS NULL AND existing.celebrated_at IS NOT NULL`; LWW on `updated_at` for all other columns (spec §`celebrated_at` merge strategy).
- [ ] **1.6** Register `baby_steps` in `src/data/sync/SyncOrchestrator.ts`: import `babySteps`, add `baby_steps: babySteps` to `TABLE_MAP`, extend the `SyncTable` union. Route `baby_steps` rows through `merge_baby_step` RPC instead of plain `upsert`.
- [ ] **1.7** Extend `src/data/sync/rowConverters.ts` to handle `baby_steps`: boolean↔integer mapping for `is_completed`, `is_manual`, `is_synced`; pass-through for `completed_at`, `celebrated_at`.
- [ ] **1.8** Extend `src/data/sync/RestoreService.ts`: add `baby_steps` to the `restoreTable` dispatch and the table union (~line 110). Do **not** yet wire the seed call (added in Phase 2 after `SeedBabyStepsUseCase` exists).
- [ ] **1.9** Tests: extend `rowConverters.test.ts` with explicit baby_steps round-trip; extend `SyncOrchestrator.test.ts` asserting `merge_baby_step` RPC path is taken for baby_steps (mocked); extend `RestoreService.test.ts` asserting baby_steps is in the dispatch map.

**Acceptance — Phase 1:**
- App builds and existing tests pass.
- New local migration runs cleanly on a fresh DB and on a DB previously seeded with migrations 0000–0002.
- Supabase migration applies idempotently; RPC exists.
- Sync orchestrator round-trips a synthetic `baby_steps` row via the RPC (test-level).

---

## Phase 2 — Domain layer (evaluator, reconcile, seed, fixer, income rules)

**Goal:** pure domain logic and use-cases. No UI, no hooks. After this phase the app behaves
identically to before, but programmatic callers (tests) can drive Baby Steps state end-to-end.

Spec refs: §Architecture, §Domain layer, §Seeding, §The 7 Baby Steps rules.

- [ ] **2.1** Create `src/domain/babySteps/BabyStepRules.ts`: rule table keyed by step number with `{ shortTitle, description, completionMessage, regressionToast, progressTemplate, notificationTitle, notificationBody, isManual, evaluate }`. Copy is verbatim from spec §Step copy table — this file is the single source of truth (referenced later by `LocalNotificationScheduler` and toasts).
- [ ] **2.2** Create `src/domain/babySteps/types.ts` exporting `BabyStepStatus` and `ReconcileResult` from spec §TypeScript types.
- [ ] **2.3** Create `src/domain/budget/BudgetBalanceCalculator.ts` (pure). Input: `envelopes[]` (pre-filtered to current period by caller). Output: `{ incomeTotal, totalAllocated, expenseAllocationTotal, toAssign }`. Implementation uses `totalAllocated - incomeTotal`; no type enumeration. Archived envelopes excluded.
- [ ] **2.4** Unit tests `src/domain/budget/__tests__/BudgetBalanceCalculator.test.ts`: positive/zero/negative `toAssign`; archived exclusion; mixed-period caller-filter contract documented.
- [ ] **2.5** Create `src/domain/babySteps/BabyStepEvaluator.ts` (pure). Input: `{ envelopes, debts, monthlyExpenseBaseline, manualFlags }`. Output: `BabyStepStatus[]`. Wires each rule from `BabyStepRules.ts`. Handles: `EMF = null`, `INCOME_TOTAL = 0` (step 3 progress=null), no non-bond debts (step 2 progress=null), no bond (step 6 progress=null). Multiple emergency_fund envelopes tolerated — oldest by `created_at` wins.
- [ ] **2.6** Unit tests `src/domain/babySteps/__tests__/BabyStepEvaluator.test.ts`: table-driven matrix from spec §Testing — 35 minimum scenarios (`step × state`). Use `jest.useFakeTimers()` + `jest.setSystemTime('2026-04-12')` for determinism.
- [ ] **2.7** Create `src/domain/babySteps/SeedBabyStepsUseCase.ts`. Single SQL `INSERT OR IGNORE INTO baby_steps (...) VALUES (...) x 7`. Steps 4/5/7 get `isManual=true`. `isSynced=false` on insert. Idempotent under concurrency. `execute(householdId)` signature.
- [ ] **2.8** Unit tests `src/domain/babySteps/__tests__/SeedBabyStepsUseCase.test.ts`: empty DB → 7 rows; 6 rows existing → only missing one inserted; all 7 exist → no-op; `Promise.all([seed(h), seed(h)])` → final count = 7, no unhandled rejection.
- [ ] **2.9** Create `src/domain/babySteps/ReconcileBabyStepsUseCase.ts`. Reads envelopes + debts repos; calls `BudgetBalanceCalculator` to derive `INCOME_TOTAL` → `monthlyExpenseBaseline = INCOME_TOTAL / 100`; calls `BabyStepEvaluator`; diffs vs persisted rows; writes transitions (`is_completed`, `completed_at` cleared on regression, `celebrated_at` preserved always, `isSynced=false`); returns `{ statuses, newlyCompleted, newlyRegressed }`.
- [ ] **2.10** Unit tests `ReconcileBabyStepsUseCase.test.ts`: complete → incomplete preserves `celebrated_at`; re-complete after regression reuses existing `celebrated_at` (no modal re-trigger later); every write has `isSynced=false`.
- [ ] **2.11** Create `src/domain/babySteps/ToggleManualStepUseCase.ts` for steps 4/5/7. Rejects non-manual step numbers. Writes `is_completed`, `completed_at`, `isSynced=false`. Test for rejection + toggle.
- [ ] **2.12** Create `src/domain/babySteps/StampCelebratedUseCase.ts`: sets `celebrated_at = new Date().toISOString()`, `isSynced=false`. Idempotent: if already stamped, no-op. Test both paths.
- [ ] **2.13** Create `src/domain/babySteps/ReconcileEmergencyFundTypeUseCase.ts`: finds all `envelope_type='emergency_fund' AND !archived` envelopes for a household; oldest by `createdAt` wins; others flip to `'savings'` with `isSynced=false`. Test: single EMF → no-op; two EMFs + one archived → archived skipped; two active EMFs → oldest preserved, other flipped.
- [ ] **2.14** Create `src/domain/shared/resolveBabyStepIsActive.ts`: `any(baby_steps WHERE household_id=X AND is_completed = true)`. Returns `false` when no rows. Test: no rows, one complete, all 7 complete.
- [ ] **2.15** Modify `src/domain/envelopes/CreateEnvelopeUseCase.ts` to accept `'income'` (already covered by union change) — no behavioural change beyond the type check.
- [ ] **2.16** Modify `src/domain/envelopes/UpdateEnvelopeUseCase.ts` to reject `spentCents != 0` when `current.envelopeType === 'income'`. Returns `createFailure({ code: 'INVALID_INCOME_MUTATION', message: 'Income envelopes cannot have spending' })`. Test both passing and rejecting paths.
- [ ] **2.17** Modify `src/domain/transactions/CreateTransactionUseCase.ts` to read target envelope and reject when `envelope_type === 'income'` — throw/return `InvalidEnvelopeTypeError` (code: `'INVALID_ENVELOPE_TYPE'`). Test the rejection; existing passing test must still pass.
- [ ] **2.18** Wire `SeedBabyStepsUseCase` into seed call sites (spec §Seeding):
  - `CreateHouseholdUseCase` (post-create).
  - `EnsureHouseholdUseCase` (post-ensure).
  - `RestoreService` (post-restore, per restored household).
  - App startup bootstrap — sequenced **after** `RestoreService` (migrations → restore → seed).
- [ ] **2.19** Wire `ReconcileEmergencyFundTypeUseCase` trigger inside `SyncOrchestrator.syncPending` — fire **only** when result is `{ failed: 0 }` (spec §`ReconcileEmergencyFundTypeUseCase` trigger). Test: partial sync (`failed > 0`) → fixer NOT called; full sync → fixer called once.

**Acceptance — Phase 2:**
- `jest` passes for all new domain/__tests__ + existing suites.
- Table-driven matrix covers all 35 scenarios.
- Income envelope cannot receive a transaction; cannot have spentCents mutated.
- Seeder is idempotent under concurrent invocation.

---

## Phase 3 — Presentation plumbing (hooks + stores, no UI yet)

**Goal:** expose domain to the UI layer through hooks and Zustand stores. AppState gating and
reconcile coalescing land here. Still no visible UI changes — this is wiring.

Spec refs: §Presentation layer (hooks/stores), §Concurrency guards, §Data flow.

- [ ] **3.1** Create `src/presentation/stores/celebrationStore.ts` (Zustand). State: `queue: { stepNumber, triggeredAt }[]`. Actions: `enqueue(stepNumber)` — drops if already in queue OR persisted `celebrated_at` non-null (store takes a repo accessor via init); `dequeue()` — returns head; `clear()`. Test dedup paths.
- [ ] **3.2** Create `src/presentation/stores/toastStore.ts` if not present (check `notificationStore.ts` first — if it already covers toasts, extend; otherwise add). Queue regression toasts with canonical copy from `BabyStepRules`. Test.
- [ ] **3.3** Create `src/presentation/hooks/useBudgetBalance.ts`: reads current-period envelopes via existing `useEnvelopes` pattern, calls `BudgetBalanceCalculator`, memoises result. Test with a mock envelope list.
- [ ] **3.4** Create `src/presentation/hooks/useBabySteps.ts` (pattern: `useDebts.ts`):
  - Exposes `{ statuses, reconcile, toggleManualStep }`.
  - Reconcile coalesced via `useRef<Promise | null>` — second concurrent call returns the first promise.
  - Runs `reconcile()` on mount and on envelopes/debts query invalidation, **only when `AppState.currentState === 'active'`**.
  - Subscribes to `AppState` `change` events; on `active` transition, re-reconciles.
  - `newlyCompleted` → `celebrationStore.enqueue(stepNumber)` for each.
  - `newlyRegressed` → `toastStore.enqueue(...)` with copy from `BabyStepRules`.
- [ ] **3.5** Hook tests `useBabySteps.test.ts`: `AppState='background'` on mount → reconcile NOT called; `AppState='active'` → reconcile IS called; `Promise.all([reconcile(), reconcile()])` → one DB write sequence; background→foreground mid-flight → no double-enqueue. Use the `AppState` jest mock from spec §AppState mocking.
- [ ] **3.6** Add `fireBabyStepCelebration(stepNumber)` to `LocalNotificationScheduler`. Identifier format `baby-step-${stepNumber}-${Date.now()}${Math.random().toString(36).slice(2,6)}`. Title/body read from `BabyStepRules.NOTIFICATION_COPY[stepNumber]`. Trigger `null`. **Scheduler writes no domain state.** Test under fake timers.
- [ ] **3.7** Wire `useBabySteps` background reconcile path: when reconcile runs while backgrounded (e.g. from background fetch) and detects a newly completed step, call `LocalNotificationScheduler.fireBabyStepCelebration(n)` as the signal (domain row is already written; no celebrated_at stamp). On next foreground the hook sees `celebrated_at=null` and enqueues the modal.
- [ ] **3.8** Caller migration: update the site that builds `RamseyScoreInput` to source `babyStepIsActive` from `resolveBabyStepIsActive(householdId)` instead of whatever placeholder existed. Test coverage at the caller.

**Acceptance — Phase 3:**
- Hook + store tests pass.
- No UI regression (screens unchanged in this phase).
- Background notification fires from domain signal; no state written by the scheduler.

---

## Phase 4 — UI (screens, cards, banners)

**Goal:** user-visible surface. After this phase the feature is complete functionally; visual
polish still to come in Phase 5.

Spec refs: §Presentation layer (screens), §Data flow (user-visible).

- [ ] **4.1** Create `src/presentation/screens/babySteps/` directory. Add `BabyStepsScreen.tsx` — three-tier layout: completed chips row, current step hero, future steps list. Consumes `useBabySteps()`. Empty-state CTAs: no EMF envelope, no income envelope, Step 2/6 no-debts.
- [ ] **4.2** Create `src/presentation/screens/babySteps/components/StepSealMark.tsx`. Single SVG with `state: 'future' | 'current' | 'complete'` and `size: number`. Seven seal designs from spec §Step seals table. Consistent stroke weight, single brand accent.
- [ ] **4.3** Create `src/presentation/screens/babySteps/components/SevenDotPath.tsx`. 7 circular nodes + connector line. Complete / Current (pulse 2s, 0.6↔1.0) / Future states. Uses `useWindowDimensions`; width < 360dp renders compact fallback `Step X of 7 · <title>` with `●●●○○○○`.
- [ ] **4.4** Create `src/presentation/screens/babySteps/components/CurrentStepHero.tsx`. Auto steps: progress ring + `R{current} of R{target}` (tabular-numeric) or `{current} of {target} debts cleared` for Step 2. Manual steps: renders `ManualStepPanel`. No-data: renders CTA card.
- [ ] **4.5** Create `src/presentation/screens/babySteps/components/ManualStepPanel.tsx`. Large switch; label verbatim: `"You decide when this is complete — tap to mark done."`; switch announces role + state for a11y. Visually distinct from `CurrentStepHero` ring layout (different icon, different container treatment).
- [ ] **4.6** Create `src/presentation/screens/babySteps/CelebrationModal.tsx`. Full-screen overlay, muted ledger-paper tint. 144×144 `StepSealMark` spring-animated `scale: 0.6→1.0, opacity: 0→1` over ~600ms with overshoot. `reducedMotion` prop skips animation (test env). Body-font completion message, ribbon banner `Completed <date>`. Dismiss button triggers `StampCelebratedUseCase` via dependency-injected callback.
- [ ] **4.7** Consumer: mount a single `CelebrationModal` host at the navigator/root level that reads the head of `celebrationStore.queue`; on dismiss stamps + dequeues; repeats while the queue is non-empty.
- [ ] **4.8** Create `src/presentation/screens/dashboard/BabyStepsCard.tsx`. Renders `SevenDotPath` + current title + progress line; taps navigate to `BabyStepsScreen`.
- [ ] **4.9** Insert `BabyStepsCard` into `src/presentation/screens/dashboard/DashboardScreen.tsx` (follow existing card insertion patterns — verify with that file's current composition).
- [ ] **4.10** Create `src/presentation/screens/budgets/components/BudgetBalanceBanner.tsx`. Uses `useBudgetBalance()`. States: `toAssign == 0` → "Every rand assigned ✓"; `toAssign > 0` → "R{n} left to assign"; `toAssign < 0` → `-R{abs} overcommitted` in warning colour. Shows `incomeTotal / expenseAllocationTotal / toAssign` breakdown.
- [ ] **4.11** Insert `BudgetBalanceBanner` at top of `src/presentation/screens/budgets/BudgetScreen.tsx`. Refactor envelope list on that screen to group by `envelopeType === 'income'` into "Income" and "Expenses" sections.
- [ ] **4.12** Update `src/presentation/screens/envelopes/CreateEnvelopeScreen.tsx` type picker to include `'income'`. Accept nav param `preselectedType: EnvelopeType` and preselect accordingly. Verify the existing screen accepts the param pattern (add if missing).
- [ ] **4.13** Wire `BabyStepsScreen` + `CelebrationModal` (host) into `DashboardStackNavigator`. No new tab, no new Settings row. `BabyStepsCard` taps navigate through the stack.
- [ ] **4.14** Duplicate-EMF banner on Budget screen: reads a flag set by `ReconcileEmergencyFundTypeUseCase` (via a small `useEmergencyFundReconcileFlag` hook backed by a store or query). Copy verbatim from spec §Duplicate-EMF banner copy.

**Acceptance — Phase 4:**
- End-to-end smoke scenarios from spec §End-to-end smoke all pass manually on device:
  1. Fresh household → correct CTAs + manual steps 4/5/7 visible.
  2. Income + EMF → R1,000 → modal → dismiss → R800 → toast (no modal) → re-fund → no re-celebration.
  3. Two devices both designate EMF → sync → fixer → banner fires.
- Component tests below pass.

**Component tests (added within Phase 4 scope):**
- [ ] **4.15** `BabyStepsScreen.test.tsx` — all three tiers render; CTA for no-EMF; CTA for no-income; CTA for Step 2 no-debts; manual steps show `ManualStepPanel`.
- [ ] **4.16** `CelebrationModal.test.tsx` — `reducedMotion=true` path renders final state immediately; `reducedMotion=false` under fake timers + `act()` + 700ms advance reaches final state; dismiss triggers stamp callback.
- [ ] **4.17** `BudgetBalanceBanner.test.tsx` — positive / zero / negative `toAssign` render states; matches copy.
- [ ] **4.18** `ManualStepPanel.test.tsx` — toggle role, a11y state transitions, visually distinct container (snapshot or prop-verified).
- [ ] **4.19** `SevenDotPath.test.tsx` — narrow-device compact fallback renders at < 360dp; full layout at ≥ 360dp.

---

## Phase 5 — Visual polish + accessibility

**Goal:** lock in the emotional weight of the surface and ensure WCAG compliance.

Spec refs: §Visual Identity, §Accessibility.

- [ ] **5.1** Verify seal SVGs against spec §Step seals concepts; ensure sizes 24 / 96 / 144 render crisply. Lock stroke weight / accent colour to design tokens.
- [ ] **5.2** Progress ring `accessibilityLabel`: `"Step {n}: {title}, {percent}% complete, {current} of {target}"` (Step 2 variant: `"{current} of {target} debts cleared"`).
- [ ] **5.3** `SevenDotPath` `accessibilityLabel`: `"Baby Steps progress: {completed} of 7 steps complete, currently on Step {n}"`.
- [ ] **5.4** Future-step card list container: set `accessibilityElementsHidden={true}` OR provide reduced labels (choose one; document in component).
- [ ] **5.5** Completed-chip contrast: verify ≥ 4.5:1 in both light and dark themes. Adjust if needed.
- [ ] **5.6** Manual step chip/tag: visible in chip row and future-list card to distinguish 4/5/7 from auto steps.
- [ ] **5.7** Tabular-numeric variant applied to all progress digits.
- [ ] **5.8** Reduced-motion respect: detect system setting (`AccessibilityInfo.isReduceMotionEnabled()`) and auto-set `reducedMotion` on `CelebrationModal` + `SevenDotPath` pulse.

**Acceptance — Phase 5:**
- Manual a11y scan (screen reader walkthrough) on BabyStepsScreen + Dashboard card + CelebrationModal reads as specified.
- Contrast ratios verified in both themes.
- Reduced-motion users see no spring or pulse animation.

---

## Phase 6 — Integration + sync verification

**Goal:** end-to-end confidence the feature survives sync, restore, and cold-start edge cases.

Spec refs: §Sync integration, §Testing / race + sync coverage.

- [ ] **6.1** Integration test: `SyncOrchestrator` round-trip for `baby_steps` hitting `merge_baby_step` RPC (mocked). Device A stamps `celebrated_at`, syncs; Device B's earlier row merges and keeps A's stamp.
- [ ] **6.2** Integration test: `RestoreService` restores baby_steps rows then invokes `SeedBabyStepsUseCase` for the household — missing steps backfill without touching existing row timestamps.
- [ ] **6.3** Integration test: partial-sync (`failed > 0`) → `ReconcileEmergencyFundTypeUseCase` NOT called; clean sync (`failed: 0`) → called exactly once.
- [ ] **6.4** Integration test: multi-EMF with one archived → fixer skips archived, preserves oldest active, flips the other to savings with `isSynced=false`.
- [ ] **6.5** Race test: `Promise.all([reconcile(), reconcile()])` asserts one DB write sequence, final `celebrationStore.queue.length = 1`.
- [ ] **6.6** Race test: background→foreground mid-modal does not double-enqueue.
- [ ] **6.7** Seeder race: `Promise.all([seed(h), seed(h)])` → final row count = 7, no unhandled rejection (already covered in 2.8; re-confirm under orchestrator context).

**Acceptance — Phase 6:**
- All integration tests pass.
- End-to-end smoke scenarios pass on a real device with two installations.

---

## Definition of Done — spec requirement → plan task mapping

| Spec requirement (§section) | Covered by task(s) |
|---|---|
| `'income'` added to `EnvelopeType` TS union | 1.1 |
| Drizzle schema edits (`isManual`, `celebratedAt`) | 1.2 |
| Local migration `0003_baby_steps_columns.sql` | 1.3, 1.4 |
| Supabase migration `003_...sql` incl. unique index, RLS, `merge_baby_step` RPC | 1.5 |
| `SyncOrchestrator` TABLE_MAP + RPC routing for baby_steps | 1.6, 1.9 |
| `rowConverters` boolean-integer mapping | 1.7, 1.9 |
| `RestoreService` dispatch + post-restore seed | 1.8, 2.18 |
| `BabyStepRules` canonical copy + notification copy SoT | 2.1 |
| `BabyStepStatus` / `ReconcileResult` types | 2.2 |
| `BudgetBalanceCalculator` pure, sealed, `totalAllocated − incomeTotal` | 2.3, 2.4 |
| `BabyStepEvaluator` with 35-scenario matrix | 2.5, 2.6 |
| `SeedBabyStepsUseCase` INSERT OR IGNORE + idempotent | 2.7, 2.8 |
| `ReconcileBabyStepsUseCase` incl. celebrated_at preservation + isSynced invariant | 2.9, 2.10 |
| `ToggleManualStepUseCase` for 4/5/7 | 2.11 |
| `StampCelebratedUseCase` one-shot | 2.12 |
| `ReconcileEmergencyFundTypeUseCase` oldest-wins | 2.13 |
| `resolveBabyStepIsActive` helper + score wiring | 2.14, 3.8 |
| Income envelope transaction rejection | 2.17 |
| `UpdateEnvelopeUseCase` blocks `spentCents != 0` on income | 2.16 |
| Seed call sites (4 places) | 2.18 |
| Fixer trigger only on `failed: 0` | 2.19, 6.3 |
| `celebrationStore` dedup | 3.1 |
| `toastStore` regression toast | 3.2 |
| `useBudgetBalance` hook | 3.3 |
| `useBabySteps` hook incl. AppState gating + coalesce | 3.4, 3.5 |
| `LocalNotificationScheduler.fireBabyStepCelebration` (no domain writes) | 3.6, 3.7 |
| `BabyStepsScreen` three-tier layout + CTAs | 4.1, 4.15 |
| `StepSealMark` / `SevenDotPath` / `CurrentStepHero` / `ManualStepPanel` | 4.2–4.5, 4.18, 4.19 |
| `CelebrationModal` ribbon-and-seal + reducedMotion | 4.6, 4.7, 4.16 |
| Dashboard `BabyStepsCard` insertion | 4.8, 4.9 |
| `BudgetBalanceBanner` + income/expense sections | 4.10, 4.11, 4.17 |
| `CreateEnvelopeScreen` accepts `'income'` + `preselectedType` param | 4.12 |
| Navigator wiring (no new tab) | 4.13 |
| Duplicate-EMF banner | 4.14 |
| Accessibility labels + contrast + reduced-motion | 5.2–5.8 |
| `celebrated_at` merge via RPC round-trip | 1.5, 1.6, 6.1 |
| Restore → seed integration | 6.2 |
| Multi-EMF (one archived) fixer | 6.4 |
| Race: reconcile × 2, background↔foreground | 3.5, 6.5, 6.6 |
| Seeder race | 2.8, 6.7 |

If any row above is unchecked when "done" is declared, the plan is not complete.

---

## Verification

Project has no `npm test`/`lint`/`typecheck` scripts defined in `package.json` — invoke tooling directly from the repo root:

```bash
# Typecheck
npx tsc --noEmit

# Unit + component + integration tests (Jest)
npx jest

# Lint (project uses expo default — confirm eslint config exists before relying on this)
npx eslint "src/**/*.{ts,tsx}"

# Drizzle migration regeneration (rerun if schema files change)
npx drizzle-kit generate

# Supabase migration (local dev stack)
npx supabase db reset        # applies all migrations incl. 003
```

Before declaring the plan done, run — and paste output into the PR:

```bash
npx tsc --noEmit && npx jest --coverage
```

Manual smoke (spec §End-to-end smoke):
1. Fresh install → household created → BabyStepsScreen shows Steps 1/2/6 incomplete with CTAs; Step 3 blocked on income; 4/5/7 manual.
2. Create income envelope + emergency_fund envelope → fund to R1,000 → CelebrationModal fires → dismiss → spend down to R800 → regression toast (no modal) → re-fund to R1,000 → no re-celebration.
3. Two installations both mark an emergency_fund → sync both → fixer flips one to savings → duplicate-EMF banner appears on Budget screen.

---

## Rollback notes

Rollback is safe phase-by-phase because each phase is self-contained:

- **Rollback after Phase 1:** drop local migration `0003` (DB column drops aren't supported in SQLite — recreate table or leave columns unused); drop Supabase migration `003`; revert `SyncOrchestrator`, `rowConverters`, `RestoreService` patches. No user-visible change.
- **Rollback after Phase 2:** revert domain packages `src/domain/babySteps/`, `src/domain/budget/`, `src/domain/shared/resolveBabyStepIsActive.ts`; revert envelope + transaction use-case edits. Schema remains — harmless.
- **Rollback after Phase 3:** remove hooks + stores; scheduler method is safe to keep (unused). No user-visible change yet.
- **Rollback after Phase 4+:** remove screen entries from `DashboardStackNavigator`; remove dashboard card + budget banner. Domain + sync state remain intact and will no longer be observed — safe.

**Data rollback concerns:**
- `baby_steps` rows written while the feature was live will persist even if UI is reverted — they are harmless (no foreign keys).
- `celebrated_at` RPC preserves on merge; if the RPC is dropped while rows still sync, downgrade to plain upsert — at worst a stamp is lost (not catastrophic, one-shot semantics mean the modal would re-fire once).
- Envelopes with `envelope_type='income'` persist. After rollback they render as an unknown type in the UI; guard the envelope list render to treat unknown types as `'spending'` until full cleanup, or run a data fix flipping `income → savings`.

**Forward-only migrations:** the Supabase migration is forward-only (`CREATE TABLE IF NOT EXISTS`). To fully revert, ship a new migration `004_revert_baby_steps.sql` that drops the RPC and table — do **not** edit `003` in place.
