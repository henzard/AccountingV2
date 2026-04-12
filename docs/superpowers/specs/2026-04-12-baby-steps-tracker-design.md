# Baby Steps Tracker + Zero-Based Budgeting — Design Spec

**Date:** 2026-04-12 (revised after code-ground-truth review)
**Status:** Approved
**Related PRD requirements:** FR-32, FR-33, FR-1 (envelope mechanics), FR-38 (partial — milestone-approach coaching deferred)

## Goal

Implement the 7 Dave Ramsey Baby Steps as a structured progress framework (FR-32) with defined completion conditions and celebration events, AND introduce income envelopes so the household budget can be validated as zero-based (every rand assigned). Income tracking is a prerequisite for Step 3's "monthly expense baseline" and for future Step 4 auto-detection.

Auto-detect completion for Steps 1, 2, 3, 6 from envelopes + debts data. Manual toggle for Steps 4, 5, 7 (investment / college-fund / giving tracking doesn't exist yet).

## Scope

**In:**
- Add `'income'` to the `envelope_type` enum; treat income envelopes as a dedicated model with an "allocated but not yet assigned" balance.
- Zero-based validation: compute `incomeTotal − expenseAllocationTotal`; surface the unassigned remainder on the Budget screen so the user can see when the budget is balanced.
- `BabyStepEvaluator` + `ReconcileBabyStepsUseCase` with auto-detection for Steps 1, 2, 3, 6 and manual toggle for Steps 4, 5, 7.
- `monthlyExpenseBaseline` derived deterministically from income envelope totals (not from expense allocations — see Rules below).
- Ribbon-and-seal celebration event (modal in foreground, local notification in background).
- Dynamic revert when auto-detect conditions fall below threshold; revert is silent but preserves `celebratedAt` so completed-then-regressed-then-re-completed does NOT re-celebrate.
- Dashboard card + dedicated screen (in Dashboard stack); emergency-fund designation surfaced via the existing envelope-type UI, not a new settings row.
- Seeder that inserts 7 `baby_steps` rows per household on first load after migration.

**Out:**
- A new "emergency fund designation" screen — the existing envelope-type selector already supports `'emergency_fund'`, so no new picker is needed.
- New navigation tab.
- Confetti / particle celebration animations — explicitly rejected (see Visual Identity).
- Baby Step milestone-approaching coaching notifications (FR-38) — deferred to a separate notification-rule-pack spec.
- Investment / college-fund / giving auto-detection for Steps 4/5/7.
- Server-side uniqueness constraint on `envelope_type = 'emergency_fund'` (see Sync conflict handling).

## The 7 Baby Steps — completion rules (authoritative)

Let `EMF = first envelope with envelope_type = 'emergency_fund' AND is_archived = false, ordered by created_at ASC`.
Let `INCOME_TOTAL = sum(allocated_cents) across all envelopes where envelope_type = 'income' AND is_archived = false` for the current period (same `period_start`).
Let `monthlyExpenseBaseline = INCOME_TOTAL / 100` (ZAR); income-based baseline matches Ramsey teaching ("save 3–6 months of income-level expenses"). This is deterministic and present from the moment income is entered.

| # | Step | Mode | Condition |
|---|------|------|-----------|
| 1 | Starter Fund | Auto | `EMF != null` AND `EMF.balance_cents >= 100000` (R1,000) |
| 2 | Debt Free | Auto | `count(debts WHERE debt_type != 'bond') > 0` AND `every such debt has is_paid_off = true OR outstanding_balance_cents = 0` |
| 3 | Full Emergency Fund | Auto | `EMF != null` AND `EMF.balance_cents >= 3 * monthlyExpenseBaseline * 100` |
| 4 | Invest 15% | Manual | `baby_steps.is_completed` (user toggled) |
| 5 | College Fund | Manual | `baby_steps.is_completed` (user toggled) |
| 6 | House Free | Auto | `count(debts WHERE debt_type = 'bond') > 0` AND `every such debt has is_paid_off = true OR outstanding_balance_cents = 0` |
| 7 | Build & Give | Manual | `baby_steps.is_completed` (user toggled) |

Where `EMF.balance_cents = EMF.allocated_cents - EMF.spent_cents`.

**Edge case resolutions:**
- No emergency-fund-typed envelope exists → Steps 1 & 3 stay incomplete; UI shows "Create an emergency fund envelope" CTA that links to the envelope-create flow with `envelope_type` pre-filled.
- No non-bond debts ever existed → Step 2 stays incomplete ("not applicable yet"). We do NOT auto-complete from absence; the UX pattern is "no debts to pay off, no celebration to earn." Same for Step 6 / bond.
- No income envelope exists → Step 3's target is undefined; UI shows "Add an income envelope to track progress." Step 1 still works (absolute R1,000 target).
- Multi-emergency-fund by sync collision → evaluator deterministically picks the oldest (`created_at ASC`), ignoring the rest. Post-sync fixer use case flips later ones back to `'savings'` and surfaces a banner (see Sync).

## Zero-based budgeting — scope in this spec

- `envelope_type` enum gains `'income'` (type union already includes 'spending' | 'savings' | 'emergency_fund' | 'baby_step' | 'utility').
- `Envelope.allocatedCents` on an income envelope represents expected / actual income for the period; `spentCents` stays 0 (income envelopes don't "spend"). `UpdateEnvelopeUseCase` validates this.
- New derived computation `BudgetBalanceCalculator`:
  - `incomeTotal = sum(allocatedCents WHERE type='income')`
  - `expenseAllocationTotal = sum(allocatedCents WHERE type IN ('spending','savings','emergency_fund','baby_step','utility'))`
  - `toAssign = incomeTotal - expenseAllocationTotal` (positive = still to assign; negative = overcommitted)
- New component `BudgetBalanceBanner` on the Budget screen showing income, allocated, and `toAssign`. When `toAssign == 0`, shows "Every rand assigned ✓".
- `CreateEnvelopeUseCase` gains a branch: if `type='income'`, skip expense-style defaults.

Onboarding integration is OUT — the onboarding wizard spec will build on top of this.

## Architecture — Evaluator-on-read

`BabyStepEvaluator` is pure. `ReconcileBabyStepsUseCase` reads source data, calls the evaluator, diffs against persisted `baby_steps` rows, writes transitions, and returns `{ statuses, newlyCompleted, newlyRegressed }`. Called on mount of Dashboard and BabyStepsScreen, and whenever the `envelopes` or `debts` query invalidates.

**Reconcile trigger rule:** the hook only triggers reconcile when the component is mounted AND `AppState.currentState === 'active'`. Background-state invalidations are deferred until next foreground — this removes the race where a background-triggered completion would try to mount a modal that has no root (addresses review finding M3).

## Data model

### Migrations

**`src/data/local/migrations/0003_baby_steps_and_income_envelopes.sql`:**

```sql
-- Baby Steps: create the base table (Drizzle schema exists but no prior migration did)
CREATE TABLE IF NOT EXISTS baby_steps (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  is_manual INTEGER NOT NULL DEFAULT 0,
  celebrated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_synced INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_baby_steps_household_step
  ON baby_steps (household_id, step_number);
```

**Schema edits:**
- `src/data/local/schema/babySteps.ts` — add `isManual: boolean` and `celebratedAt: string | null` columns.
- `src/data/local/schema/envelopes.ts` — update the `envelope_type` comment to include `'income'`. (No DB-level enum constraint exists; the enum is a TypeScript type.)
- `src/data/local/schema/index.ts` — export `babySteps` if not already.

No `is_emergency_fund` column — use `envelope_type = 'emergency_fund'` (addresses review finding C1/C3 and simplifies the model).

### Supabase (remote schema)

Mirror the same shape. Supabase migration adds `baby_steps` table and re-asserts the `envelope_type` enum / check constraint to include `'income'`.

### Invariants

- Steps 1–7 exist for every household; enforced by `SeedBabyStepsUseCase` called from whichever code path creates a household (`CreateHouseholdUseCase` + `EnsureHouseholdUseCase`). Idempotent via the unique index.
- Multiple envelopes may have `envelope_type = 'emergency_fund'` across devices due to last-write-wins sync. Evaluator tolerates this (picks oldest); `ReconcileEmergencyFundTypeUseCase` runs after sync to flip duplicates back to `'savings'` and raises a banner.
- `celebratedAt`, once stamped, is never cleared on regression (addresses H4). A step that completes → regresses → completes again shows the original `celebratedAt` and does NOT re-fire the celebration.

## Domain layer

New directory: `src/domain/babySteps/`

| File | Purpose |
|------|---------|
| `BabyStepRules.ts` | Rule table: step number → evaluation fn + label + description + progress-template |
| `BabyStepEvaluator.ts` | Pure. Input: `{ envelopes, debts, monthlyExpenseBaseline, manualFlags }`. Output: `BabyStepStatus[]` |
| `ReconcileBabyStepsUseCase.ts` | Reads repos, calls evaluator, diffs vs persisted state, writes transitions, returns `{ statuses, newlyCompleted, newlyRegressed }` |
| `ToggleManualStepUseCase.ts` | Flips manual steps 4/5/7 on/off |
| `SeedBabyStepsUseCase.ts` | Inserts missing step rows for a household; idempotent; invoked from household creation + first app open |
| `ReconcileEmergencyFundTypeUseCase.ts` | Post-sync fixer: if >1 envelope has `envelope_type='emergency_fund'`, keep the oldest, flip the rest to `'savings'`, push a banner event |
| `__tests__/*.test.ts` | One per class |

New directory: `src/domain/budget/`

| File | Purpose |
|------|---------|
| `BudgetBalanceCalculator.ts` | Pure. Input: envelopes. Output: `{ incomeTotal, expenseAllocationTotal, toAssign }` |
| `__tests__/BudgetBalanceCalculator.test.ts` | Unit tests |

### TypeScript types

```ts
export type BabyStepStatus = {
  stepNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  isCompleted: boolean;
  isManual: boolean;
  progress: { current: number; target: number; unit: 'cents' | 'count' } | null;
  completedAt: string | null;
  celebratedAt: string | null;
};

export type ReconcileResult = {
  statuses: BabyStepStatus[];
  newlyCompleted: number[];   // step numbers that transitioned incomplete → complete this call
  newlyRegressed: number[];   // transitioned complete → incomplete
};
```

## Scoring integration (corrects review finding H1)

`RamseyScoreCalculator` takes `babyStepIsActive: boolean`. That remains the contract — the calculator is not changed. The caller of the calculator (currently whoever computes the monthly score) resolves `babyStepIsActive` as:

> `babyStepIsActive = any(baby_steps.is_completed = true)` for the household.

A thin helper `resolveBabyStepIsActive(householdId): Promise<boolean>` lives in `src/domain/babySteps/` and is wired into whichever score-computation site calls the calculator. No coupling inside the calculator itself.

## Presentation layer

**Hook:** `src/presentation/hooks/useBabySteps.ts`
- Wraps `ReconcileBabyStepsUseCase`.
- Exposes `{ statuses, reconcile, toggleManualStep(n) }`. (Emergency-fund designation happens through the existing envelope-edit flow; no separate hook surface.)
- Re-reconciles on mount and on `envelopes`/`debts` query invalidation, but only when `AppState.currentState === 'active'`.
- Pushes `{ stepNumber }` from `newlyCompleted` onto `celebrationStore`.

**Store:** `src/presentation/stores/celebrationStore.ts`
- Zustand. Queue of `{ stepNumber, triggeredAt }`.
- UI modal consumes queue; on dismiss, calls `StampCelebratedUseCase(stepNumber)` which sets `celebrated_at = now`.
- `ReconcileBabyStepsUseCase` only pushes onto the queue for steps whose persisted `celebrated_at` is `null`. This naturally deduplicates across re-completes and across devices.
- For background-triggered celebrations (reconcile ran during backgrounded app): caller invokes `LocalNotificationScheduler.fireBabyStepCelebration(stepNumber)` (new method) which uses `expo-notifications` with a null trigger (fires immediately). On next foreground, reconcile re-runs and the modal variant is suppressed because `celebrated_at` is already stamped by the notification handler.

**Hook:** `src/presentation/hooks/useBudgetBalance.ts`
- Wraps `BudgetBalanceCalculator` over current-period envelopes.
- Exposes `{ incomeTotal, expenseAllocationTotal, toAssign, isBalanced }`.

**Screens:** `src/presentation/screens/babySteps/`
- `BabyStepsScreen.tsx` — three-tier layout (completed chips / current hero / dimmed future).
- `CelebrationModal.tsx` — ribbon-and-seal stamp overlay.
- Shared components `src/presentation/screens/babySteps/components/`:
  - `StepSealMark.tsx` (one SVG per step, parameterised by state)
  - `SevenDotPath.tsx` (dashboard card's indicator)
  - `CurrentStepHero.tsx` (hero card with progress ring)

**Dashboard:** `src/presentation/screens/dashboard/components/BabyStepsCard.tsx` — renders `SevenDotPath` + current-step title and progress line. Taps → navigates to `BabyStepsScreen`.

**Budget screen integration:** `src/presentation/screens/budgets/components/BudgetBalanceBanner.tsx` — shows income / allocated / to-assign. `BudgetScreen.tsx` mounts the banner at the top. The envelope list gets a sectioned header: "Income" and "Expenses" (grouped by `type === 'income'`).

**Envelope create/edit:** existing screens gain `'income'` in the type picker. No new screen. An envelope of type `'income'` hides the "spent" field and renames "allocated" to "expected income for period" in the UI.

**Navigation:** `BabyStepsScreen` + `CelebrationModal` registered in `DashboardStackNavigator`. No new tab. No new Settings row.

## Visual Identity

The Baby Steps surface is the most emotionally loaded area of the app. Visual treatment must feel earnest and weighty, not gamified. Default Material / confetti aesthetics are explicitly rejected.

### Celebration: ribbon-and-seal stamp

`CelebrationModal` full-screen overlay:
- Center: step's `StepSealMark` SVG at 144×144 (base size in modal), mounting with a spring animation from `scale: 0.6, opacity: 0` → `scale: 1.0, opacity: 1` over ~600ms with an overshoot easing.
- Beneath: step's short title (display font), completion message (body font).
- Ribbon-banner strip across the seal reads "Completed <date>".
- Background: muted ledger-paper tint overlay; no gradients.
- Dismiss via "Continue" button, which triggers `StampCelebratedUseCase`.

No confetti. No particle effects. No sparkles.

### Dashboard card: seven-dot path

`SevenDotPath` — seven circular nodes connected by a thin line. States:
- **Complete:** filled with brand accent, small check glyph centered.
- **Current:** larger, outlined with brand accent, subtle pulse (opacity 0.6 ↔ 1.0, 2s loop).
- **Future:** outlined in muted tone, unfilled.

Beneath the path: current step title + progress line (e.g., `Starter Fund — R650 of R1,000`).

### BabyStepsScreen: three-tier layout

1. **Completed chips row** — horizontally scrolling strip at the top. Each chip: 24×24 `StepSealMark`, step number, completion date. Tap → small bottom-sheet with description.
2. **Current step hero** — large card. Circular progress ring (auto steps) or large toggle (manual 4/5/7), title, description, progress numbers, optional CTA ("Create an emergency fund envelope" or "Add an income envelope").
3. **Future steps list** — vertical list of dimmed monochrome cards beneath the hero. Reduced opacity, no accent color, no progress, number + short title only.

### Step seals

Each step has a dedicated SVG. Consistent stroke weight, corner radius, single brand accent color.

| # | Seal concept |
|---|--------------|
| 1 | Envelope glyph with "R1,000" embossed inside |
| 2 | Broken chain link |
| 3 | Shield / fortress wall |
| 4 | Sprouting seedling |
| 5 | Graduation mortarboard |
| 6 | House key |
| 7 | Open hand (giving) |

**Dimensions (corrected):** 96×96 on the hero, 144×144 base in the celebration modal (animating from 86), 24×24 in completed chips.

### Typography

Project's existing display + body pairing. Progress numbers in tabular-numeric variant so digits don't jitter during reconciliation.

### Step copy (canonical, verbatim)

| # | Short title | Description | Completion message | Progress template |
|---|-------------|-------------|--------------------|-------------------|
| 1 | Starter Fund | Save R1,000 as your first emergency buffer. | You saved your first R1,000. The foundation is laid. | `R{current} of R{target}` |
| 2 | Debt Free | Pay off every debt except the house. | Every debt, gone. You owe no one but the bond. | `{current} of {target} debts cleared` |
| 3 | Full Emergency Fund | Save 3 to 6 months of expenses. | Three months of expenses, saved. You're protected. | `R{current} of R{target}` |
| 4 | Invest 15% | Put 15% of income into retirement. | You're investing in the long game now. | (manual) |
| 5 | College Fund | Save for your children's education. | Their education is funded. | (manual) |
| 6 | House Free | Pay off the bond. | No debt. No bond. The house is yours. | `R{current} of R{target}` |
| 7 | Build & Give | Build wealth. Give generously. | You have enough — and you're giving. | (manual) |

## Data flow — Step 2 completion example

1. User logs final non-bond debt payment.
2. `useDebts` cache invalidates; `useBabySteps` re-runs `reconcile()` (app is foreground).
3. Evaluator returns new statuses; diff detects Step 2 `incomplete → complete`.
4. Writes `is_completed=true, completed_at=now` to the row. `celebrated_at` remains `null`.
5. `newlyCompleted` returns `[2]`; hook pushes `{ stepNumber: 2 }` onto `celebrationStore`.
6. Foreground → `CelebrationModal` mounts; on dismiss `celebrated_at` is stamped.

**Regression:** diff detects `complete → incomplete`, clears `is_completed` and `completed_at`, **preserves `celebrated_at`**. Silent.

**Re-completion after regression:** diff detects `incomplete → complete` again. Row's `celebrated_at` is non-null → NOT pushed onto `celebrationStore`. No re-celebration. UI still reflects the completion in the list.

**Background completion:** reconcile runs on a backgrounded app-state snapshot (rare, only if a background fetch triggers cache invalidation). Hook calls `LocalNotificationScheduler.fireBabyStepCelebration(stepNumber)` which uses a null trigger for immediate delivery AND stamps `celebrated_at` directly (no user dismiss required because there's no modal). On next foreground, the modal path sees `celebrated_at` already set and stays silent.

## Sync integration (corrects review finding C2)

### SyncOrchestrator changes

`src/data/sync/SyncOrchestrator.ts`:
- Import `babySteps` from local schema.
- Add `baby_steps: babySteps` to `TABLE_MAP`.
- Extend the `SyncTable` union type.

### rowConverters changes

`src/data/sync/rowConverters.ts`:
- Add `babySteps` row → Supabase row converter (mirrors the table's columns).

### RestoreService changes

Restore `baby_steps` rows from Supabase on restore. After restore, run `SeedBabyStepsUseCase` to fill any missing step rows (idempotent via unique index).

### Tests

`SyncOrchestrator.test.ts` gains a `baby_steps` round-trip; `rowConverters.test.ts` gains row conversion tests.

### Emergency-fund duplicate resolution

After every successful sync, `ReconcileEmergencyFundTypeUseCase` runs:
- If `count(envelopes WHERE type='emergency_fund' AND !archived) > 1`, keep the oldest, flip the rest to `'savings'`, mark them `isSynced=false` to propagate. Push a Zustand `bannerStore` event: "Two devices both designated an emergency fund — we kept the oldest."

## Notification infra (corrects review finding H2)

`LocalNotificationScheduler` gains one method:

```ts
async fireBabyStepCelebration(stepNumber: number): Promise<void> {
  const { title, body } = BABY_STEP_NOTIFICATION_COPY[stepNumber];
  await Notifications.scheduleNotificationAsync({
    identifier: `baby-step-${stepNumber}-${Date.now()}`,
    content: { title, body, sound: true },
    trigger: null,
  });
}
```

`BABY_STEP_NOTIFICATION_COPY` is defined in the scheduler file — 7 entries, one per step — and matches the celebration-message copy from the step copy table.

## Seeding (addresses review finding M1)

`SeedBabyStepsUseCase.execute(householdId)`:
- For each `stepNumber` in 1..7:
  - If no row exists: insert with `is_completed=false, is_manual = (stepNumber in {4,5,7})`, timestamps now.
- Idempotent via the unique index.
- Called from:
  - `CreateHouseholdUseCase` after household creation.
  - `EnsureHouseholdUseCase` after household ensure (existing household bootstrap path).
  - `RestoreService` after a restore.
  - App startup once per session (defensive net for pre-existing households).

## Error handling

- Migration failure → existing app-startup error boundary.
- No emergency-fund envelope → evaluator returns Step 1 & 3 as `incomplete, progress: null`. UI renders the "Create an emergency fund envelope" CTA.
- No income envelope → Step 3 target undefined; UI renders "Add an income envelope to track progress" CTA; Steps 1, 2, 6 unaffected.
- Evaluator exceptions bubble to hook, which logs via existing logger and returns last-known cached statuses.
- Duplicate emergency-fund type across devices → evaluator uses oldest; `ReconcileEmergencyFundTypeUseCase` fixes post-sync; banner surfaces the collision.

## Testing

- **Unit**
  - `BabyStepEvaluator` per-step (pre-threshold / at / post / regression / no-data-available / duplicate-EMF).
  - `BabyStepRules`.
  - `BudgetBalanceCalculator` (all-income, all-expense, mixed, archived envelopes ignored, negative to-assign).
  - `SeedBabyStepsUseCase` (fresh household, partial existing, idempotent call, concurrent call).
  - `ReconcileBabyStepsUseCase` (celebration dedup via `celebratedAt`, re-completion suppression, background path).
  - `ReconcileEmergencyFundTypeUseCase` (0/1/2/3 duplicates).
- **Integration**
  - `useBabySteps` hook against in-memory sqlite.
  - `useBudgetBalance` hook.
  - `SyncOrchestrator` round-trip for `baby_steps`.
  - `RestoreService` restore includes `baby_steps` + runs seeder after.
- **Component**
  - `BabyStepsScreen`, `CelebrationModal`, `BudgetBalanceBanner` via react-native-testing-library.
- **End-to-end smoke**
  - Fresh household → seed runs → Steps 1/2/6 incomplete, 3 blocked on income, 4/5/7 manual.
  - Create income envelope + emergency envelope → fund to R1,000 → celebration fires once → regress to R800 → step reverts silently → re-fund → no re-celebration.

## Dependencies

None new. Uses existing `expo-notifications`, Drizzle, Zustand, react-navigation, react-native-paper, existing sync pipeline.

## Interactions with existing features (corrected)

- **RamseyScoreCalculator** — contract unchanged. Caller resolves `babyStepIsActive` via `resolveBabyStepIsActive(householdId)` helper.
- **Envelopes** — `envelope_type` TS union gains `'income'`; `CreateEnvelopeUseCase` / `UpdateEnvelopeUseCase` accept the new type and skip expense-style defaults for income. No SQL column changes.
- **Debts** — no change; evaluator reads existing `outstanding_balance_cents`, `debt_type`, `is_paid_off`.
- **Sync pipeline** — `TABLE_MAP`, `rowConverters`, `RestoreService` explicitly updated (not a free side-effect).
- **Household creation** — `CreateHouseholdUseCase` calls `SeedBabyStepsUseCase`.
- **Budget screen** — new banner + envelope list grouped by type; existing envelope CRUD flows unchanged beyond accepting the new type.
