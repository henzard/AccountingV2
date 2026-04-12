# Baby Steps Tracker — Design Spec

**Date:** 2026-04-12
**Status:** Approved
**Related PRD requirements:** FR-32, FR-33, FR-38 (partial — notifications of milestone approach deferred)

## Goal

Implement the 7 Dave Ramsey Baby Steps as a structured progress framework (FR-32), with each step having a defined completion condition and a celebration event. Auto-detect completion for Steps 1, 2, 3, 6 from existing financial data; manual toggle for Steps 4, 5, 7 (no investment / college-fund / giving tracking exists yet).

## Scope

**In:**
- Auto-detection of Baby Steps 1, 2, 3, 6 from envelopes + debts data
- Manual toggle for Steps 4, 5, 7
- Celebration event on completion (in-app modal when foregrounded, local notification when backgrounded)
- Dynamic revert when auto-detect conditions fall below threshold (silent — no warning banner)
- Dashboard card + dedicated screen under Dashboard stack
- Settings flow to designate an envelope as the emergency fund

**Out:**
- New navigation tab (lives inside existing Dashboard stack)
- Confetti via new native library (CSS-only animation)
- Baby Step milestone coaching notifications (FR-38) — deferred to notification rule pack work
- Investment / college-fund / giving tracking (required for true auto-detect on Steps 4, 5, 7)

## The 7 Baby Steps — completion rules

| # | Step | Mode | Condition |
|---|------|------|-----------|
| 1 | R1,000 starter emergency fund | Auto | `emergencyFundEnvelope.balance >= 1000` |
| 2 | Pay off all non-mortgage debt | Auto | No `debts` row with `type != 'bond'` has `balance > 0`; at least one such debt existed historically |
| 3 | 3–6 months expenses saved | Auto | `emergencyFundEnvelope.balance >= 3 * monthlyExpenseBaseline` |
| 4 | Invest 15% of income | Manual | User toggle |
| 5 | Kids' college fund | Manual | User toggle |
| 6 | Pay off house early | Auto | No `debts` row with `type = 'bond'` has `balance > 0`; a bond existed historically |
| 7 | Build wealth & give | Manual | User toggle |

`monthlyExpenseBaseline` = sum of envelope monthly allocations, excluding the emergency fund envelope.

**Edge cases:**
- No emergency fund envelope designated → Steps 1 & 3 remain incomplete; UI prompts designation.
- No qualifying debt has ever existed → that auto-step auto-completes.

## Architecture — Approach 1: Evaluator-on-read

`BabyStepEvaluator` is pure. `ReconcileBabyStepsUseCase` reads source data, calls the evaluator, diffs against persisted `baby_steps` rows, writes transitions, and returns `{ statuses, newlyCompleted, newlyRegressed }`. Called whenever Dashboard or BabySteps screens mount, or when underlying data changes.

**Rationale:** simple, pure, no race conditions, reconcilable from source data at any time. Celebrations fire on next app open if triggered while backgrounded — acceptable because the product is built around a daily app-open loop.

## Data model

**Migration:** `src/data/local/migrations/0003_baby_steps_emergency_fund.sql`

```sql
ALTER TABLE envelopes ADD COLUMN is_emergency_fund INTEGER NOT NULL DEFAULT 0;
ALTER TABLE baby_steps ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE baby_steps ADD COLUMN celebrated_at TEXT;
```

**Invariants:**
- At most one envelope per household has `is_emergency_fund = 1` (enforced in `DesignateEmergencyFundUseCase`).
- `baby_steps` seeded on first app open after migration: 7 rows per household, `is_manual = 1` for steps 4/5/7.

**Sync:** `baby_steps` joins the existing sync pipeline via `rowConverters.ts`; standard last-write-wins on `updatedAt`.

## Domain layer

New directory: `src/domain/babySteps/`

| File | Purpose |
|------|---------|
| `BabyStepRules.ts` | Rule table: step number → evaluation fn + label + description |
| `BabyStepEvaluator.ts` | Pure. Input: `{ envelopes, debts, monthlyExpenseBaseline, manualFlags }`. Output: `BabyStepStatus[]` |
| `ReconcileBabyStepsUseCase.ts` | Reads repos, calls evaluator, diffs vs persisted state, writes transitions, returns `{ statuses, newlyCompleted, newlyRegressed }` |
| `ToggleManualStepUseCase.ts` | Flips manual steps (4/5/7) on/off |
| `DesignateEmergencyFundUseCase.ts` | Enforces "at most one" invariant — clears the flag on the previous fund envelope in the same transaction |
| `__tests__/*.test.ts` | One per class; rule table gets exhaustive fixtures |

