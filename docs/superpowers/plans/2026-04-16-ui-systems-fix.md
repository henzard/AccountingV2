# UI Systems Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all misaligned, hardcoded, and inconsistent UI across the AccountingV2 app — found by a 5-agent parallel audit on 2026-04-16.

**Architecture:** Theme tokens → shared components → screen-level fixes. Fix the foundation before fixing consumers.

**Tech Stack:** React Native (bare Expo), react-native-paper (MD3), useAppTheme hook, Zustand stores, spacing/radius/colours tokens in `src/presentation/theme/tokens.ts`.

---

## Severity Legend

- **CRITICAL** — Dark mode broken or UX completely broken
- **MAJOR** — Wrong patterns, visual inconsistency, or accessibility blocked
- **MINOR** — Code hygiene, magic numbers, minor polish

---

## CRITICAL Issues

### Task 1: Fix hardcoded colors in PayoffProjectionCard (dark mode broken)

**Files:**

- Modify: `src/presentation/screens/debtSnowball/components/PayoffProjectionCard.tsx`

**Problem:** Card uses `backgroundColor: '#fff'`, `rgba(255,255,255,0.X)` and hardcoded chart line colors. In dark mode the card is invisible (white text on white card).

- [ ] **Step 1: Read the file**

```bash
cat src/presentation/screens/debtSnowball/components/PayoffProjectionCard.tsx
```

- [ ] **Step 2: Replace all hardcoded colors**

Replace every raw hex / rgba with theme tokens:

- `'#fff'` / `'white'` → `colors.surface`
- `'rgba(255,255,255,0.X)'` overlays → `colors.surfaceVariant` or transparent
- `'#00695C'` / primary-ish → `colors.primary`
- `'rgba(0,0,0,0.1)'` → `colors.outlineVariant`

Add `const { colors } = useAppTheme();` at top of component if missing.

- [ ] **Step 3: Verify TypeScript passes**

```bash
npx tsc --noEmit 2>&1 | grep PayoffProjection
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/debtSnowball/components/PayoffProjectionCard.tsx
git commit -m "fix(dark-mode): replace hardcoded colors in PayoffProjectionCard"
```

---

### Task 2: Fix hardcoded colors in slip scanning screens (21+ colors)

**Files:**

- Modify: `src/presentation/screens/slipScanning/SlipCaptureScreen.tsx`
- Modify: `src/presentation/screens/slipScanning/SlipProcessingScreen.tsx`
- Modify: `src/presentation/screens/slipScanning/components/MultiShotCoachmark.tsx`

**Problem:** Slip capture/processing uses 28+ hardcoded hex/rgba colors that don't respond to theme changes.

- [ ] **Step 1: Read all three files**

```bash
cat src/presentation/screens/slipScanning/SlipCaptureScreen.tsx
cat src/presentation/screens/slipScanning/SlipProcessingScreen.tsx
cat src/presentation/screens/slipScanning/components/MultiShotCoachmark.tsx
```

- [ ] **Step 2: Fix SlipCaptureScreen**

Replace:

- `'#000'` / `'black'` → `colors.background` (or `'#000'` is acceptable for camera viewport bg — keep those)
- `'#fff'` / `'white'` → `colors.onPrimary` or `colors.surface`
- `'#4CAF50'` (green confirm) → `colors.primary`
- `'#1565C0'` (blue multi-shot) → `colors.secondary`
- `'#c62828'` (red error/offline) → `colors.error`
- `'#555'` (disabled) → `colors.onSurfaceDisabled`
- `'#111'` (dark strip) → `colors.surfaceVariant`
- `rgba(0,0,0,0.6)` overlays → `colors.scrim` (MD3 has scrim token)

Note: Camera viewfinder background (`'#000'`) is intentional — cameras show black. Keep those.

- [ ] **Step 3: Fix SlipProcessingScreen**

Replace:

- `'#fff'` → `colors.surface`
- `'#888'` (subtext) → `colors.onSurfaceVariant`
- `'#c62828'` (error) → `colors.error`

