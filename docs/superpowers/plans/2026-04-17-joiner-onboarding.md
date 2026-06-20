# Joiner Onboarding Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user who installs the app and has an invite code can join an existing household directly — no phantom "My Household" created, no 8-step budget wizard forced.

**Architecture:** Three surgical changes: (1) stop `EnsureHouseholdUseCase` auto-creating a household for truly new users, (2) add "Join instead" entry on `CreateHouseholdScreen`, (3) mark onboarding complete immediately when a user joins via invite code (they inherit the household's existing config).

**Tech Stack:** React Native, Expo, DrizzleORM (SQLite), Zustand, AsyncStorage, react-navigation

---

## Root Cause Summary

| Problem                                                                      | Location                    | Effect                                                                                    |
| ---------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| `EnsureHouseholdUseCase` step 3 auto-creates "My Household" on cold-start    | `App.tsx → initSession()`   | New user gets an unwanted empty household before seeing any UI                            |
| `CreateHouseholdScreen` has no "Join instead" link                           | `CreateHouseholdScreen.tsx` | User has to hunt for the join path                                                        |
| `JoinHouseholdScreen` sets householdId but `onboardingCompleted` stays false | `JoinHouseholdScreen.tsx`   | Joiner is forced through the full 8-step budget-setup wizard meant for household creators |

---

## File Map

| File                                                                        | Change                                                                                                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/households/EnsureHouseholdUseCase.ts`                           | Remove step 3 (auto-create). Return failure for new users.                                                                    |
| `App.tsx`                                                                   | Update `initSession()` to fall back to `restoredHouseholds[0]` when EnsureHousehold returns no local household.               |
| `src/presentation/screens/household/CreateHouseholdScreen.tsx`              | Add "Have an invite code? Join instead →" link that navigates to `JoinHouseholdGate`.                                         |
| `src/presentation/screens/household/JoinHouseholdScreen.tsx`                | After successful join, call `markOnboardingComplete(userId, householdId)` + `setOnboardingCompleted(true)` before navigating. |
| `src/domain/households/__tests__/EnsureHouseholdUseCase.test.ts`            | Remove/update test that expects auto-creation for a new user.                                                                 |
| `src/presentation/screens/household/__tests__/JoinHouseholdScreen.test.tsx` | Add test verifying onboarding is marked complete after join.                                                                  |

---

## Task 1 — Remove auto-create from `EnsureHouseholdUseCase`

**Files:**

- Modify: `src/domain/households/EnsureHouseholdUseCase.ts`
- Modify: `src/domain/households/__tests__/EnsureHouseholdUseCase.test.ts` (if it exists)

- [ ] **Step 1: Write failing test**

Find or create `src/domain/households/__tests__/EnsureHouseholdUseCase.test.ts`.

Add a test:

```typescript
it('returns failure when user has no household (new user)', async () => {
  // db has no household_members rows for this userId
  const uc = new EnsureHouseholdUseCase(db, audit, 'new-user-id');
  const result = await uc.execute();
  expect(result.success).toBe(false);
});
```

Run: `npx jest EnsureHouseholdUseCase --no-coverage`
Expected: FAIL (currently it creates a household and returns success)

- [ ] **Step 2: Remove step 3 from `EnsureHouseholdUseCase.execute()`**

In `src/domain/households/EnsureHouseholdUseCase.ts`, delete the entire step 3 block (lines from `// 3. Create new household with UUID + membership` to the end of the method) and replace with a failure return:

```typescript
// No existing membership and no legacy household — user must choose to
// create or join via the UI. Return failure so the navigator shows the
// create/join choice screen.
return createFailure({ message: 'no_household' });
```

The `createFailure` helper is already used elsewhere in the domain — import it from `'../shared/types'`.

- [ ] **Step 3: Run test to verify it passes**

Run: `npx jest EnsureHouseholdUseCase --no-coverage`
Expected: PASS

- [ ] **Step 4: Run full suite to check nothing regressed**

Run: `npx jest --no-coverage`
Expected: all pass (the existing test that expected auto-creation will need updating — fix it to expect failure for a new user, success for an existing member)

- [ ] **Step 5: Commit**

```bash
git add src/domain/households/EnsureHouseholdUseCase.ts
git add src/domain/households/__tests__/
git commit -m "fix(household): stop auto-creating household for new users in EnsureHouseholdUseCase"
```

---

## Task 2 — Update `initSession` to handle no-local-household gracefully

**Files:**

- Modify: `App.tsx` (the `initSession` function only)

- [ ] **Step 1: Write failing test (manual verification)**

This is App.tsx wiring — no unit test possible. Instead, mentally verify:

- New user (no rows in DB, no remote households): `result.success=false`, `restoredHouseholds=[]` → `householdId` should stay `null`
- Reinstalling user (rows in Supabase, not in local DB): `result.success=false`, `restoredHouseholds=[{id, paydayDay}]` → `householdId` should be set to `restoredHouseholds[0].id`
- Existing user (rows in local DB): `result.success=true` → `householdId` set from `result.data.id` ✅ unchanged

- [ ] **Step 2: Update `initSession` in `App.tsx`**

Find the block in `initSession` that handles the result (currently `if (result.success) { ... }`).

Replace it with:

```typescript
const store = useAppStore.getState();
if (result.success) {
  // Normal path: found household in local DB
  store.setHouseholdId(result.data.id);
  store.setPaydayDay(result.data.paydayDay);
  store.setAvailableHouseholds([
    result.data,
    ...restoredHouseholds
      .filter((h) => h.id !== result.data.id)
      .map((h) => ({ ...h, userLevel: 1 as const })),
  ]);
} else if (restoredHouseholds.length > 0) {
  // Reinstall path: no local data but Supabase has households for this user
  const primary = restoredHouseholds[0];
  store.setHouseholdId(primary.id);
  store.setPaydayDay(primary.paydayDay);
  store.setAvailableHouseholds(restoredHouseholds.map((h) => ({ ...h, userLevel: 1 as const })));
} else {
  // New user: no local household, no remote household.
  // householdId stays null — RootNavigator shows CreateHouseholdNavigator.
  console.log('[initSession] New user — no household found. Showing create/join screen.');
}
```

Also remove the existing `console.error` for the failure case (it was never a real error, just a new user):

```typescript
// DELETE this line:
// console.error('[initSession] Failed to ensure household:', result.error);
```

- [ ] **Step 3: Run full suite**

Run: `npx jest --no-coverage`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add App.tsx
git commit -m "fix(boot): handle no-household result in initSession — new users stay at null until they choose create or join"
```

---

## Task 3 — Add "Join instead" link to `CreateHouseholdScreen`

**Files:**

- Modify: `src/presentation/screens/household/CreateHouseholdScreen.tsx`

- [ ] **Step 1: Write failing test**

Add to `src/presentation/screens/household/__tests__/CreateHouseholdScreen.test.tsx` (create if not present):

```typescript
it('shows a "Join with invite code" link', () => {
  const { getByText } = render(<CreateHouseholdScreen navigation={mockNav as never} route={{} as never} />);
  expect(getByText(/join with invite code/i)).toBeTruthy();
});

it('navigates to JoinHouseholdGate when join link pressed', () => {
  const mockNavigate = jest.fn();
  const { getByText } = render(<CreateHouseholdScreen navigation={{ navigate: mockNavigate } as never} route={{} as never} />);
  fireEvent.press(getByText(/join with invite code/i));
  expect(mockNavigate).toHaveBeenCalledWith('JoinHouseholdGate');
});
```

Run: `npx jest CreateHouseholdScreen --no-coverage`
Expected: FAIL

- [ ] **Step 2: Add navigation prop + join link to `CreateHouseholdScreen`**

The screen currently has no navigation prop. Add it:

```typescript
export const CreateHouseholdScreen: React.FC<CreateHouseholdScreenProps> = ({ navigation }) => {
```

Below the "Create Household" `<Button>`, add:

```typescript
<Button
  mode="text"
  onPress={() => navigation.navigate('JoinHouseholdGate')}
  style={styles.joinLink}
>
  Have an invite code? Join instead
</Button>
```

Add to styles:

```typescript
joinLink: { marginTop: spacing.xs },
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx jest CreateHouseholdScreen --no-coverage`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/household/CreateHouseholdScreen.tsx
git add src/presentation/screens/household/__tests__/
git commit -m "feat(household): add 'Join with invite code' link to CreateHouseholdScreen"
```

---

## Task 4 — Mark onboarding complete immediately after joining

**Files:**

- Modify: `src/presentation/screens/household/JoinHouseholdScreen.tsx`
- Create or modify: `src/presentation/screens/household/__tests__/JoinHouseholdScreen.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/presentation/screens/household/__tests__/JoinHouseholdScreen.test.tsx`:

```typescript
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Mock AcceptInviteUseCase
jest.mock('../../../domain/households/AcceptInviteUseCase', () => ({
  AcceptInviteUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({
      success: true,
      data: { id: 'hh-joined', paydayDay: 25 },
    }),
  })),
}));

// Mock markOnboardingComplete
const mockMarkOnboarding = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../infrastructure/storage/onboardingFlag', () => ({
  markOnboardingComplete: (...args: unknown[]) => mockMarkOnboarding(...args),
}));

jest.mock('../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../data/remote/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../../data/sync/RestoreService', () => ({
  RestoreService: jest.fn().mockImplementation(() => ({ restore: jest.fn() })),
}));

const mockSetHouseholdId = jest.fn();
const mockSetOnboardingCompleted = jest.fn();
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: Function) =>
    sel({
      session: { user: { id: 'user-1' } },
      setHouseholdId: mockSetHouseholdId,
      setPaydayDay: jest.fn(),
      setAvailableHouseholds: jest.fn(),
      availableHouseholds: [],
      setOnboardingCompleted: mockSetOnboardingCompleted,
    }),
  ),
}));

jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((sel: Function) => sel({ enqueue: jest.fn() })),
}));

import { JoinHouseholdScreen } from '../JoinHouseholdScreen';

describe('JoinHouseholdScreen', () => {
  it('marks onboarding complete after successful join', async () => {
    const mockNav = { reset: jest.fn() };
    const { getByLabelText, getByText } = render(
      <JoinHouseholdScreen navigation={mockNav as never} route={{} as never} />,
    );

    fireEvent.changeText(getByLabelText(/invite code/i), 'ABC123');
    fireEvent.press(getByText('Join Household'));

    await waitFor(() => {
      expect(mockMarkOnboarding).toHaveBeenCalledWith('user-1', 'hh-joined');
      expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);
    });
  });
});
```

Run: `npx jest JoinHouseholdScreen --no-coverage`
Expected: FAIL (markOnboardingComplete not called yet)

- [ ] **Step 2: Update `JoinHouseholdScreen` to mark onboarding complete and use store setter**

Add imports:

```typescript
import { markOnboardingComplete } from '../../../infrastructure/storage/onboardingFlag';
```

Add `setOnboardingCompleted` from store:

```typescript
const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted);
```

In `handleJoin`, after `setAvailableHouseholds(...)` and before `enqueue('Joined household', 'success')`, add:

```typescript
// Joiner inherits the household's existing config — skip the full
// budget-setup wizard by marking onboarding complete immediately.
if (session) {
  await markOnboardingComplete(session.user.id, result.data.id);
  setOnboardingCompleted(true);
}
```

Remove `navigation.reset(...)` — RootNavigator reacts automatically when `householdId` is set and `onboardingCompleted` is true:

```typescript
// DELETE: navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx jest JoinHouseholdScreen --no-coverage`
Expected: PASS

- [ ] **Step 4: Run full suite**

Run: `npx jest --no-coverage`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/presentation/screens/household/JoinHouseholdScreen.tsx
git add src/presentation/screens/household/__tests__/JoinHouseholdScreen.test.tsx
git commit -m "fix(onboarding): mark onboarding complete immediately when joining via invite — joiners skip budget setup wizard"
```

---

## Task 5 — PR, CI, merge

- [ ] **Step 1: Create branch and open PR**

```bash
git checkout -b fix/joiner-onboarding
# (all commits from tasks 1–4 should already be on this branch)
git push -u origin fix/joiner-onboarding
gh pr create --title "fix(onboarding): clean joiner path — no phantom household, no 8-step wizard" --body "$(cat <<'EOF'
## Summary
- Removes auto-creation of phantom 'My Household' for brand-new users
- Adds 'Have an invite code? Join instead' link on the CreateHousehold screen
- Joiners skip the 8-step budget wizard — they inherit the household's existing config
- Reinstalling users (data in Supabase, not local) correctly restored from remote

## User journey (before)
1. Wife installs → app auto-creates empty 'My Household' silently
2. She finds the Join screen, enters code → joins husband's household
3. She still has phantom 'My Household' in her account
4. She's forced through full 8-step budget wizard (income, categories, envelopes, payday, meters...)

## User journey (after)
1. Wife installs → signs up → sees 'Create Household' screen with 'Have an invite code? Join instead' link
2. She taps Join, enters code → joins husband's household
3. No phantom household created
4. App opens directly to the main dashboard — no wizard

## Test plan
- [ ] Fresh install + join via code → no extra household, no onboarding wizard
- [ ] Fresh install + create household → normal 8-step onboarding flows as before
- [ ] Reinstall (existing Supabase data) → household restored from remote correctly
- [ ] CI green, CodeRabbit green
EOF
)"
```

- [ ] **Step 2: Monitor CI**

Run: `gh pr checks <number>`
Wait for `check` to pass and CodeRabbit to complete.

- [ ] **Step 3: Merge**

```bash
gh pr merge <number> --squash --delete-branch
```

---

## Verification Checklist (manual)

After merge, verify on a device/simulator:

| Scenario                        | Expected                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| Fresh install, create household | CreateHousehold screen shown → tap Create → 8-step onboarding → main app              |
| Fresh install, join household   | CreateHousehold screen shown → tap "Join instead" → enter code → main app (no wizard) |
| Existing user, reinstall        | App restores household from Supabase, goes straight to main app                       |
| Existing user, switch household | Settings → Switch Household works, only real households shown                         |

---

## What This Does NOT Change

- The 8-step onboarding wizard for household **creators** — unchanged
- The invite code generation / `CreateInviteUseCase` — unchanged
- Multi-household support — unchanged
- The `RestoreService` path for reinstalls — unchanged (enhanced in Task 2)
