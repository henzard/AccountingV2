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
- Confetti / particle celebration animations — explicitly rejected (see Visual Identity)

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
- `BabyStepsScreen.tsx` — three-tier layout (see Visual Identity): hero card for the current step, chip row of completed steps above it, dimmed future-step cards beneath. Manual toggle for 4/5/7 inside each card. "Set emergency fund" CTA shown in the current-step hero if no envelope is designated.
- `CelebrationModal.tsx` — ribbon-and-seal stamp overlay (see Visual Identity). Step-specific seal + copy, "Continue" button. No confetti or particle effects.
- Shared components under `src/presentation/screens/babySteps/components/`:
  - `StepSealMark.tsx` — the per-step iconic seal (one SVG per step, parameterised by state: future/current/complete).
  - `SevenDotPath.tsx` — horizontal 7-dot progress indicator used in the dashboard card.
  - `CurrentStepHero.tsx` — the big hero card with progress ring + current numbers.

**Dashboard:** `src/presentation/screens/dashboard/components/BabyStepsCard.tsx` — renders `SevenDotPath` across the top, current step title + one-line progress beneath (e.g., "Starter Fund — R650 of R1,000"). Tap → navigates to `BabyStepsScreen`. Wired into existing `DashboardScreen.tsx`. No default react-native-paper `ProgressBar` on this card.

**Settings:** new row in `SettingsScreen` → "Emergency Fund Envelope" → pushes `EmergencyFundPickerScreen` (inside `SettingsStackNavigator`) that lists envelopes and confirms.

**Navigation:** `BabyStepsScreen` + `CelebrationModal` registered in `DashboardStackNavigator`. `EmergencyFundPickerScreen` in `SettingsStackNavigator`. No new tab.

## Visual Identity

The Baby Steps surface is the most emotionally loaded area of the app — these milestones are earned over years, not days. The visual treatment must feel earnest and weighty, not gamified or party-like. Default Material / confetti aesthetics are explicitly rejected.

### Celebration: ribbon-and-seal stamp

On step completion, `CelebrationModal` presents a full-screen overlay styled as a certificate / ledger stamp:

- Center: the step's `StepSealMark` SVG scaled up, with a soft drop-shadow and a subtle drop-and-settle spring animation on mount (transform + opacity only, ~600ms).
- Beneath: the step's short title in a display font, the completion message in body.
- A ribbon-banner strip across the seal reads "Completed <date>".
- Background: muted ledger-paper tint overlay, not a gradient.
- Dismiss via "Continue" button; the seal is retained and re-shown on the step's chip in the main screen.

No confetti. No particle effects. No sparkles.

### Dashboard card: seven-dot path

`BabyStepsCard` uses `SevenDotPath` — seven small circular nodes connected by a thin line, spanning the card width. States per dot:

- **Complete:** filled with brand accent, a small check glyph centered.
- **Current:** larger, outlined with brand accent, subtle pulse (opacity 0.6 ↔ 1.0, 2s loop).
- **Future:** outlined in muted tone, unfilled.

Beneath the path: current step title + progress line (e.g., `Starter Fund — R650 of R1,000`).

### BabyStepsScreen: three-tier layout

Visually encodes past / present / future as distinct treatments:

1. **Completed chips row** — horizontally scrolling strip at the top. Each chip: tiny `StepSealMark`, step number, completion date. Tapping a chip opens a small details sheet (date, step title, description).
2. **Current step hero** — large card occupying the bulk of the screen. Contains a circular progress ring (for auto steps) or a large toggle (for manual steps 4/5/7), step title, description, progress numbers, and any CTA (e.g., "Set emergency fund").
3. **Future steps list** — vertical list of dimmed monochrome cards beneath the hero. Reduced opacity, no accent color, no progress. Shows step number + short title only.

This deliberately breaks the uniform-list pattern. The user's eye lands on the current step immediately.

### Step seals (per-step iconography)

Each step has a dedicated `StepSealMark` SVG. These are the canonical visual identities and must not be substituted with generic icons:

| # | Seal concept |
|---|--------------|
| 1 | Envelope glyph with "R1,000" embossed inside |
| 2 | A broken chain link |
| 3 | A shield / fortress wall |
| 4 | A sprouting seedling (growth) |
| 5 | A graduation mortarboard |
| 6 | A house key |
| 7 | An open hand (giving) |

All seals share a consistent stroke weight, corner radius, and a single brand accent color. Dimensions: 96×96 on the hero, 48×48 in the celebration modal (scaled 2× on mount animation), 24×24 in completed chips.

### Typography

Use the project's existing display + body font pairing. Titles in display, progress numbers and body in body. Progress numbers (e.g., "R650 of R1,000") should be in a tabular-numeric variant so digits don't jitter during reconciliation.

### Step copy table

Canonical copy to be implemented verbatim. Short title ≤4 words; description ≤12 words; completion message is second-person and earnest, not celebratory.

| # | Short title | Description | Completion message | Progress template |
|---|-------------|-------------|-------------------|-------------------|
| 1 | Starter Fund | Save R1,000 as your first emergency buffer. | You saved your first R1,000. The foundation is laid. | `R{current} of R{target}` |
| 2 | Debt Free | Pay off every debt except the house. | Every debt, gone. You owe no one but the bond. | `{current} of {target} debts cleared` |
| 3 | Full Emergency Fund | Save 3 to 6 months of expenses. | Three months of expenses, saved. You're protected. | `R{current} of R{target}` |
| 4 | Invest 15% | Put 15% of income into retirement. | You're investing in the long game now. | (manual) |
| 5 | College Fund | Save for your children's education. | Their education is funded. | (manual) |
| 6 | House Free | Pay off the bond. | No debt. No bond. The house is yours. | `R{current} of R{target}` |
| 7 | Build & Give | Build wealth. Give generously. | You have enough — and you're giving. | (manual) |

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