- [ ] **Step 4: Fix MultiShotCoachmark**

Replace:

- `rgba(0,0,0,0.85)` backdrop → `colors.scrim`
- `'#fff'` text → `colors.onPrimary` or `colors.surface`
- `'#ddd'` → `colors.outlineVariant`
- `'#4CAF50'` → `colors.primary`

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -i slip
```

- [ ] **Step 6: Commit**

```bash
git add src/presentation/screens/slipScanning/
git commit -m "fix(dark-mode): replace hardcoded colors in slip scanning screens"
```

---

### Task 3: Unify toast/snackbar system — remove local Snackbar usage

**Files:**

- Modify: `src/presentation/screens/household/CreateHouseholdScreen.tsx`
- Modify: `src/presentation/screens/household/JoinHouseholdScreen.tsx`

**Problem:** Three different notification systems exist simultaneously. JoinHouseholdScreen uses BOTH raw `Snackbar` AND `toastStore` in the same screen.

The canonical system is: `useToastStore` (Zustand) + `ToastHost` (already mounted in App).

- [ ] **Step 1: Read both screens**

```bash
cat src/presentation/screens/household/CreateHouseholdScreen.tsx
cat src/presentation/screens/household/JoinHouseholdScreen.tsx
```

- [ ] **Step 2: Update CreateHouseholdScreen**

- Remove `Snackbar` import from react-native-paper imports
- Remove `error` state and `setError`
- Remove `<Snackbar .../>` JSX
- Add `const enqueue = useToastStore((s) => s.enqueue);`
- Replace `setError(result.error.message)` → `enqueue(result.error.message, 'error')`

- [ ] **Step 3: Update JoinHouseholdScreen**

- Same pattern: remove `Snackbar`, remove `error` local state
- Keep the existing `enqueue` call for success toast (already correct)
- Replace `setError(result.error.message)` → `enqueue(result.error.message, 'error')`
- Remove `<Snackbar .../>` JSX at bottom

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -i household
npx eslint src/presentation/screens/household/ --ext .tsx --max-warnings 0
```

- [ ] **Step 5: Commit**

```bash
git add src/presentation/screens/household/CreateHouseholdScreen.tsx src/presentation/screens/household/JoinHouseholdScreen.tsx
git commit -m "fix(ux): unify toast/snackbar to toastStore across household screens"
```

---

### Task 4: Add accessibility labels to PickerField and LineItemRow

**Files:**

- Modify: `src/presentation/components/shared/PickerField.tsx`
- Modify: `src/presentation/screens/slipScanning/components/LineItemRow.tsx`

**Problem:** Interactive components have no accessibility labels — screen readers can't identify them.

- [ ] **Step 1: Read both files**

```bash
cat src/presentation/components/shared/PickerField.tsx
cat src/presentation/screens/slipScanning/components/LineItemRow.tsx
```

- [ ] **Step 2: Fix PickerField**

On the `TouchableRipple` (line ~40), add:

```tsx
accessibilityLabel={label ?? 'Select value'}
accessibilityRole="button"
accessibilityHint="Double-tap to open picker"
```

- [ ] **Step 3: Fix LineItemRow confidence borders**

The red/yellow/grey confidence border is visual-only. Add accessible text:

```tsx
accessibilityLabel={`Line item: ${description}, amount ${amount}, confidence: ${confidenceLabel}`}
```

Where `confidenceLabel` is derived from the border color value:

```ts
const confidenceLabel =
  borderColor === colors.error ? 'low' : borderColor === colors.warning ? 'medium' : 'high';
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -E "PickerField|LineItemRow"
```

- [ ] **Step 5: Commit**

```bash
git add src/presentation/components/shared/PickerField.tsx src/presentation/screens/slipScanning/components/LineItemRow.tsx
git commit -m "fix(a11y): add accessibility labels to PickerField and LineItemRow"
```

---

## MAJOR Issues

### Task 5: Add missing font variants to fontConfig

**Files:**

- Modify: `src/presentation/theme/tokens.ts` (or wherever `fontConfig` is defined)

