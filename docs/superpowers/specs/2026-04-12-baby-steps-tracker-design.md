# Baby Steps Tracker + Zero-Based Budgeting — Design Spec

**Date:** 2026-04-12 (revised after ground-truth review + hive-mind review)
**Status:** Approved
**Related PRD requirements:** FR-32, FR-33, FR-1 (envelope mechanics), FR-38 (partial — milestone-approach coaching deferred)

## Goal

Implement the 7 Dave Ramsey Baby Steps as a structured progress framework (FR-32) with defined completion conditions and celebration events, AND introduce income envelopes so the household budget can be validated as zero-based (every rand assigned). Income tracking is a prerequisite for Step 3's monthly-expense baseline and unlocks future Step 4 auto-detection.

Auto-detect completion for Steps 1, 2, 3, 6 from envelopes + debts data. Manual toggle for Steps 4, 5, 7 (investment / college-fund / giving tracking doesn't exist yet).

## Product Decisions (recorded)

- **Background-triggered completion:** notification fires, but `celebrated_at` is **deferred** to modal dismiss on next foreground. The user always sees the ribbon-and-seal moment. Notification is a preview signal only.
- **Silent regression:** auto-revert when conditions fall below threshold. On foreground after a regression, surface a non-blocking toast ("Your Starter Fund dropped below R1,000 — Step 1 is paused until the balance recovers."). No modal.
- **`celebrated_at` is one-shot for life:** once stamped it is never cleared — regression→re-completion does not re-celebrate.
- **Steps 2 / 6 with no applicable debt:** step stays incomplete; UI shows a CTA to add debts, not an auto-complete.

## Scope

**In:**
- Add `'income'` to the `envelope_type` TypeScript union.
- Zero-based validation via `BudgetBalanceCalculator` using `totalAllocated − incomeTotal` (no type enumeration).
- `BabyStepEvaluator` + `ReconcileBabyStepsUseCase` with auto-detection for 1/2/3/6, manual toggle for 4/5/7.
- `monthlyExpenseBaseline` derived from income envelopes (deterministic).
- Ribbon-and-seal celebration event (modal in foreground, deferred modal after notification in background).
- Dashboard card + dedicated screen in Dashboard stack.
- `SeedBabyStepsUseCase` with `INSERT OR IGNORE` semantics, invoked from four sites + guarded against concurrent calls.
- `ReconcileEmergencyFundTypeUseCase` triggered only after `syncPending` returns `{ failed: 0 }`.
- Toast-on-regression, CTA-when-no-debts, distinct visual treatment for manual steps.

**Out:**
- New navigation tab.
- Confetti / particle celebration animations.
- Baby Step milestone-approaching coaching (FR-38) — separate spec.
- Investment / college-fund / giving auto-detection for Steps 4/5/7.
- Server-side uniqueness constraint on `envelope_type = 'emergency_fund'`.

## The 7 Baby Steps — completion rules (authoritative)

Let `EMF = first envelope with envelope_type = 'emergency_fund' AND is_archived = false, ordered by created_at ASC`.
Let `INCOME_TOTAL = sum(allocated_cents) across envelopes where envelope_type = 'income' AND is_archived = false AND period_start = currentPeriodStart`.
Let `monthlyExpenseBaseline = INCOME_TOTAL / 100` (ZAR). Income-based matches Ramsey teaching.

| # | Step | Mode | Condition |
|---|------|------|-----------|
| 1 | Starter Fund | Auto | `EMF != null` AND `EMF.balance_cents >= 100000` |
| 2 | Debt Free | Auto | `count(debts WHERE debt_type != 'bond' AND !archived) > 0` AND `every such debt has is_paid_off = true OR outstanding_balance_cents = 0` |
| 3 | Full Emergency Fund | Auto | `EMF != null` AND `INCOME_TOTAL > 0` AND `EMF.balance_cents >= 3 * monthlyExpenseBaseline * 100` |
| 4 | Invest 15% | Manual | `baby_steps.is_completed` (user toggled) |
| 5 | College Fund | Manual | `baby_steps.is_completed` (user toggled) |
| 6 | House Free | Auto | `count(debts WHERE debt_type = 'bond' AND !archived) > 0` AND `every such debt has is_paid_off = true OR outstanding_balance_cents = 0` |
| 7 | Build & Give | Manual | `baby_steps.is_completed` (user toggled) |

`EMF.balance_cents = EMF.allocated_cents - EMF.spent_cents`.

**Step 3 with `INCOME_TOTAL = 0`:** blocked, `progress = null`. Never auto-completes from zero-divided-by-zero.

**Zero-debt behaviour:** Steps 2/6 stay incomplete when no applicable debt exists; the UI CTA is "No debts tracked yet. Add accounts in the Debt tracker to unlock."

## Zero-based budgeting

- `envelope_type` TS union gains `'income'` (existing values: `'spending' | 'savings' | 'emergency_fund' | 'baby_step' | 'utility'`). No DB-level enum change — enum is TypeScript-only.
- Income envelopes: `allocatedCents` = expected/actual income for the period. `spentCents` must remain 0.
- **Enforcement (critical):** `CreateTransactionUseCase` rejects transactions whose target envelope has `envelope_type = 'income'`. `UpdateEnvelopeUseCase` rejects setting `spentCents != 0` on an income envelope. Both are domain-layer assertions.
- `BudgetBalanceCalculator` (pure):
  - Input: `envelopes[]` for a single period.
  - `incomeTotal = sum(allocatedCents WHERE type='income' AND !archived)`
  - `totalAllocated = sum(allocatedCents WHERE !archived)`
  - `expenseAllocationTotal = totalAllocated - incomeTotal`
  - `toAssign = incomeTotal - expenseAllocationTotal`
  - **Sealed against future envelope types** — no enumeration.
- `BudgetBalanceBanner` on Budget screen shows `incomeTotal / expenseAllocationTotal / toAssign`. `toAssign == 0` shows "Every rand assigned ✓"; `toAssign < 0` shows `-R{abs} overcommitted` in warning colour.
- Envelope list on Budget screen groups by `type === 'income'` into two sections: "Income" and "Expenses".
- **Caller filtering contract:** the calculator sums all passed envelopes. Callers filter to current period before passing.

## Architecture — Evaluator-on-read

`BabyStepEvaluator` is pure. `ReconcileBabyStepsUseCase` reads source data, calls the evaluator, diffs against persisted `baby_steps` rows, writes transitions, returns `{ statuses, newlyCompleted, newlyRegressed }`. Called on Dashboard / BabyStepsScreen mount and on envelope/debts cache invalidation — **but only when `AppState.currentState === 'active'`**.

### Cross-domain boundary

`ReconcileBabyStepsUseCase` imports `BudgetBalanceCalculator` from `src/domain/budget/` to compute `INCOME_TOTAL`. This is the only cross-domain dependency; recorded explicitly.

### Concurrency guards

1. **Reconcile lock:** `useBabySteps` hook uses `useRef` to track an in-flight reconcile. A second concurrent call is coalesced (returns the same promise).
2. **Celebration queue dedup:** `celebrationStore.enqueue(stepNumber)` is idempotent — if `stepNumber` is already in the queue OR the step's persisted `celebrated_at` is non-null, the push is dropped. The store does the dedup; `ReconcileBabyStepsUseCase` returns facts only.
3. **Seeder:** `SeedBabyStepsUseCase` uses `INSERT OR IGNORE` SQL; safe under concurrent invocation.

## Data model

### Local migration

**`src/data/local/migrations/0003_baby_steps_columns.sql`** — columns only, table already exists from migration 0000:

```sql
ALTER TABLE baby_steps ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE baby_steps ADD COLUMN celebrated_at TEXT;
```

**`drizzle-kit generate` must be run** after schema file edits to regenerate `src/data/local/migrations/migrations.js` and `meta/_journal.json`. Migration file is named to match drizzle-kit's next slot; developer re-runs generate if the name collides.

### Drizzle schema edits (required alongside the migration — not optional)

`src/data/local/schema/babySteps.ts`:

```ts
export const babySteps = sqliteTable('baby_steps', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  stepNumber: integer('step_number').notNull(),
  isCompleted: integer('is_completed', { mode: 'boolean' }).notNull().default(false),
  completedAt: text('completed_at'),
  isManual: integer('is_manual', { mode: 'boolean' }).notNull().default(false),  // NEW
  celebratedAt: text('celebrated_at'),                                             // NEW
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
```

Without these edits, Drizzle queries will silently drop the new fields — writes to `celebratedAt` will no-op.

### Supabase remote migration

**`supabase/migrations/003_baby_steps_and_income_envelopes.sql`** (new file):

```sql
CREATE TABLE IF NOT EXISTS public.baby_steps (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TEXT,
  is_manual BOOLEAN NOT NULL DEFAULT FALSE,
  celebrated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_baby_steps_household_step
  ON public.baby_steps (household_id, step_number);

-- If envelope_type has a check constraint on the remote, drop and re-add to
-- include 'income'. If it's an unconstrained text column, this is a no-op.
-- (Follow existing convention in 001_initial_schema.sql.)
```

RLS policies must mirror the existing envelopes policies (household_id scoped).

### Invariants

- Steps 1–7 exist for every household; enforced by `SeedBabyStepsUseCase`.
- Multiple `'emergency_fund'` envelopes tolerated by evaluator (oldest wins); `ReconcileEmergencyFundTypeUseCase` resolves post-sync.
- `celebrated_at`, once stamped, is never cleared — not on regression, not on re-completion.
- `spent_cents` on income envelopes is always 0 — enforced in `CreateTransactionUseCase` + `UpdateEnvelopeUseCase`.

## Domain layer

**`src/domain/babySteps/`**

| File | Purpose |
|------|---------|
| `BabyStepRules.ts` | Rule table per step: evaluation fn + short title + description + completion message + progress template + notification title/body |
| `BabyStepEvaluator.ts` | Pure. Input: `{ envelopes, debts, monthlyExpenseBaseline, manualFlags }`. Output: `BabyStepStatus[]` |
| `ReconcileBabyStepsUseCase.ts` | Reads repos, calls evaluator, diffs vs persisted, writes transitions with `isSynced=false`, returns `{ statuses, newlyCompleted, newlyRegressed }` |
| `ToggleManualStepUseCase.ts` | Flips manual steps 4/5/7; writes `isSynced=false` |
| `StampCelebratedUseCase.ts` | Sets `celebrated_at = now`, `isSynced=false`. Called from modal dismiss (both foreground and deferred-foreground paths) |
| `SeedBabyStepsUseCase.ts` | Per-household seed; `INSERT OR IGNORE`; idempotent under concurrency |
| `ReconcileEmergencyFundTypeUseCase.ts` | Post-full-sync fixer: oldest emergency_fund envelope wins; others flip to `'savings'` with `isSynced=false` |
| `__tests__/*.test.ts` | Per-class |

**`src/domain/budget/`**

| File | Purpose |
|------|---------|
| `BudgetBalanceCalculator.ts` | Pure. `totalAllocated - incomeTotal` (no enumeration) |
| `__tests__/BudgetBalanceCalculator.test.ts` | Unit tests |

**`src/domain/shared/`**

| File | Purpose |
|------|---------|
| `resolveBabyStepIsActive.ts` | Thin helper: `any(baby_steps WHERE household_id=X AND is_completed = true)`. Returns `false` when no rows exist |

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
  newlyCompleted: number[];
  newlyRegressed: number[];
};
```

## Scoring integration

`RamseyScoreCalculator` is unchanged. Caller resolves `babyStepIsActive` via `resolveBabyStepIsActive(householdId)` helper in `src/domain/shared/`.

## Presentation layer

**Hook:** `src/presentation/hooks/useBabySteps.ts`
- Wraps `ReconcileBabyStepsUseCase`.
- Exposes `{ statuses, reconcile, toggleManualStep(n) }`.
- Reconcile coalesced via `useRef` promise guard.
- Re-reconciles on mount and on `envelopes`/`debts` query invalidation, only when `AppState.currentState === 'active'`.
- `AppState` foreground transition: if any queued notifications fired while backgrounded, reconcile and let the queue flush into the modal.
- On `newlyCompleted`, enqueues to `celebrationStore` (dedup inside the store).
- On `newlyRegressed`, enqueues toast event to `toastStore`.

**Store:** `src/presentation/stores/celebrationStore.ts`
- Zustand. Queue of `{ stepNumber, triggeredAt }`.
- `enqueue(stepNumber)` — drops push if (a) already in queue, or (b) persisted `celebrated_at` is non-null.
- UI modal consumes from queue head; on dismiss calls `StampCelebratedUseCase(stepNumber)`.

**Store:** `src/presentation/stores/toastStore.ts` (or existing if already present)
- Queues regression toasts with canonical copy from `BabyStepRules`.

**Hook:** `src/presentation/hooks/useBudgetBalance.ts`
- Wraps `BudgetBalanceCalculator` over current-period envelopes.

**Screens:** `src/presentation/screens/babySteps/`
- `BabyStepsScreen.tsx` — three-tier layout.
- `CelebrationModal.tsx` — ribbon-and-seal overlay.
- Components under `src/presentation/screens/babySteps/components/`:
  - `StepSealMark.tsx` — one SVG per step, state prop: `future | current | complete`.
  - `SevenDotPath.tsx` — dashboard indicator (with compact fallback, see below).
  - `CurrentStepHero.tsx` — hero card with progress ring or manual toggle.
  - `ManualStepPanel.tsx` — **distinct component** from the auto-step hero. Large switch, explicit label "You decide when this is complete — tap to mark done." Icon differs from the ring-based auto layout so manual vs auto is visually unambiguous.

**Budget screen integration:** `src/presentation/screens/budgets/components/BudgetBalanceBanner.tsx` — top of Budget screen. Envelope list sectioned by income/expense.

**Envelope create/edit:** existing screens accept `'income'` in the type picker. Route params supported so deep-link CTA from the Baby Steps hero can preselect the type — spec requires verifying `CreateEnvelopeScreen` accepts a `preselectedType` nav param (implementation task tracks this).

**Dashboard:** `BabyStepsCard.tsx` — renders `SevenDotPath` + current title + progress line. Taps → `BabyStepsScreen`.

**Navigation:** `BabyStepsScreen` + `CelebrationModal` in `DashboardStackNavigator`. No new tab. No new Settings row.

## Visual Identity

The Baby Steps surface is emotionally loaded — earned over years. Earnest and weighty, not gamified.

### Celebration: ribbon-and-seal stamp

- `CelebrationModal` full-screen overlay.
- Seal: step's `StepSealMark` at 144×144 (modal base), spring animation from `scale: 0.6, opacity: 0` → `scale: 1.0, opacity: 1` over ~600ms with an overshoot easing. Animation can be disabled via a `reducedMotion` prop that the test environment sets.
- Beneath: short title (display font), completion message (body font).
- Ribbon banner reads "Completed <date>".
- Background: muted ledger-paper tint overlay; no gradients.
- Dismiss button triggers `StampCelebratedUseCase`.

No confetti, particles, sparkles.

### Dashboard card: seven-dot path + compact fallback

- Primary layout: 7 circular nodes connected by a thin line. States: **Complete** (filled, check glyph), **Current** (larger, outlined, 2s opacity pulse 0.6↔1.0), **Future** (outlined muted).
- **Compact fallback** for device widths < 360dp: render "Step X of 7 · <current title>" with a miniature filled-dots ratio indicator (e.g., `●●●○○○○`). Determined at render time via `useWindowDimensions`.

### BabyStepsScreen: three-tier layout

1. **Completed chips row** — horizontal scroll. 24×24 seal, step number, completion date. Tap → bottom-sheet.
2. **Current step hero** — large card. Progress ring (auto) or `ManualStepPanel` (manual). Step 2/6 with no applicable debt renders a CTA card instead: "No debts tracked yet. Add accounts in Debt tracker to unlock."
3. **Future steps list** — vertical list of dimmed monochrome cards. Opacity-muted, no accent, no progress.

Manual steps in the list (4/5/7) are visually tagged with a small "Manual" chip in the chip row and the future-step card to distinguish them from auto steps.

### Step seals

| # | Concept |
|---|---------|
| 1 | Envelope glyph with "R1,000" embossed |
| 2 | Broken chain link |
| 3 | Shield / fortress wall |
| 4 | Sprouting seedling |
| 5 | Graduation mortarboard |
| 6 | House key |
| 7 | Open hand (giving) |

Consistent stroke weight, single brand accent. **Sizes:** 96×96 hero, 144×144 modal base (animated from 86), 24×24 chip.

### Typography

Project's existing display + body pairing. Progress digits in tabular-numeric variant.

### Accessibility

- Progress ring `accessibilityLabel`: `"Step {n}: {title}, {percent}% complete, {current} of {target}"` (or `"{current} of {target} debts cleared"` for Step 2).
- `SevenDotPath` `accessibilityLabel`: `"Baby Steps progress: {completed} of 7 steps complete, currently on Step {n}"`.
- Future-step cards set `accessibilityElementsHidden={true}` on the list container OR provide reduced labels.
- Completed chip foreground/background contrast ratio ≥ 4.5:1 (WCAG AA) in both light and dark themes.
- Manual step toggle announces role as switch with its current state.

### Step copy (canonical, verbatim — also used for notification title/body and toast text)

| # | Short title | Description | Completion message | Regression toast | Progress template |
|---|-------------|-------------|--------------------|------------------|-------------------|
| 1 | Starter Fund | Save R1,000 as your first emergency buffer. | You saved your first R1,000. The foundation is laid. | Your Starter Fund dropped below R1,000 — Step 1 is paused until the balance recovers. | `R{current} of R{target}` |
| 2 | Debt Free | Pay off every debt except the house. | Every debt, gone. You owe no one but the bond. | A non-bond debt is back on the books — Step 2 is paused. | `{current} of {target} debts cleared` |
| 3 | Full Emergency Fund | Save 3 to 6 months of expenses. | Three months of expenses, saved. You're protected. | Your emergency fund fell below 3 months of expenses — Step 3 is paused. | `R{current} of R{target}` |
| 4 | Invest 15% | Put 15% of income into retirement. | You're investing in the long game now. | (manual — no regression path) | (manual) |
| 5 | College Fund | Save for your children's education. | One of the hardest steps — and you did it. | (manual — no regression path) | (manual) |
| 6 | House Free | Pay off the bond. | No debt. No bond. The house is yours. | The bond is back — Step 6 is paused. | `R{current} of R{target}` |
| 7 | Build & Give | Build wealth. Give generously. | You have enough — and you're giving. | (manual — no regression path) | (manual) |

### Duplicate-EMF banner copy

"We found two emergency fund envelopes (one from each device). We kept the original. The other is now a Savings envelope — check your Budget to confirm."

## Data flow

### Step 2 completion — foreground

1. User logs final non-bond debt payment.
2. `useDebts` cache invalidates → `useBabySteps.reconcile()` (coalesced).
3. Evaluator returns new statuses; diff detects Step 2 `incomplete → complete`.
4. Writes `is_completed=true, completed_at=now, isSynced=false` to `baby_steps`. `celebrated_at` stays `null`.
5. `newlyCompleted=[2]`; hook enqueues `{ stepNumber: 2 }` to `celebrationStore` (store dedups against persisted `celebrated_at`).
6. `CelebrationModal` mounts, plays spring animation.
7. User taps "Continue" → `StampCelebratedUseCase` stamps `celebrated_at=now, isSynced=false`.

### Step 2 completion — background (deferred modal path)

1. Background cache invalidation triggers reconcile check. `AppState.currentState === 'background'` — hook skips reconcile.
2. If the reconcile was already in flight when backgrounding occurred, the persisted row is written but `celebrationStore` is not flushed (no UI mounted). `celebrated_at` remains null.
3. `LocalNotificationScheduler.fireBabyStepCelebration(2)` is called as a signal — the user sees "Every debt, gone. You owe no one but the bond." as a notification. No domain state is written by the scheduler.
4. On foreground, `useBabySteps.reconcile()` re-runs, sees Step 2 is complete with `celebrated_at=null`, enqueues to `celebrationStore`, modal fires.
5. User taps "Continue" → stamp.

The user always sees the seal.

### Regression

1. Diff detects `complete → incomplete`. Clears `is_completed` and `completed_at`. **`celebrated_at` is preserved.** `isSynced=false`.
2. `newlyRegressed=[n]` → hook enqueues regression toast via `toastStore`.
3. Toast surfaces on next UI tick.

### Re-completion after regression

Diff detects `incomplete → complete`. Writes `is_completed=true, completed_at=now`. Row's `celebrated_at` is already set → `celebrationStore.enqueue` drops the push. No re-celebration. UI reflects the completion.

## Sync integration

### SyncOrchestrator

`src/data/sync/SyncOrchestrator.ts`:
- Import `babySteps`.
- Add `baby_steps: babySteps` to `TABLE_MAP`.
- Extend `SyncTable` union.

### rowConverters

`src/data/sync/rowConverters.ts`:
- Add explicit `babySteps` tests for boolean-integer mapping (`is_completed: 0/1 ↔ boolean`).

### RestoreService

`src/data/sync/RestoreService.ts`:
- Add `baby_steps` to `restoreTable` dispatch.
- Extend the table union on line ~110.
- **After restore completes, call `SeedBabyStepsUseCase`** for each restored household — fills any missing rows. Idempotent.

### `celebrated_at` merge strategy (critical)

Plain `upsert(..., { onConflict: 'id' })` overwrites all columns including `celebrated_at`. This would lose a stamp set on a device that hasn't synced yet.

**Approach:** on the Supabase side, create a PL/pgSQL RPC `merge_baby_step(...)` that performs an insert-or-update that **preserves** `celebrated_at` when `excluded.celebrated_at IS NULL AND existing.celebrated_at IS NOT NULL`. `SyncOrchestrator.processItem` routes `baby_steps` rows to this RPC instead of `upsert`. All other columns follow standard LWW on `updated_at`.

The RPC is included in the `003_baby_steps_and_income_envelopes.sql` Supabase migration.

### `isSynced=false` invariant

Every domain write to `baby_steps` (reconcile transitions, manual toggles, celebrate stamps) sets `isSynced=false`. This is explicit contract in each use case — not an implicit assumption.

### `ReconcileEmergencyFundTypeUseCase` trigger

Runs **after** `SyncOrchestrator.syncPending` returns `{ failed: 0 }` — a full clean sync. Not after partial syncs. Prevents mid-batch diverged states.

## Notification infrastructure

`LocalNotificationScheduler` gains one method:

```ts
async fireBabyStepCelebration(stepNumber: number): Promise<void>
```

- Identifier: `baby-step-${stepNumber}-${nonce}` where `nonce = Date.now() + Math.random().toString(36).slice(2, 6)` — guaranteed unique even under fake timers.
- Title/body: read from `BabyStepRules.NOTIFICATION_COPY[stepNumber]`. The scheduler does NOT define its own copy constants — single source of truth is `BabyStepRules.ts`.
- Trigger: `null` (fires immediately).
- **Scheduler writes no domain state.** `celebrated_at` is stamped only by `StampCelebratedUseCase`, called from modal dismiss.

## Seeding

`SeedBabyStepsUseCase.execute(householdId)`:
- Single SQL `INSERT OR IGNORE INTO baby_steps (...) VALUES (...), (...), ... (...)` for all 7 rows.
- Idempotent under concurrent invocation — the unique index enforces dedup without throwing.
- `isManual=true` for steps 4/5/7.
- Called from:
  - `CreateHouseholdUseCase` (post-create).
  - `EnsureHouseholdUseCase` (post-ensure).
  - `RestoreService` (post-restore, per household).
  - App startup routine (once per cold start).

Startup invocation runs **after** `RestoreService` completes, not before. The app bootstrap sequence is: migrations → restore (if available) → seed.

## Error handling

- Migration failure → existing app-startup error boundary.
- No emergency-fund envelope → Steps 1 & 3 `incomplete, progress: null`. CTA rendered.
- No income envelope → Step 3 `incomplete, progress: null`. CTA rendered; Steps 1/2/6 unaffected.
- No applicable debts → Steps 2/6 `incomplete, progress: null`. CTA rendered.
- Evaluator exceptions → logged; hook returns last-known statuses.
- Duplicate EMF post-sync → fixer flips; banner surfaces.
- Reconcile in flight + second call → coalesced (returns first call's promise).
- Income envelope targeted by transaction → `CreateTransactionUseCase` throws `InvalidEnvelopeTypeError`.

## Testing

### Explicit step × state matrix (table-driven)

35 minimum scenarios — one row per `(step, state)` pair:

| Step | Pre-threshold | At threshold − 1 cent | At threshold exactly | At threshold + 1 cent | Regression | No source data |
|------|---------------|------------------------|----------------------|------------------------|------------|----------------|
| 1 | incomplete | incomplete | complete | complete | complete→incomplete | no EMF → null progress |
| 2 | some debts paid | all but one paid | all paid + at least one existed | all paid | paid→unpaid | no non-bond debts → null progress |
| 3 | EMF < 3× baseline | 1 cent below | exact | 1 cent above | falls below | INCOME_TOTAL = 0 → null |
| 4, 5, 7 | off | n/a | toggled on | n/a | toggled off | n/a |
| 6 | some bonds outstanding | n/a | all paid + bond existed | n/a | re-mortgaged | no bond → null |

### Clock injection

No existing clock abstraction. Time-sensitive tests use `jest.useFakeTimers()` + `jest.setSystemTime(new Date('2026-04-12'))` and advance timers explicitly. Document in spec: timestamp fields in domain writes use `new Date().toISOString()` — test with fake timers.

### AppState mocking

```ts
jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  return {
    ...rn,
    AppState: {
      currentState: 'active',
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    },
  };
});
```

Test cases:
- Hook mounted with `AppState.currentState = 'background'`: assert reconcile NOT called.
- Foreground event fires: assert reconcile IS called.

### CelebrationModal animation

Component tests set `reducedMotion={true}` to skip spring timing. A dedicated animation-timing test uses `jest.useFakeTimers()` + `act()` + 700ms advance to verify final state.

### Race conditions

- `Promise.all([reconcile(), reconcile()])`: only one DB write sequence occurs; queue length = 1 after both resolve.
- Background→foreground mid-modal: `celebrationStore` does not double-queue (enforced by queue dedup).
- `Promise.all([seed(h), seed(h)])`: no unhandled rejection; final row count = 7.

### Seeder edge cases

- Empty DB → 7 rows inserted.
- 6 rows exist (step 5 missing) → only step 5 inserted; existing row timestamps unchanged.
- All 7 exist → no-op.

### Sync coverage

- `SyncOrchestrator` round-trip for `baby_steps` with `celebrated_at` merge RPC (mocked).
- `rowConverters` explicit boolean-integer mapping for `is_completed`, `is_manual`, `is_synced`.
- `RestoreService` restores `baby_steps` then invokes `SeedBabyStepsUseCase`.
- Partial-sync: `ReconcileEmergencyFundTypeUseCase` NOT called when `failed > 0`.
- Multi-EMF with one archived: fixer skips the archived envelope.

### Component

- `BabyStepsScreen` — all three tiers render; CTA for no-emergency-fund; CTA for no-income; CTA for Step 2 no-debts.
- `CelebrationModal` — reducedMotion path + timed animation path.
- `BudgetBalanceBanner` — positive, zero, negative `toAssign` states.
- `ManualStepPanel` — toggle role, a11y state, distinct visual from auto hero.
- `SevenDotPath` — narrow-device compact fallback.

### Helper tests

- `resolveBabyStepIsActive` — household with no rows → `false`; one step complete → `true`; all 7 complete → `true`.
- `BudgetBalanceCalculator` — negative `toAssign`; archived envelopes excluded; mixed periods (caller-filter contract documented).

### End-to-end smoke

1. Fresh household → seed → Steps 1/2/6 incomplete with CTAs, 3 blocked on income, 4/5/7 manual.
2. Create income + emergency envelopes → R1,000 → celebration modal → dismiss → regress to R800 → silent revert + toast → re-fund → no re-celebration.
3. Two devices, both designate emergency fund → sync → fixer flips one to savings → banner fires.

## Dependencies

None new. Uses existing `expo-notifications`, Drizzle, Zustand, react-navigation, react-native-paper, existing sync pipeline.

## Interactions with existing features (corrected)

- **RamseyScoreCalculator** — contract unchanged; caller wires via `resolveBabyStepIsActive` helper in `src/domain/shared/`.
- **Envelopes** — TS union gains `'income'`. `CreateEnvelopeUseCase` / `UpdateEnvelopeUseCase` accept the type; `UpdateEnvelopeUseCase` blocks `spentCents != 0` on income envelopes. Route param `preselectedType` added to `CreateEnvelopeScreen`.
- **Debts** — no change.
- **Transactions** — `CreateTransactionUseCase` rejects income-envelope targets (new domain rule).
- **Sync pipeline** — `TABLE_MAP`, `rowConverters`, `RestoreService`, Supabase migration, `merge_baby_step` RPC all explicitly required.
- **Household creation** — `CreateHouseholdUseCase` calls `SeedBabyStepsUseCase`.
- **Budget screen** — new banner + envelope list sectioned by type.
