# UI Systems Fix — Progress Tracker

> Generated from 5-agent parallel audit on 2026-04-16.  
> Full plan: `docs/superpowers/plans/2026-04-16-ui-systems-fix.md`  
> Work branch per batch, PR per batch, merge before next batch starts.

---

## Batch 1 — Font config foundation + PayoffProjectionCard dark mode

**Branch:** `fix/ui-batch-1-font-payoff`  
**Status:** ✅ Merged  
**PR:** https://github.com/henzard/AccountingV2/pull/13  
**CI:** ✅ Pass  
**CodeRabbit:** ✅ Pass

| Task | Description                                                                  | Status |
| ---- | ---------------------------------------------------------------------------- | ------ |
| T5   | Add `displaySmall`, `headlineSmall`, `titleSmall`, `bodySmall` to fontConfig | ✅     |
| T1   | Fix PayoffProjectionCard: `date`+`statValue` now use `colors.onPrimary`      | ✅     |

---

## Batch 2 — Slip scanning colors + duplicate offline banner

**Branch:** `fix/ui-batch-2-slip-colors`  
**Status:** ✅ Merged  
**PR:** https://github.com/henzard/AccountingV2/pull/14  
**CI:** ✅ Pass  
**CodeRabbit:** ✅ Pass (1 nitpick fixed: surfaceDisabled vs onSurfaceDisabled)

| Task | Description                                                                                 | Status |
| ---- | ------------------------------------------------------------------------------------------- | ------ |
| T2   | Replace 28+ hardcoded colors in SlipCaptureScreen, SlipProcessingScreen, MultiShotCoachmark | ✅     |
| T11  | Remove duplicate offline banner; add a11y (accessibilityLiveRegion) to OfflineBanner        | ✅     |

---

## Batch 3 — Toast unification + accessibility

**Branch:** `fix/ui-batch-3-toast-a11y`  
**Status:** ✅ Merged  
**PR:** https://github.com/henzard/AccountingV2/pull/15  
**CI:** ✅ Pass  
**CodeRabbit:** ✅ Pass (no actionable comments)

| Task | Description                                                                | Status |
| ---- | -------------------------------------------------------------------------- | ------ |
| T3   | Unify to toastStore — remove Snackbar from CreateHousehold + JoinHousehold | ✅     |
| T4   | Add accessibilityLabel to PickerField + LineItemRow                        | ✅     |

---

## Batch 4 — Currency consistency + typography

**Branch:** `fix/ui-batch-4-currency-typography`  
**Status:** ✅ Merged  
**PR:** https://github.com/henzard/AccountingV2/pull/16  
**CI:** ✅ Pass  
**CodeRabbit:** ✅ Pass (1 comment fixed: fontSize token JSDoc wording)

| Task | Description                                                                | Status |
| ---- | -------------------------------------------------------------------------- | ------ |
| T6   | Extract `formatCurrency` utility; replace 6 toLocaleString in debt screens | ✅     |
| T7   | Add `fontSize` tokens to tokens.ts; replace hardcoded sizes in 4 files     | ✅     |

---

## Batch 5 — Navigation headers + onboarding

**Branch:** `fix/ui-batch-5-nav-onboarding`  
**Status:** ✅ Merged  
**PR:** https://github.com/henzard/AccountingV2/pull/17  
**CI:** ✅ Pass  
**CodeRabbit:** ✅ Pass (rate-limited — no inline comments)

| Task | Description                                                                    | Status |
| ---- | ------------------------------------------------------------------------------ | ------ |
| T8   | Standardize headerShadowVisible across all 5 stack navigators                  | ✅     |
| T9   | Add step progress to onboarding; KeyboardAvoidingView in AllocateEnvelopesStep | ✅     |

---

## Batch 6 — Token cleanup + skeleton

**Branch:** `fix/ui-batch-6-tokens-skeleton`  
**Status:** ✅ Merged  
**PR:** https://github.com/henzard/AccountingV2/pull/18  
**CI:** ✅ Pass  
**CodeRabbit:** ✅ Pass (no actionable comments)

| Task | Description                                                    | Status |
| ---- | -------------------------------------------------------------- | ------ |
| T10  | Replace 11× borderRadius: 8 with radius.md token (5 files)     | ✅     |
| T12  | Fix LoadingSkeletonCard height: ~98px → 64px (matches ListRow) | ✅     |

---

## Batch 7 — Minor polish

**Branch:** `fix/ui-batch-7-minor`  
**Status:** ✅ Merged  
**PR:** https://github.com/henzard/AccountingV2/pull/19  
**CI:** ✅ Pass  
**CodeRabbit:** ✅ Pass (no actionable comments)

| Task | Description                                                                                          | Status |
| ---- | ---------------------------------------------------------------------------------------------------- | ------ |
| T13  | BabyStepsScreen: fontSize: 10 → fontSize.xs token (+ bonus: PayoffProjectionCard, SlipCaptureScreen) | ✅     |
| T14  | SlipConsentScreen: spacing tokens replace magic padding numbers                                      | ✅     |
| T15  | DashboardScreen FAB: paddingBottom: 100 → spacing.xl + 56 + spacing.md                               | ✅     |

---

## Legend

- ⬜ Pending
- 🔄 In progress
- ✅ Done
- ❌ Blocked
- 🚫 Skipped (with reason)

## Log

| Time       | Event                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-16 | Audit complete. 5 agents, 15 tasks identified across 7 batches.                                                           |
| 2026-04-16 | Batch 1 merged (PR #13): fontConfig + PayoffProjectionCard.                                                               |
| 2026-04-16 | Batch 2 PR #14 open. CI ✅. CodeRabbit flagged surfaceDisabled vs onSurfaceDisabled — fixed and pushed. Re-running CI+CR. |
| 2026-04-16 | Batches 2–6 merged (PRs #14–#18). All 15 tasks complete.                                                                  |
| 2026-04-16 | Batch 7 merged (PR #19): minor polish — spacing/fontSize tokens. **All 7 batches done. UI systems fix complete.**         |