**Problem:** `headlineSmall` (24pt) and `bodySmall` (12pt) variants are used in JSX but not registered in fontConfig, so they fall back to system fonts instead of PlusJakartaSans.

- [ ] **Step 1: Find fontConfig**

```bash
grep -r "fontConfig" src/presentation/theme/ --include="*.ts" -l
```

- [ ] **Step 2: Read the file**

```bash
cat <file from step 1>
```

- [ ] **Step 3: Add missing variants**

Add `headlineSmall` and `bodySmall` entries following the existing pattern. MD3 specs:

- `headlineSmall`: fontFamily PlusJakartaSans_400Regular, fontSize 24, letterSpacing 0, lineHeight 32
- `bodySmall`: fontFamily PlusJakartaSans_400Regular, fontSize 12, letterSpacing 0.4, lineHeight 16

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/presentation/theme/
git commit -m "fix(theme): add missing headlineSmall and bodySmall font variants"
```

---

### Task 6: Replace toLocaleString with CurrencyText in debt screens

**Files:**

- Modify: `src/presentation/screens/debtSnowball/` — up to 6 files using `.toLocaleString()`

**Problem:** Debt module formats currency with `toLocaleString()` instead of the shared `CurrencyText` component. This breaks locale consistency and ignores the household currency setting.

- [ ] **Step 1: Find all occurrences**

```bash
grep -r "toLocaleString" src/presentation/screens/debtSnowball/ --include="*.tsx" -n
```

- [ ] **Step 2: Replace each occurrence**

For inline currency values like:

```tsx
<Text>{amount.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })}</Text>
```

Replace with:

```tsx
<CurrencyText amount={amount} />
```

Import: `import { CurrencyText } from '../../../components/shared/CurrencyText';`

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -i debt
npx eslint src/presentation/screens/debtSnowball/ --ext .tsx --max-warnings 0
```

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/debtSnowball/
git commit -m "fix(debt): replace toLocaleString with CurrencyText component"
```

---

### Task 7: Fix hardcoded font sizes in RamseyScoreBadge, KPIRow, EnvelopeCard, TransactionList

**Files:**

- Modify: `src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx`
- Modify: `src/presentation/components/shared/KPIRow.tsx`
- Modify: `src/presentation/components/envelopes/EnvelopeCard.tsx`
- Modify: `src/presentation/screens/transactions/` (transaction list item)

**Problem:** Multiple components hardcode `fontSize` instead of using MD3 `variant` props on `<Text>`.

- [ ] **Step 1: Read all files**

```bash
cat src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx
cat src/presentation/components/shared/KPIRow.tsx
cat src/presentation/components/envelopes/EnvelopeCard.tsx
grep -r "fontSize: 14" src/presentation/screens/transactions/ --include="*.tsx" -l
```

- [ ] **Step 2: Fix RamseyScoreBadge**

- Score value (fontSize: 24) → `<Text variant="displaySmall">` or keep fontSize but document it
- Label text (fontSize: 10) → `<Text variant="labelSmall">`
- Remove `lineHeight: 27` magic number — let variant handle it
- Remove `letterSpacing: 0.5` — use variant default

- [ ] **Step 3: Fix KPIRow**

- `fontSize: 24` on amount value → `<Text variant="headlineMedium">` (or keep as intentional display size with a comment)

- [ ] **Step 4: Fix EnvelopeCard**

- `fontSize: 15` → `<Text variant="titleSmall">`
- `fontSize: 12` → `<Text variant="labelMedium">`

- [ ] **Step 5: Fix transaction list item**

- `fontSize: 14` → `<Text variant="bodyMedium">`

- [ ] **Step 6: Verify visual output**

Check that text sizes look correct (MD3 `bodyMedium` = 14sp, `titleSmall` ≈ 14sp, `labelMedium` = 12sp).

- [ ] **Step 7: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "RamseyScore|KPIRow|EnvelopeCard"
```

- [ ] **Step 8: Commit**

```bash
git add src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx \
  src/presentation/components/shared/KPIRow.tsx \
  src/presentation/components/envelopes/EnvelopeCard.tsx
git commit -m "fix(typography): replace hardcoded fontSize with MD3 variant props"
```