`BabyStepStatus`:
```ts
{
  stepNumber: 1..7,
  isCompleted: boolean,
  isManual: boolean,
  progress: { current: number, target: number } | null,  // null for manual steps
  completedAt: string | null,
}
```

## Presentation layer

**Hook:** `src/presentation/hooks/useBabySteps.ts`
- Wraps `ReconcileBabyStepsUseCase`.
- Exposes `{ statuses, reconcile, toggleManualStep(n), designateEmergencyFund(envelopeId) }`.
- Re-reconciles on mount and when envelopes or debts caches invalidate.
- Pushes newly-completed step numbers to `celebrationStore`.

**Store:** `src/presentation/stores/celebrationStore.ts`
- Zustand. Queue of `{ stepNumber, triggeredAt }`.
- UI modal consumes queue; on dismiss, stamps `celebrated_at` via use case so the same completion cannot re-celebrate.
- On push, checks `AppState`: foreground → modal only; background → calls `LocalNotificationScheduler.scheduleImmediate(...)`.

**Screens:** `src/presentation/screens/babySteps/`
- `BabyStepsScreen.tsx` — list of all 7 steps with progress bars, status, manual toggle for 4/5/7, "Set emergency fund" CTA if none designated.
- `CelebrationModal.tsx` — overlay triggered by `celebrationStore`. Step-specific copy, CSS confetti animation, Continue button.

**Dashboard:** `src/presentation/screens/dashboard/components/BabyStepsCard.tsx` — compact "Step X of 7 — <progress summary>". Tap → navigates to `BabyStepsScreen`. Wired into existing `DashboardScreen.tsx`.

**Settings:** new row in `SettingsScreen` → "Emergency Fund Envelope" → pushes `EmergencyFundPickerScreen` (inside `SettingsStackNavigator`) that lists envelopes and confirms.

**Navigation:** `BabyStepsScreen` + `CelebrationModal` registered in `DashboardStackNavigator`. `EmergencyFundPickerScreen` in `SettingsStackNavigator`. No new tab.

## Data flow — Step 2 completion example

1. User logs final non-bond debt payment.
2. `useDebts` cache invalidates; `useBabySteps` subscription re-runs `reconcile()`.
3. Evaluator returns new statuses; diff detects Step 2 `incomplete → complete`.
4. Writes `isCompleted=true, completedAt=now, celebrated_at=null` to `baby_steps`.
5. Hook pushes `{ stepNumber: 2 }` onto `celebrationStore`.
6. Foreground → `CelebrationModal` mounts. Background → immediate local notification.
7. On dismiss, `celebrated_at` is stamped; the same completion cannot re-fire.

**Regression:** same pipeline; diff detects `complete → incomplete`, clears `isCompleted`, `completedAt`, `celebrated_at`. Silent — UI reflects new state, no notification.

## Error handling

- Migration failure → existing app-startup error boundary.
- Missing emergency fund envelope → evaluator returns partial result; UI shows the CTA.
- Evaluator exceptions bubble to hook, which logs and returns last-known cached statuses.

## Testing

- **Unit:** `BabyStepEvaluator` (each step: pre-threshold, at-threshold, post-threshold, regression), `BabyStepRules`, use cases with mocked repos.
- **Integration:** `useBabySteps` against in-memory sqlite, seeded households, assert correct transitions and celebration queue events.
- **Component:** `BabyStepsScreen`, `CelebrationModal` via react-native-testing-library.
- **Sync:** round-trip test for `baby_steps` via `SyncOrchestrator`.

## Dependencies

None new. Uses existing `expo-notifications` / `LocalNotificationScheduler`, existing Drizzle, existing Zustand, existing react-native-paper.

## Interactions with existing features

- **Ramsey Score (`src/domain/scoring/RamseyScoreCalculator.ts`)**: already references Baby Step progress (FR-33). It reads from `baby_steps` rows; this spec does not change that contract. Score updates land at the next score recomputation after a reconcile.
- **Envelopes**: new column `is_emergency_fund`; `CreateEnvelopeUseCase` and `UpdateEnvelopeUseCase` need no changes (column defaults to 0).
- **Debts**: no change; evaluator reads existing `balance` and `type`.