---

### Task 8: Standardize navigation header config across all stack navigators

**Files:**

- Modify: `src/presentation/navigation/DashboardStackNavigator.tsx`
- Modify: `src/presentation/navigation/TransactionsStackNavigator.tsx`
- Modify: `src/presentation/navigation/MetersStackNavigator.tsx`
- Modify: `src/presentation/navigation/SnowballStackNavigator.tsx`
- Modify: `src/presentation/navigation/SettingsStackNavigator.tsx`

**Problem:** DashboardStackNavigator sets header options per-screen instead of in `screenOptions`. All navigators lack `headerShadowVisible: false` except Dashboard. Creates visual shadow inconsistency across tabs.

- [ ] **Step 1: Read all navigators**

```bash
cat src/presentation/navigation/DashboardStackNavigator.tsx
cat src/presentation/navigation/TransactionsStackNavigator.tsx
```

- [ ] **Step 2: Create canonical screenOptions pattern**

The canonical `screenOptions` for all stacks (already established in Transactions/Meters/Snowball/Settings):

```tsx
screenOptions={{
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.primary,
  headerShadowVisible: false,
  headerTitleStyle: { fontFamily: 'PlusJakartaSans_600SemiBold' },
}}
```

- [ ] **Step 3: Move DashboardStack per-screen options to screenOptions**

Remove per-screen `options={{ headerShadowVisible: false, ... }}` from individual `<Stack.Screen>` elements in DashboardStackNavigator. Move to global `screenOptions`.

- [ ] **Step 4: Add `headerShadowVisible: false` to all stacks**

For TransactionsStackNavigator, MetersStackNavigator, SnowballStackNavigator, SettingsStackNavigator — add `headerShadowVisible: false` to their existing `screenOptions`.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit 2>&1 | grep Navigator
npx eslint src/presentation/navigation/ --ext .tsx --max-warnings 0
```

- [ ] **Step 6: Commit**

```bash
git add src/presentation/navigation/
git commit -m "fix(nav): standardize header config across all stack navigators"
```

---

### Task 9: Add progress indicator to onboarding + fix AllocateEnvelopesStep

**Files:**

- Modify: `src/presentation/screens/auth/onboarding/OnboardingNavigator.tsx`
- Modify: `src/presentation/screens/auth/onboarding/AllocateEnvelopesStep.tsx`

**Problem:** 8-step onboarding has no progress indicator — users don't know how far they are. AllocateEnvelopesStep is missing `KeyboardAvoidingView` so keyboard covers the input.

- [ ] **Step 1: Read both files**

```bash
cat src/presentation/screens/auth/onboarding/OnboardingNavigator.tsx
cat src/presentation/screens/auth/onboarding/AllocateEnvelopesStep.tsx
```

- [ ] **Step 2: Add step progress to OnboardingNavigator header**

Use the `progress` property from `@react-navigation/stack` to show a step counter in the header:

```tsx
screenOptions={({ route, navigation }) => {
  const steps = ['Welcome', 'Income', 'Payday', 'Envelopes', 'AllocateEnvelopes', 'DebtAccounts', 'HabitSetup', 'Finish'];
  const currentIndex = steps.indexOf(route.name);
  const stepLabel = currentIndex >= 0 ? `${currentIndex + 1} of ${steps.length}` : '';
  return {
    headerRight: () => (
      <Text variant="labelMedium" style={{ marginRight: spacing.base, color: colors.onSurfaceVariant }}>
        {stepLabel}
      </Text>
    ),
    ...existingOptions,
  };
}}
```

- [ ] **Step 3: Add KeyboardAvoidingView to AllocateEnvelopesStep**

Wrap root `ScrollView` in `KeyboardAvoidingView`:

```tsx
import { KeyboardAvoidingView, Platform } from 'react-native';

<KeyboardAvoidingView
  style={styles.flex}
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
>
  <ScrollView ...>
    {/* existing content */}
  </ScrollView>
</KeyboardAvoidingView>
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -i onboard
```

- [ ] **Step 5: Commit**

```bash
git add src/presentation/screens/auth/onboarding/
git commit -m "fix(onboarding): add step progress indicator and keyboard avoidance"
```

---

### Task 10: Replace hardcoded borderRadius with radius tokens

**Files:**

- Modify: `src/presentation/screens/settings/SettingsScreen.tsx`
- Modify: `src/presentation/screens/settings/NotificationPreferencesScreen.tsx`
- Modify: `src/presentation/screens/settings/CrashLogViewer.tsx`
- Modify: `src/presentation/screens/slipScanning/SlipCaptureScreen.tsx` (if not already fixed in Task 2)
- Modify: `src/presentation/components/shared/EnvelopePickerSheet.tsx`

**Problem:** 12+ places use `borderRadius: 8` or other numeric values instead of `radius.md` from tokens.

First, verify the radius token exists:

```bash
grep -r "radius" src/presentation/theme/tokens.ts | head -20
```

- [ ] **Step 1: Read all files**

Read each file to understand context before editing.

- [ ] **Step 2: Replace in SettingsScreen**

`borderRadius: 8` → `borderRadius: radius.md`

Add `import { radius } from '../../theme/tokens';` if not present.

- [ ] **Step 3: Replace in NotificationPreferencesScreen**

Same pattern. Check for `borderRadius: 8` occurrences.

- [ ] **Step 4: Replace in CrashLogViewer**

3 occurrences of `borderRadius: 8`.

- [ ] **Step 5: Replace in EnvelopePickerSheet**

`borderRadius: 2` (handle bar) → `borderRadius: radius.xs`

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit 2>&1 | grep radius
grep -r "borderRadius: [0-9]" src/presentation/screens/settings/ src/presentation/components/shared/ --include="*.tsx" -n
```

Expected: no remaining numeric borderRadius values in these files.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/screens/settings/ src/presentation/components/shared/EnvelopePickerSheet.tsx
git commit -m "fix(theme): replace hardcoded borderRadius with radius tokens"
```

---

### Task 11: Fix OfflineBanner accessibility + remove duplicate from SlipCaptureScreen

**Files:**

- Modify: `src/presentation/components/shared/OfflineBanner.tsx`
- Modify: `src/presentation/screens/slipScanning/SlipCaptureScreen.tsx`

**Problem:** OfflineBanner lacks `accessibilityRole="status"`. SlipCaptureScreen has its own custom offline banner (hardcoded red, non-accessible) instead of using the shared component.

- [ ] **Step 1: Read both files**

```bash
cat src/presentation/components/shared/OfflineBanner.tsx
grep -n "offline\|Offline\|c62828" src/presentation/screens/slipScanning/SlipCaptureScreen.tsx
```

- [ ] **Step 2: Fix OfflineBanner**

Wrap the banner content in a View with accessibility props:

```tsx
<View
  accessibilityRole="status"
  accessibilityLabel={visible ? 'You are offline' : ''}
  accessibilityLiveRegion="polite"
>
  {/* existing banner content */}
</View>
```

- [ ] **Step 3: Remove custom offline banner from SlipCaptureScreen**

Delete the custom `#c62828` offline View/Text block. Import and use `OfflineBanner` instead — it's already mounted at the app root, so no change to SlipCaptureScreen is needed beyond removing the duplicate. Just delete the duplicate.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -E "OfflineBanner|SlipCapture"
```

- [ ] **Step 5: Commit**

```bash
git add src/presentation/components/shared/OfflineBanner.tsx \
  src/presentation/screens/slipScanning/SlipCaptureScreen.tsx
git commit -m "fix(a11y): add accessibilityRole to OfflineBanner, remove duplicate in SlipCaptureScreen"
```

---

### Task 12: Fix LoadingSkeletonCard height to match ListRow

**Files:**

- Modify: `src/presentation/components/shared/LoadingSkeletonCard.tsx`

**Problem:** Skeleton card is ~86px tall but actual ListRow items are ~64px. Visual jump when content loads.

- [ ] **Step 1: Read the file**

```bash
cat src/presentation/components/shared/LoadingSkeletonCard.tsx
```

- [ ] **Step 2: Measure ListRow**

```bash
cat src/presentation/components/shared/ListRow.tsx
```

Calculate actual ListRow height: paddingVertical + text line heights.

- [ ] **Step 3: Reduce skeleton dimensions**

Reduce `paddingVertical` from `spacing.base (16)` to `spacing.sm (8)`.
Reduce title placeholder height from `16` to `14`.

Goal: skeleton total height ≈ ListRow actual height (±4px).

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -i skeleton
```

- [ ] **Step 5: Commit**

```bash
git add src/presentation/components/shared/LoadingSkeletonCard.tsx
git commit -m "fix(ux): reduce LoadingSkeletonCard height to match ListRow actual height"
```

---

## MINOR Issues (backlog)

### Task 13: Fix magic number spacing in BabyStepsScreen

**Files:**

- Modify: `src/presentation/screens/babySteps/BabyStepsScreen.tsx`

- [ ] Replace `gap: 2` with `gap: spacing.xxs` (add a `xxs: 2` token if needed, or use `spacing.xs / 2`)
- [ ] Replace `height: 20` chip with `minHeight: spacing.lg` or appropriate token
- [ ] Replace `fontSize: 10` chip text with `<Text variant="labelSmall">`

```bash
git commit -m "fix(babySteps): replace magic number spacing with tokens"
```

---

### Task 14: Fix hardcoded spacing in SlipConsentScreen

**Files:**

- Modify: `src/presentation/screens/slipScanning/SlipConsentScreen.tsx`

- [ ] `padding: 24` → `padding: spacing.xl`
- [ ] `marginBottom: 16` → `marginBottom: spacing.base`
- [ ] `marginBottom: 24` → `marginBottom: spacing.xl`
- [ ] `lineHeight: 22` → remove (let variant control it) or document as intentional

```bash
git commit -m "fix(tokens): use spacing tokens in SlipConsentScreen"
```

---

### Task 15: Fix FAB/FlatList padding coupling in DashboardScreen

**Files:**

- Modify: `src/presentation/screens/dashboard/DashboardScreen.tsx`

- [ ] Replace hardcoded `paddingBottom: 100` on FlatList with `paddingBottom: spacing.xxl + 56` (FAB height = 56)
- [ ] Or use `ListFooterComponent={<View style={{ height: spacing.xxl }} />}`

```bash
git commit -m "fix(dashboard): decouple FAB padding from FlatList"
```

---

## Execution Order

Execute in this order to avoid fixing consumers before the foundation:

1. Task 5 (font variants — foundational)
2. Task 1 (PayoffProjectionCard — most critical dark mode bug)
3. Task 2 (slip scanning colors)
4. Task 3 (toast unification)
5. Task 4 (accessibility)
6. Task 6 (CurrencyText in debt)
7. Task 7 (font sizes)
8. Task 8 (navigation headers)
9. Task 9 (onboarding progress)
10. Task 10 (border radius tokens)
11. Task 11 (OfflineBanner)
12. Task 12 (skeleton height)
13. Tasks 13–15 (minor fixes)

---

## Audit Sources

This plan was generated from a 5-agent parallel audit on 2026-04-16:

| Agent                        | Coverage                                     | Key Findings                                       |
| ---------------------------- | -------------------------------------------- | -------------------------------------------------- |
| Design system tokens         | theme/tokens.ts, fontConfig                  | Missing headlineSmall/bodySmall variants           |
| Dashboard & navigation       | DashboardScreen, all Stack navigators        | Hardcoded fontSizes, inconsistent header shadows   |
| Auth & onboarding            | All onboarding steps                         | No progress bar, missing KeyboardAvoidingView      |
| Transactions/debt/meters     | Debt snowball, PayoffCard                    | Critical: hardcoded colors in PayoffProjectionCard |
| Shared components & settings | 15 shared components, household/slip screens | Mixed toast systems, 28+ hardcoded colors in slip  |
