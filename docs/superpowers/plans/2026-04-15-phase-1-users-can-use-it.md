# Phase 1 — Users Can Actually Use It — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A brand-new user can sign up and log their first transaction in under 90 seconds, on a device in either light or dark theme, without the onboarding "R0.01 cliff" or the stacked-FAB confusion.

**Architecture:**

- Insert a new `AllocateEnvelopesStep` between `ExpenseCategories` and `Payday` in onboarding. ExpenseCategoriesStep stops creating envelopes (no more R0.01 placeholder); it passes selected category names forward in navigation params. AllocateEnvelopesStep equally splits monthly income across those categories, lets the user nudge each allocation, and creates all envelopes in one atomic pass on Next.
- Replace Dashboard's two stacked FABs with a single primary **Add Transaction** FAB. Remove the camera FAB entirely. Slip capture becomes a secondary "Scan slip" button _inside_ `AddTransactionScreen` that routes to the existing slip flow.
- Theme becomes fully user-controllable: drop `userInterfaceStyle: 'light'` from `app.config.ts`; introduce a `themeStore` Zustand slice with `'system' | 'light' | 'dark'`, hydrated from AsyncStorage on boot and persisted to Supabase `user_preferences` with best-effort sync; `useAppTheme` reads from the store (falling back to OS scheme when `'system'`). Raw-hex imports in `AddTransactionScreen`, `SlipConfirmScreen`, `SlipQueueScreen` are replaced with `useAppTheme()`. A new **Appearance** row in `SettingsScreen` is a `SegmentedButtons` with the three options.
- `SyncOrchestrator.syncPending()` gains a module-level `isRunning` latch.
- Dashboard typography: promote KPI values from `fontSize: 14` to `headlineSmall` (24pt) with tabular-nums; bump Ramsey Score badge score → 24pt bold, label → 10pt tracked.
- Replace every `useAppStore((s) => s.householdId)!` non-null assertion on screens that can mount before the household resolves, guarding with a `LoadingSkeleton`.

**Tech Stack:** React Native 0.83 + Expo SDK 55, TypeScript 5.9, react-native-paper, Zustand, AsyncStorage, Drizzle + expo-sqlite, Supabase (Postgres + RLS), Jest + @testing-library/react-native.

---

## File Structure

### New files

| Path                                                                                | Responsibility                                                                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/presentation/screens/auth/onboarding/AllocateEnvelopesStep.tsx`                | New onboarding step: equal-split + nudge UI, creates envelopes on Next.                                                  |
| `src/presentation/screens/auth/onboarding/__tests__/AllocateEnvelopesStep.test.tsx` | Unit tests for allocation step.                                                                                          |
| `src/presentation/stores/themeStore.ts`                                             | Zustand slice for theme preference (`'system' \| 'light' \| 'dark'`), AsyncStorage hydration, Supabase best-effort sync. |
| `src/presentation/stores/themeStore.test.ts`                                        | Unit tests for theme store.                                                                                              |
| `src/infrastructure/storage/userPreferences.ts`                                     | Thin Supabase repository for `user_preferences` row (upsert + fetch).                                                    |
| `src/infrastructure/storage/userPreferences.test.ts`                                | Unit test using a mocked Supabase client.                                                                                |
| `supabase/migrations/008_user_preferences.sql`                                      | Create `user_preferences` table with RLS.                                                                                |

### Modified files

| Path                                                                 | Change                                                                                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.config.ts`                                                      | Remove `userInterfaceStyle: 'light'`.                                                                                                        |
| `src/presentation/theme/useAppTheme.ts`                              | Read theme pref from `themeStore`; fall back to OS scheme when `'system'`.                                                                   |
| `src/presentation/navigation/types.ts`                               | Add `AllocateEnvelopes` + param shape to `OnboardingStackParamList`.                                                                         |
| `src/presentation/screens/auth/onboarding/OnboardingNavigator.tsx`   | Register `AllocateEnvelopes` screen between `ExpenseCategories` and `Payday`.                                                                |
| `src/presentation/screens/auth/onboarding/ExpenseCategoriesStep.tsx` | Stop creating envelopes; pass selected categories + monthly income to `AllocateEnvelopes`.                                                   |
| `src/presentation/screens/auth/onboarding/IncomeStep.tsx`            | Stop creating the Income envelope with `allocatedCents: 100`; store monthly income in `appStore` (new field) to hand off to allocation step. |
| `src/presentation/stores/appStore.ts`                                | Add `monthlyIncomeCents: number \| null` + setter.                                                                                           |
| `src/presentation/screens/dashboard/DashboardScreen.tsx`             | Remove camera FAB. Replace + FAB action with navigation to `AddTransaction`. Promote KPI styles. Guard `householdId`.                        |
| `src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx` | Score 24pt bold, label 10pt tracked.                                                                                                         |
| `src/presentation/screens/transactions/AddTransactionScreen.tsx`     | Drop raw `colours` import; use `useAppTheme()`. Add "Scan slip" secondary button.                                                            |
| `src/presentation/screens/slipScanning/SlipConfirmScreen.tsx`        | Drop raw `colours` import; use `useAppTheme()`.                                                                                              |
| `src/presentation/screens/slipScanning/SlipQueueScreen.tsx`          | Drop raw `colours` import; use `useAppTheme()`.                                                                                              |
| `src/presentation/screens/settings/SettingsScreen.tsx`               | Add **Appearance** row with three-option segmented buttons, wired to `themeStore`.                                                           |
| `src/presentation/screens/babySteps/BabyStepsScreen.tsx`             | Guard `householdId!`.                                                                                                                        |
| `src/presentation/screens/auth/onboarding/PaydayStep.tsx`            | Guard `householdId!`.                                                                                                                        |
| `App.tsx`                                                            | On boot, hydrate `themeStore` from AsyncStorage before tree mounts.                                                                          |
| `src/data/sync/SyncOrchestrator.ts`                                  | Module-level `isRunning` latch around `syncPending`.                                                                                         |
| `src/data/sync/__tests__/SyncOrchestrator.test.ts`                   | New test proving concurrent calls do not duplicate work.                                                                                     |

---

## Task 1: Scaffold themeStore

**Files:**

- Create: `src/presentation/stores/themeStore.ts`
- Create: `src/presentation/stores/themeStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/presentation/stores/themeStore.test.ts
import { useThemeStore } from './themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ preference: 'system', hydrated: false });
  });

  it('defaults to system preference before hydration', () => {
    expect(useThemeStore.getState().preference).toBe('system');
    expect(useThemeStore.getState().hydrated).toBe(false);
  });

  it('setPreference updates value', () => {
    useThemeStore.getState().setPreference('dark');
    expect(useThemeStore.getState().preference).toBe('dark');
  });

  it('markHydrated flips hydrated to true', () => {
    useThemeStore.getState().markHydrated();
    expect(useThemeStore.getState().hydrated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/stores/themeStore.test.ts`
Expected: FAIL — "Cannot find module './themeStore'"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/presentation/stores/themeStore.ts
import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeState {
  preference: ThemePreference;
  hydrated: boolean;
  setPreference: (p: ThemePreference) => void;
  markHydrated: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: 'system',
  hydrated: false,
  setPreference: (preference): void => set({ preference }),
  markHydrated: (): void => set({ hydrated: true }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/presentation/stores/themeStore.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/stores/themeStore.ts src/presentation/stores/themeStore.test.ts
git commit -m "feat(theme): add themeStore slice (system/light/dark pref + hydrated flag)"
```

---

## Task 2: user_preferences Supabase migration

**Files:**

- Create: `supabase/migrations/008_user_preferences.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/008_user_preferences.sql
-- Stores cross-device user preferences (currently: theme appearance).

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme_preference TEXT NOT NULL DEFAULT 'system'
    CHECK (theme_preference IN ('system', 'light', 'dark')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY up_select ON public.user_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY up_insert ON public.user_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY up_update ON public.user_preferences
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

- [ ] **Step 2: Apply the migration locally via supabase CLI**

Run: `supabase db push` (or `supabase migration up` depending on version).
Expected: migration 008 applied; table exists with RLS enabled.

- [ ] **Step 3: Verify RLS manually in Supabase Studio**

Open Supabase Studio → Database → Policies → `user_preferences`. Confirm three policies exist: `up_select`, `up_insert`, `up_update`, all scoped `user_id = auth.uid()`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/008_user_preferences.sql
git commit -m "feat(db): add user_preferences table with RLS (theme sync)"
```

---

## Task 3: userPreferences repository

**Files:**

- Create: `src/infrastructure/storage/userPreferences.ts`
- Create: `src/infrastructure/storage/userPreferences.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/storage/userPreferences.test.ts
import { loadThemePreference, saveThemePreference } from './userPreferences';

const mockSelectSingle = jest.fn();
const mockUpsert = jest.fn();

jest.mock('../../data/remote/supabaseClient', () => ({
  supabase: {
    from: (): object => ({
      select: (): object => ({
        eq: (): object => ({
          maybeSingle: mockSelectSingle,
        }),
      }),
      upsert: mockUpsert,
    }),
  },
}));

describe('userPreferences repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loadThemePreference returns remote value when present', async () => {
    mockSelectSingle.mockResolvedValue({ data: { theme_preference: 'dark' }, error: null });
    const result = await loadThemePreference('user-1');
    expect(result).toBe('dark');
  });

  it('loadThemePreference returns null when row does not exist', async () => {
    mockSelectSingle.mockResolvedValue({ data: null, error: null });
    const result = await loadThemePreference('user-1');
    expect(result).toBeNull();
  });

  it('loadThemePreference returns null on network error (non-fatal)', async () => {
    mockSelectSingle.mockResolvedValue({ data: null, error: { message: 'network' } });
    const result = await loadThemePreference('user-1');
    expect(result).toBeNull();
  });

  it('saveThemePreference upserts with userId + preference', async () => {
    mockUpsert.mockResolvedValue({ error: null });
    await saveThemePreference('user-1', 'light');
    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: 'user-1', theme_preference: 'light', updated_at: expect.any(String) },
      { onConflict: 'user_id' },
    );
  });

  it('saveThemePreference swallows errors (non-fatal)', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'offline' } });
    await expect(saveThemePreference('user-1', 'dark')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/infrastructure/storage/userPreferences.test.ts`
Expected: FAIL — "Cannot find module './userPreferences'"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/storage/userPreferences.ts
import { supabase } from '../../data/remote/supabaseClient';
import type { ThemePreference } from '../../presentation/stores/themeStore';

export async function loadThemePreference(userId: string): Promise<ThemePreference | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('theme_preference')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const v = (data as { theme_preference?: string }).theme_preference;
  if (v === 'system' || v === 'light' || v === 'dark') return v;
  return null;
}

export async function saveThemePreference(
  userId: string,
  preference: ThemePreference,
): Promise<void> {
  await supabase.from('user_preferences').upsert(
    {
      user_id: userId,
      theme_preference: preference,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/infrastructure/storage/userPreferences.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/storage/userPreferences.ts src/infrastructure/storage/userPreferences.test.ts
git commit -m "feat(prefs): add user_preferences repository (theme load/save)"
```

---

## Task 4: themeStore AsyncStorage + Supabase hydration

**Files:**

- Modify: `src/presentation/stores/themeStore.ts`
- Modify: `src/presentation/stores/themeStore.test.ts`

- [ ] **Step 1: Extend the failing test**

Append to `src/presentation/stores/themeStore.test.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));
jest.mock('../../infrastructure/storage/userPreferences', () => ({
  loadThemePreference: jest.fn(),
  saveThemePreference: jest.fn(),
}));

import {
  loadThemePreference,
  saveThemePreference,
} from '../../infrastructure/storage/userPreferences';
import { hydrateThemeFromLocal, hydrateThemeFromRemote } from './themeStore';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockLoadRemote = loadThemePreference as jest.Mock;
const mockSaveRemote = saveThemePreference as jest.Mock;

describe('themeStore hydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useThemeStore.setState({ preference: 'system', hydrated: false });
  });

  it('hydrateThemeFromLocal reads AsyncStorage and marks hydrated', async () => {
    mockGetItem.mockResolvedValue('dark');
    await hydrateThemeFromLocal();
    expect(mockGetItem).toHaveBeenCalledWith('@theme:preference');
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(useThemeStore.getState().hydrated).toBe(true);
  });

  it('hydrateThemeFromLocal tolerates missing value', async () => {
    mockGetItem.mockResolvedValue(null);
    await hydrateThemeFromLocal();
    expect(useThemeStore.getState().preference).toBe('system');
    expect(useThemeStore.getState().hydrated).toBe(true);
  });

  it('hydrateThemeFromLocal ignores invalid values', async () => {
    mockGetItem.mockResolvedValue('turquoise');
    await hydrateThemeFromLocal();
    expect(useThemeStore.getState().preference).toBe('system');
  });

  it('setPreference writes to AsyncStorage', async () => {
    mockSetItem.mockResolvedValue(undefined);
    useThemeStore.getState().setPreference('light');
    // setter fires write asynchronously; flush microtasks
    await new Promise((r) => setImmediate(r));
    expect(mockSetItem).toHaveBeenCalledWith('@theme:preference', 'light');
  });

  it('hydrateThemeFromRemote overrides local when server has a value', async () => {
    mockLoadRemote.mockResolvedValue('light');
    useThemeStore.setState({ preference: 'dark', hydrated: true });
    await hydrateThemeFromRemote('user-1');
    expect(useThemeStore.getState().preference).toBe('light');
  });

  it('hydrateThemeFromRemote no-ops when remote returns null', async () => {
    mockLoadRemote.mockResolvedValue(null);
    useThemeStore.setState({ preference: 'dark', hydrated: true });
    await hydrateThemeFromRemote('user-1');
    expect(useThemeStore.getState().preference).toBe('dark');
  });

  it('setPreference also upserts to Supabase when userId provided', async () => {
    mockSaveRemote.mockResolvedValue(undefined);
    useThemeStore.getState().setPreference('dark', 'user-1');
    await new Promise((r) => setImmediate(r));
    expect(mockSaveRemote).toHaveBeenCalledWith('user-1', 'dark');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/stores/themeStore.test.ts`
Expected: FAIL — `hydrateThemeFromLocal` / `hydrateThemeFromRemote` not exported.

- [ ] **Step 3: Expand themeStore**

Replace the whole file with:

```ts
// src/presentation/stores/themeStore.ts
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadThemePreference,
  saveThemePreference,
} from '../../infrastructure/storage/userPreferences';

export type ThemePreference = 'system' | 'light' | 'dark';
const STORAGE_KEY = '@theme:preference';

interface ThemeState {
  preference: ThemePreference;
  hydrated: boolean;
  setPreference: (p: ThemePreference, userId?: string) => void;
  markHydrated: () => void;
}

function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark';
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: 'system',
  hydrated: false,
  setPreference: (preference, userId): void => {
    set({ preference });
    void AsyncStorage.setItem(STORAGE_KEY, preference).catch(() => {});
    if (userId) void saveThemePreference(userId, preference).catch(() => {});
  },
  markHydrated: (): void => set({ hydrated: true }),
}));

export async function hydrateThemeFromLocal(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (isThemePreference(raw)) {
      useThemeStore.setState({ preference: raw });
    }
  } finally {
    useThemeStore.getState().markHydrated();
  }
}

export async function hydrateThemeFromRemote(userId: string): Promise<void> {
  const remote = await loadThemePreference(userId);
  if (remote) {
    useThemeStore.setState({ preference: remote });
    void AsyncStorage.setItem(STORAGE_KEY, remote).catch(() => {});
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/presentation/stores/themeStore.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/stores/themeStore.ts src/presentation/stores/themeStore.test.ts
git commit -m "feat(theme): hydrate themeStore from AsyncStorage + Supabase"
```

---

## Task 5: Wire hydration into App boot

**Files:**

- Modify: `App.tsx` (lines near the top + inside `useEffect` that processes session)

- [ ] **Step 1: Add hydrate-on-boot call at module scope**

Near the top of `App.tsx`, after `installEarlyCrashHandler();`, add:

```ts
import {
  hydrateThemeFromLocal,
  hydrateThemeFromRemote,
} from './src/presentation/stores/themeStore';

// Hydrate theme from local storage before first render (async but fast).
// The themeStore starts in 'system' so worst-case users see OS theme for one frame.
void hydrateThemeFromLocal();
```

- [ ] **Step 2: Add remote hydration after session resolves**

Inside the `supabase.auth.getSession().then(async ({ data }) => { ... })` block in `App.tsx`, after `setSession(session)` and before the `if (session) { try { await initSession... }`, add:

```ts
if (session?.user?.id) {
  void hydrateThemeFromRemote(session.user.id);
}
```

And inside `onAuthStateChange` handler, after `setSession(session ?? null)`:

```ts
if (session?.user?.id) {
  void hydrateThemeFromRemote(session.user.id);
}
```

- [ ] **Step 3: Typecheck + run full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: TS passes; all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add App.tsx
git commit -m "feat(theme): hydrate theme store on boot and after auth"
```

---

## Task 6: `useAppTheme` reads from themeStore

**Files:**

- Modify: `src/presentation/theme/useAppTheme.ts`

- [ ] **Step 1: Replace the hook**

Replace the last 5 lines of `src/presentation/theme/useAppTheme.ts` with:

```ts
import { useThemeStore } from '../stores/themeStore';

export function useAppTheme(): typeof lightTheme | typeof darkTheme {
  const osScheme = useColorScheme();
  const preference = useThemeStore((s) => s.preference);
  const effective = preference === 'system' ? osScheme : preference;
  return effective === 'dark' ? darkTheme : lightTheme;
}
```

- [ ] **Step 2: Run existing theme-consumer tests**

Run: `npx jest src/presentation/theme src/presentation/screens/dashboard src/presentation/screens/settings`
Expected: PASS — the existing tests that mock `useAppTheme` still work; real-hook sites now react to `themeStore`.

- [ ] **Step 3: Drop the forced light mode in app.config.ts**

Edit `app.config.ts`. Remove the line:

```ts
  userInterfaceStyle: 'light',
```

- [ ] **Step 4: Commit**

```bash
git add src/presentation/theme/useAppTheme.ts app.config.ts
git commit -m "feat(theme): useAppTheme honours themeStore; drop userInterfaceStyle lock"
```

---

## Task 7: Appearance row in Settings

**Files:**

- Modify: `src/presentation/screens/settings/SettingsScreen.tsx`

- [ ] **Step 1: Write the failing test**

Create/append `src/presentation/screens/settings/__tests__/SettingsScreen.appearance.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { SettingsScreen } from '../SettingsScreen';
import { useThemeStore } from '../../../stores/themeStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn().mockResolvedValue(null), setItem: jest.fn() },
}));
jest.mock('../../../../data/remote/supabaseClient', () => ({
  supabase: { auth: { signOut: jest.fn() } },
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({
      session: { user: { id: 'user-1', email: 'a@b.com' } },
      householdId: 'h1',
      availableHouseholds: [{ id: 'h1', name: 'Home', paydayDay: 25, userLevel: 1 }],
    }),
  ),
}));

const mockNav = { navigate: jest.fn() };

function wrap(el: React.ReactElement): React.ReactElement {
  return <PaperProvider>{el}</PaperProvider>;
}

describe('SettingsScreen — Appearance', () => {
  beforeEach(() => {
    useThemeStore.setState({ preference: 'system', hydrated: true });
  });

  it('shows three appearance options', () => {
    const { getByTestId } = render(
      wrap(<SettingsScreen navigation={mockNav as never} route={{} as never} />),
    );
    expect(getByTestId('appearance-system')).toBeTruthy();
    expect(getByTestId('appearance-light')).toBeTruthy();
    expect(getByTestId('appearance-dark')).toBeTruthy();
  });

  it('tapping Dark updates themeStore', () => {
    const { getByTestId } = render(
      wrap(<SettingsScreen navigation={mockNav as never} route={{} as never} />),
    );
    fireEvent.press(getByTestId('appearance-dark'));
    expect(useThemeStore.getState().preference).toBe('dark');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/screens/settings/__tests__/SettingsScreen.appearance.test.tsx`
Expected: FAIL — testIDs not found.

- [ ] **Step 3: Add the Appearance section**

In `src/presentation/screens/settings/SettingsScreen.tsx`, add this import near the top:

```ts
import { SegmentedButtons } from 'react-native-paper';
import { useThemeStore } from '../../stores/themeStore';
```

Inside the component, read the store once:

```ts
const themePref = useThemeStore((s) => s.preference);
const setThemePref = useThemeStore((s) => s.setPreference);
const userId = session?.user?.id;
```

Add this `List.Section` _after_ the "Household" section (before the first existing section ends — place it before the sign-out button):

```tsx
<List.Section>
  <List.Subheader style={styles.subheader}>Appearance</List.Subheader>
  <Surface style={[styles.section, { backgroundColor: colors.surface }]} elevation={0}>
    <View style={styles.appearanceRow}>
      <SegmentedButtons
        value={themePref}
        onValueChange={(v): void => setThemePref(v as 'system' | 'light' | 'dark', userId)}
        buttons={[
          { value: 'system', label: 'System', testID: 'appearance-system' },
          { value: 'light', label: 'Light', testID: 'appearance-light' },
          { value: 'dark', label: 'Dark', testID: 'appearance-dark' },
        ]}
      />
    </View>
  </Surface>
</List.Section>
```

Add to the `StyleSheet.create({...})` block:

```ts
appearanceRow: {
  padding: spacing.base,
},
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/presentation/screens/settings/__tests__/SettingsScreen.appearance.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/screens/settings/SettingsScreen.tsx src/presentation/screens/settings/__tests__/SettingsScreen.appearance.test.tsx
git commit -m "feat(settings): add Appearance row (system/light/dark) wired to themeStore"
```

---

## Task 8: Move AddTransactionScreen + slip screens onto `useAppTheme`

**Files:**

- Modify: `src/presentation/screens/transactions/AddTransactionScreen.tsx`
- Modify: `src/presentation/screens/slipScanning/SlipConfirmScreen.tsx`
- Modify: `src/presentation/screens/slipScanning/SlipQueueScreen.tsx`

- [ ] **Step 1: Replace the `colours` import in AddTransactionScreen**

In `src/presentation/screens/transactions/AddTransactionScreen.tsx`:

Replace:

```ts
import { colours, spacing, radius } from '../../theme/tokens';
```

With:

```ts
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
```

Inside the component, add (if not already present):

```ts
const { colors } = useAppTheme();
```

Replace every occurrence of `colours.X` inside the component or the `StyleSheet.create` with:

- Inline style: `{ color: colors.X }` (for text/icon tints)
- Inline style: `{ backgroundColor: colors.X }` (for surfaces)
- Move colour-keyed style props _out_ of `StyleSheet.create` and apply via `style={[styles.foo, { color: colors.primary }]}`

Concretely: remove `color`/`backgroundColor`/`borderColor` from the `StyleSheet.create` block for any rule that used `colours.*`, and apply them inline.

- [ ] **Step 2: Repeat for SlipConfirmScreen and SlipQueueScreen**

Same pattern: drop `colours` from the token import, add `const { colors } = useAppTheme();`, move colour props from stylesheet rules to inline.

- [ ] **Step 3: Typecheck + lint + test**

Run: `npx tsc --noEmit && npx eslint src/ --ext .ts,.tsx --max-warnings 0 && npx jest`
Expected: all pass, no raw `colours.` references remain in the three files (`grep -n "colours\." <file>` returns zero matches).

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/transactions/AddTransactionScreen.tsx src/presentation/screens/slipScanning/SlipConfirmScreen.tsx src/presentation/screens/slipScanning/SlipQueueScreen.tsx
git commit -m "fix(theme): move AddTransaction + slip screens onto useAppTheme"
```

---

## Task 9: Add monthlyIncomeCents to appStore

**Files:**

- Modify: `src/presentation/stores/appStore.ts`
- Modify: `src/presentation/stores/appStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/presentation/stores/appStore.test.ts`:

```ts
it('setMonthlyIncomeCents updates value', () => {
  useAppStore.getState().setMonthlyIncomeCents(5000000);
  expect(useAppStore.getState().monthlyIncomeCents).toBe(5000000);
});

it('reset clears monthlyIncomeCents', () => {
  useAppStore.setState({ monthlyIncomeCents: 5000000 });
  useAppStore.getState().reset();
  expect(useAppStore.getState().monthlyIncomeCents).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/stores/appStore.test.ts`
Expected: FAIL — `setMonthlyIncomeCents` not a function.

- [ ] **Step 3: Extend appStore**

In `src/presentation/stores/appStore.ts`:

Add to `AppState` interface:

```ts
monthlyIncomeCents: number | null;
```

Add to `AppActions` interface:

```ts
setMonthlyIncomeCents: (cents: number | null) => void;
```

In the `create<AppState & AppActions>((set) => ({ ... }))` block:

```ts
monthlyIncomeCents: null,
setMonthlyIncomeCents: (monthlyIncomeCents): void => set({ monthlyIncomeCents }),
```

And extend the `reset` call to include:

```ts
monthlyIncomeCents: null,
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/presentation/stores/appStore.test.ts`
Expected: PASS — 2 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/stores/appStore.ts src/presentation/stores/appStore.test.ts
git commit -m "feat(store): add monthlyIncomeCents to appStore for onboarding hand-off"
```

---

## Task 10: IncomeStep writes monthlyIncomeCents, stops creating envelope

**Files:**

- Modify: `src/presentation/screens/auth/onboarding/IncomeStep.tsx`

- [ ] **Step 1: Refactor `handleNext`**

Open `src/presentation/screens/auth/onboarding/IncomeStep.tsx`.

Replace the `handleNext` function body with:

```ts
const handleNext = async (): Promise<void> => {
  setError(null);
  const cents = toCents(amountStr);
  if (cents <= 0) {
    setError('Please enter a valid monthly income amount');
    return;
  }
  useAppStore.getState().setMonthlyIncomeCents(cents);
  navigation.navigate('ExpenseCategories');
};
```

Remove any `CreateEnvelopeUseCase` / `audit` / `engine` imports that are now unused. Keep `BudgetPeriodEngine` only if still referenced elsewhere in the file.

- [ ] **Step 2: Update the IncomeStep test**

Find `src/presentation/screens/auth/onboarding/__tests__/onboarding.test.tsx`. Update the IncomeStep "saves income and navigates" test to assert `setMonthlyIncomeCents` was called with the centised amount, not that `CreateEnvelopeUseCase.execute` was called.

```ts
// replace the existing IncomeStep "saves" test with:
it('stores monthly income in appStore and advances to ExpenseCategories', async () => {
  const mockSetMonthlyIncome = jest.fn();
  // patch the appStore mock to expose the setter
  (useAppStore as unknown as jest.Mock).mockImplementation((selector: (s: object) => unknown) =>
    selector({
      householdId: 'hh-test',
      paydayDay: 25,
      session: { user: { id: 'user-1' } },
      setPaydayDay: jest.fn(),
      setMonthlyIncomeCents: mockSetMonthlyIncome,
      setOnboardingCompleted: jest.fn(),
    }),
  );
  // … existing setup …
  fireEvent.changeText(input, '50000');
  fireEvent.press(nextButton);
  await waitFor(() => {
    expect(mockSetMonthlyIncome).toHaveBeenCalledWith(5_000_000);
    expect(mockNavigate).toHaveBeenCalledWith('ExpenseCategories');
  });
});
```

(If the test structure is different in practice, mirror the existing pattern — the assertion change is the point.)

- [ ] **Step 3: Run tests**

Run: `npx jest src/presentation/screens/auth/onboarding/__tests__/onboarding.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/auth/onboarding/IncomeStep.tsx src/presentation/screens/auth/onboarding/__tests__/onboarding.test.tsx
git commit -m "refactor(onboarding): IncomeStep stores income in appStore, no envelope yet"
```

---

## Task 11: ExpenseCategoriesStep stops creating envelopes, hands off selection

**Files:**

- Modify: `src/presentation/navigation/types.ts`
- Modify: `src/presentation/screens/auth/onboarding/ExpenseCategoriesStep.tsx`

- [ ] **Step 1: Extend the nav param type**

In `src/presentation/navigation/types.ts`, replace the `OnboardingStackParamList` type:

```ts
export type OnboardingStackParamList = {
  Welcome: undefined;
  Income: undefined;
  ExpenseCategories: undefined;
  AllocateEnvelopes: { categories: string[] };
  Payday: undefined;
  MeterSetup: undefined;
  ScoreIntro: undefined;
  Finish: undefined;
};
```

- [ ] **Step 2: Refactor ExpenseCategoriesStep.handleNext**

In `src/presentation/screens/auth/onboarding/ExpenseCategoriesStep.tsx`, replace the `handleNext` function with:

```ts
const handleNext = (): void => {
  setError(null);
  if (selected.size === 0) {
    setError('Select at least one spending category');
    return;
  }
  navigation.navigate('AllocateEnvelopes', { categories: Array.from(selected) });
};
```

Remove `CreateEnvelopeUseCase`, `audit`, `engine`, `format`, `loading`, and any now-unused imports.

- [ ] **Step 3: Run existing test**

Run: `npx jest src/presentation/screens/auth/onboarding/__tests__/onboarding.test.tsx`
Expected: the ExpenseCategoriesStep test may fail because it asserts `CreateEnvelopeUseCase.execute` calls. Update the test to assert:

```ts
expect(mockNavigate).toHaveBeenCalledWith('AllocateEnvelopes', {
  categories: expect.arrayContaining(['Groceries']),
});
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/presentation/screens/auth/onboarding/__tests__/onboarding.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/navigation/types.ts src/presentation/screens/auth/onboarding/ExpenseCategoriesStep.tsx src/presentation/screens/auth/onboarding/__tests__/onboarding.test.tsx
git commit -m "refactor(onboarding): ExpenseCategories hands selection to AllocateEnvelopes"
```

---

## Task 12: AllocateEnvelopesStep — equal-split UI + create envelopes

**Files:**

- Create: `src/presentation/screens/auth/onboarding/AllocateEnvelopesStep.tsx`
- Create: `src/presentation/screens/auth/onboarding/__tests__/AllocateEnvelopesStep.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/presentation/screens/auth/onboarding/__tests__/AllocateEnvelopesStep.test.tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { AllocateEnvelopesStep } from '../AllocateEnvelopesStep';

const mockExecute = jest.fn().mockResolvedValue({ success: true, data: { id: 'env-x' } });
jest.mock('../../../../../domain/envelopes/CreateEnvelopeUseCase', () => ({
  CreateEnvelopeUseCase: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: (): object => ({ navigate: mockNavigate }),
  useRoute: (): object => ({ params: { categories: ['Groceries', 'Rent', 'Transport'] } }),
}));

jest.mock('../../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../../data/audit/AuditLogger', () => ({ AuditLogger: jest.fn() }));

jest.mock('../../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    jest.fn((selector: (s: object) => unknown) =>
      selector({
        householdId: 'hh-test',
        paydayDay: 25,
        monthlyIncomeCents: 3_000_000, // R30 000
      }),
    ),
    {
      getState: (): object => ({
        monthlyIncomeCents: 3_000_000,
        householdId: 'hh-test',
        paydayDay: 25,
      }),
    },
  ),
}));

function wrap(el: React.ReactElement): React.ReactElement {
  return <PaperProvider>{el}</PaperProvider>;
}

describe('AllocateEnvelopesStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('equal-splits income across categories on first render', () => {
    const { getByTestId } = render(wrap(<AllocateEnvelopesStep />));
    // R30 000 / 3 categories = R10 000 each
    expect(getByTestId('alloc-input-Groceries').props.value).toBe('10000.00');
    expect(getByTestId('alloc-input-Rent').props.value).toBe('10000.00');
    expect(getByTestId('alloc-input-Transport').props.value).toBe('10000.00');
  });

  it('updates To Assign banner as user nudges allocations', () => {
    const { getByTestId } = render(wrap(<AllocateEnvelopesStep />));
    fireEvent.changeText(getByTestId('alloc-input-Groceries'), '15000');
    expect(getByTestId('to-assign').props.children).toContain('-5');
  });

  it('creates one envelope per category with its allocation on Next', async () => {
    const { getByText } = render(wrap(<AllocateEnvelopesStep />));
    fireEvent.press(getByText('Next'));
    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledTimes(3);
    });
    expect(mockNavigate).toHaveBeenCalledWith('Payday');
  });

  it('blocks Next when To Assign is not zero', async () => {
    const { getByTestId, getByText, queryByText } = render(wrap(<AllocateEnvelopesStep />));
    fireEvent.changeText(getByTestId('alloc-input-Groceries'), '20000');
    fireEvent.press(getByText('Next'));
    await waitFor(() => {
      expect(queryByText(/Your allocations must total/i)).toBeTruthy();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/screens/auth/onboarding/__tests__/AllocateEnvelopesStep.test.tsx`
Expected: FAIL — "Cannot find module '../AllocateEnvelopesStep'".

- [ ] **Step 3: Implement AllocateEnvelopesStep**

```tsx
// src/presentation/screens/auth/onboarding/AllocateEnvelopesStep.tsx
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { db } from '../../../../data/local/db';
import { AuditLogger } from '../../../../data/audit/AuditLogger';
import { CreateEnvelopeUseCase } from '../../../../domain/envelopes/CreateEnvelopeUseCase';
import { BudgetPeriodEngine } from '../../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../../stores/appStore';
import { useAppTheme } from '../../../theme/useAppTheme';
import { spacing } from '../../../theme/tokens';
import type { OnboardingStackParamList } from '../../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'AllocateEnvelopes'>;
type Route = RouteProp<OnboardingStackParamList, 'AllocateEnvelopes'>;

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

function toCents(str: string): number {
  const n = parseFloat(String(str).replace(',', '.'));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}
function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function AllocateEnvelopesStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const categories = route.params.categories;

  const householdId = useAppStore((s) => s.householdId);
  const paydayDay = useAppStore((s) => s.paydayDay);
  const incomeCents = useAppStore((s) => s.monthlyIncomeCents) ?? 0;

  const initialAllocations = useMemo<Record<string, number>>(() => {
    if (categories.length === 0) return {};
    const base = Math.floor(incomeCents / categories.length);
    const remainder = incomeCents - base * categories.length;
    const out: Record<string, number> = {};
    categories.forEach((c, i) => {
      out[c] = i === 0 ? base + remainder : base; // pile the remainder into the first
    });
    return out;
  }, [categories, incomeCents]);

  const [allocStr, setAllocStr] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of categories) out[c] = fromCents(initialAllocations[c] ?? 0);
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const totalAllocatedCents = categories.reduce((s, c) => s + toCents(allocStr[c] ?? '0'), 0);
  const toAssignCents = incomeCents - totalAllocatedCents;

  const handleNext = async (): Promise<void> => {
    setError(null);
    if (toAssignCents !== 0) {
      setError(
        `Your allocations must total exactly R${fromCents(incomeCents)}. Currently off by R${fromCents(Math.abs(toAssignCents))}.`,
      );
      return;
    }
    if (!householdId) {
      setError('Household not ready — please retry in a moment.');
      return;
    }
    setLoading(true);
    try {
      const period = engine.getCurrentPeriod(paydayDay);
      const periodStart = format(period.startDate, 'yyyy-MM-dd');
      for (const category of categories) {
        const cents = toCents(allocStr[category] ?? '0');
        const uc = new CreateEnvelopeUseCase(db, audit, {
          householdId,
          name: category,
          allocatedCents: cents,
          envelopeType: category === 'Savings' ? 'savings' : 'spending',
          periodStart,
        });
        await uc.execute();
      }
      navigation.navigate('Payday');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <Text variant="headlineMedium" style={[styles.title, { color: colors.onSurface }]}>
        Split your income
      </Text>
      <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
        Every Rand gets a job. We&apos;ve split your R{fromCents(incomeCents)} equally — nudge each
        envelope until &quot;To assign&quot; is R0.
      </Text>

      <View
        style={[
          styles.toAssign,
          {
            backgroundColor:
              toAssignCents === 0
                ? colors.successContainer
                : toAssignCents < 0
                  ? colors.errorContainer
                  : colors.primaryContainer,
          },
        ]}
      >
        <Text variant="labelMedium" style={{ color: colors.onSurface }}>
          TO ASSIGN
        </Text>
        <Text variant="titleLarge" testID="to-assign" style={{ color: colors.onSurface }}>
          {'R' + fromCents(toAssignCents)}
        </Text>
      </View>

      {categories.map((c) => (
        <View key={c} style={styles.row}>
          <Text variant="titleMedium" style={[styles.rowLabel, { color: colors.onSurface }]}>
            {c}
          </Text>
          <TextInput
            mode="outlined"
            value={allocStr[c]}
            onChangeText={(v): void => setAllocStr((prev) => ({ ...prev, [c]: v }))}
            keyboardType="decimal-pad"
            left={<TextInput.Affix text="R" />}
            testID={`alloc-input-${c}`}
            style={styles.rowInput}
          />
        </View>
      ))}

      {error && <HelperText type="error">{error}</HelperText>}

      <Button
        mode="contained"
        onPress={handleNext}
        loading={loading}
        disabled={loading}
        style={styles.cta}
      >
        Next
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, paddingBottom: spacing.xxl },
  title: { fontFamily: 'Fraunces_700Bold', marginBottom: spacing.xs },
  subtitle: { marginBottom: spacing.lg },
  toAssign: {
    padding: spacing.base,
    borderRadius: 12,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  row: { marginBottom: spacing.md },
  rowLabel: { marginBottom: spacing.xs },
  rowInput: {},
  cta: { marginTop: spacing.lg },
});
```

- [ ] **Step 4: Register the screen**

In `src/presentation/screens/auth/onboarding/OnboardingNavigator.tsx`, after `ExpenseCategoriesStep` import add:

```ts
import { AllocateEnvelopesStep } from './AllocateEnvelopesStep';
```

And add a Stack.Screen between ExpenseCategories and Payday:

```tsx
<Stack.Screen name="AllocateEnvelopes" component={AllocateEnvelopesStep} />
```

- [ ] **Step 5: Run tests**

Run: `npx jest src/presentation/screens/auth/onboarding/__tests__/AllocateEnvelopesStep.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/screens/auth/onboarding/AllocateEnvelopesStep.tsx src/presentation/screens/auth/onboarding/__tests__/AllocateEnvelopesStep.test.tsx src/presentation/screens/auth/onboarding/OnboardingNavigator.tsx
git commit -m "feat(onboarding): add AllocateEnvelopesStep (equal-split + nudge)"
```

---

## Task 13: Dashboard — replace FABs with single Add Transaction FAB

**Files:**

- Modify: `src/presentation/screens/dashboard/DashboardScreen.tsx`

- [ ] **Step 1: Check nav type has AddTransaction**

Grep: `grep -n "AddTransaction" src/presentation/navigation/types.ts`

If not present, add to the appropriate stack (likely `DashboardStackParamList`):

```ts
AddTransaction: undefined;
```

- [ ] **Step 2: Replace FAB block**

In `src/presentation/screens/dashboard/DashboardScreen.tsx`, replace both FAB elements and their styles with:

```tsx
<FAB
  icon="plus"
  label="Add transaction"
  style={[styles.fab, { backgroundColor: colors.primary }]}
  onPress={() => navigation.navigate('AddTransaction')}
  color={colors.onPrimary}
  testID="add-transaction-fab"
/>
```

Delete the `fabCamera` style entry.

Also remove `handleAddEnvelope` and the unused `AddEditEnvelope` navigation — the + action is now for transactions. The envelope-edit entry remains on `EnvelopeCard` press.

- [ ] **Step 3: Add "+ New envelope" to Budget tab or empty state**

In the existing `<EmptyState ... />` block on Dashboard, pass an action button prop if available; otherwise add a small link below the empty-state card that navigates to `AddEditEnvelope`. If `EmptyState` already supports an `action` prop, wire it; if not, add a `Button` inside the empty branch:

```tsx
{
  envelopes.length === 0 && !loading && (
    <Button mode="text" onPress={() => navigation.navigate('AddEditEnvelope', {})}>
      + New envelope
    </Button>
  );
}
```

- [ ] **Step 4: Update Dashboard tests**

Adjust any existing Dashboard tests that asserted on two FABs. Run:

```bash
npx jest src/presentation/screens/dashboard
```

Fix any assertions that reference `camera-fab` — they should now reference `add-transaction-fab`.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/screens/dashboard/DashboardScreen.tsx src/presentation/navigation/types.ts src/presentation/screens/dashboard/__tests__/
git commit -m "feat(dashboard): single Add Transaction FAB, remove camera FAB"
```

---

## Task 14: AddTransactionScreen — add Scan slip secondary button

**Files:**

- Modify: `src/presentation/screens/transactions/AddTransactionScreen.tsx`

- [ ] **Step 1: Add the Scan slip button**

Above (or below, wherever placement makes sense for your design) the main Save button in `AddTransactionScreen`, add:

```tsx
<Button
  mode="outlined"
  icon="camera-outline"
  onPress={() => navigation.navigate('SlipScanning' as never)}
  style={styles.scanButton}
  testID="scan-slip-button"
>
  Scan slip instead
</Button>
```

Add to stylesheet:

```ts
scanButton: { marginBottom: spacing.md },
```

- [ ] **Step 2: Verify existing tests + add one for the button**

Append to the AddTransactionScreen test:

```ts
it('shows Scan slip button that navigates to SlipScanning', () => {
  const { getByTestId } = render(<AddTransactionScreen navigation={mockNav as never} route={{} as never} />);
  fireEvent.press(getByTestId('scan-slip-button'));
  expect(mockNav.navigate).toHaveBeenCalledWith('SlipScanning');
});
```

- [ ] **Step 3: Run tests**

Run: `npx jest src/presentation/screens/transactions`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/transactions/AddTransactionScreen.tsx src/presentation/screens/transactions/__tests__/
git commit -m "feat(txn): add Scan slip secondary button on Add Transaction"
```

---

## Task 15: Dashboard KPI typography + Ramsey Score badge

**Files:**

- Modify: `src/presentation/screens/dashboard/DashboardScreen.tsx`
- Modify: `src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx`

- [ ] **Step 1: Promote KPI text**

In `DashboardScreen.tsx` `StyleSheet.create`, replace:

```ts
summaryValue: {
  fontSize: 14,
  fontFamily: 'PlusJakartaSans_700Bold',
},
```

with:

```ts
summaryValue: {
  fontSize: 24,
  lineHeight: 28,
  fontFamily: 'PlusJakartaSans_700Bold',
  fontVariant: ['tabular-nums'],
},
summaryLabel: {
  letterSpacing: 0.8,
  marginBottom: spacing.xs,
  fontSize: 10,
},
```

(Merge the `summaryLabel` override into the existing rule if it already exists.)

- [ ] **Step 2: Fix the Ramsey Score badge**

Open `src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx`. Find the score text and the label text. Replace their style rules (or inline fontSize props) to:

- Score number: `fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums']`
- Label (EXCELLENT/GOOD/FAIR/POOR): `fontSize: 10, letterSpacing: 0.8, fontFamily: 'PlusJakartaSans_600SemiBold'`

- [ ] **Step 3: Run tests**

Run: `npx jest src/presentation/screens/dashboard`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/dashboard/DashboardScreen.tsx src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx
git commit -m "style(dashboard): promote KPI + Ramsey Score badge typography"
```

---

## Task 16: Guard non-null householdId on screens that can mount early

**Files:**

- Modify: `src/presentation/screens/dashboard/DashboardScreen.tsx`
- Modify: `src/presentation/screens/babySteps/BabyStepsScreen.tsx`
- Modify: `src/presentation/screens/auth/onboarding/IncomeStep.tsx`
- Modify: `src/presentation/screens/auth/onboarding/PaydayStep.tsx`

- [ ] **Step 1: Import LoadingSkeletonList on each target**

Each of the four files above: ensure this import is present (or `LoadingSplash` where a skeleton list is inappropriate for the screen):

```ts
import { LoadingSplash } from '../../components/shared/LoadingSplash';
```

Adjust the relative path per file (`../../../components/shared/LoadingSplash` for onboarding steps).

- [ ] **Step 2: Replace the bang assertion with a guarded render**

Replace every occurrence of:

```ts
const householdId = useAppStore((s) => s.householdId)!;
```

with:

```ts
const householdId = useAppStore((s) => s.householdId);
```

Then, immediately after the other hooks (top of the component, after `useState`/`useAppTheme` etc.), add:

```ts
if (!householdId) {
  return <LoadingSplash />;
}
```

- [ ] **Step 3: Typecheck + test**

Run: `npx tsc --noEmit && npx jest src/presentation/screens/dashboard src/presentation/screens/babySteps src/presentation/screens/auth/onboarding`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/dashboard/DashboardScreen.tsx src/presentation/screens/babySteps/BabyStepsScreen.tsx src/presentation/screens/auth/onboarding/IncomeStep.tsx src/presentation/screens/auth/onboarding/PaydayStep.tsx
git commit -m "fix(nav): guard householdId on early-mounting screens with LoadingSplash"
```

---

## Task 17: SyncOrchestrator concurrency latch

**Files:**

- Modify: `src/data/sync/SyncOrchestrator.ts`
- Modify: `src/data/sync/__tests__/SyncOrchestrator.test.ts` (or create if the existing test file lives elsewhere — check `src/data/sync/__tests__/`)

- [ ] **Step 1: Write the failing test**

Append to the existing SyncOrchestrator test file (e.g. `src/data/sync/__tests__/SyncOrchestrator.test.ts`):

```ts
it('rejects concurrent syncPending calls — second returns { synced: 0, failed: 0, emfFlipped: 0 }', async () => {
  // Arrange: one pending item so the first call has work to do
  await db.insert(pendingSync).values({
    id: 'p1',
    householdId: 'h1',
    tableName: 'envelopes',
    operation: 'upsert',
    entityId: 'e1',
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
  // Stall the supabase RPC so the first call is in-flight
  (supabase.rpc as jest.Mock).mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve({ error: null }), 50)),
  );
  const orch = new SyncOrchestrator(db, supabase);

  const [first, second] = await Promise.all([orch.syncPending('h1'), orch.syncPending('h1')]);
  // The second call should have seen the latch and exited
  expect(first.synced + second.synced).toBeLessThanOrEqual(1);
  expect(second).toEqual({ synced: 0, failed: 0, emfFlipped: 0 });
});
```

(Adjust imports/setup to match the existing test harness; the important bit is two overlapping calls and the second returning a zero result.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/data/sync/__tests__/SyncOrchestrator.test.ts`
Expected: FAIL — the second call also runs the queue, `second.synced` might be 1 or duplicates arise.

- [ ] **Step 3: Add the latch**

At the top of `src/data/sync/SyncOrchestrator.ts`, above the class declaration, add:

```ts
let isSyncRunning = false;
```

Replace the first few lines of `syncPending` with:

```ts
async syncPending(
  householdId?: string,
): Promise<{ synced: number; failed: number; emfFlipped: number }> {
  if (isSyncRunning) {
    return { synced: 0, failed: 0, emfFlipped: 0 };
  }
  isSyncRunning = true;
  try {
    // … existing body …
  } finally {
    isSyncRunning = false;
  }
}
```

Wrap the entire existing body in the `try { ... } finally { ... }`.

- [ ] **Step 4: Run tests**

Run: `npx jest src/data/sync`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/sync/SyncOrchestrator.ts src/data/sync/__tests__/SyncOrchestrator.test.ts
git commit -m "fix(sync): add module-level isRunning latch to syncPending"
```

---

## Task 18: Full-suite test + coverage + eslint + typecheck

- [ ] **Step 1: Run all checks**

Run: `npx tsc --noEmit && npx eslint src/ --ext .ts,.tsx --max-warnings 0 && npx jest --coverage`
Expected: TS passes; eslint clean; 491+ tests pass; coverage ≥ 65% lines (the threshold).

- [ ] **Step 2: Manually build release APK locally**

Run: `cd android && ./gradlew assembleRelease -PversionCode=999 -PversionName=phase1-local --no-daemon`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Install on RTL device and smoke test**

Run:

```bash
adb -s localhost:50794 install -r android/app/build/outputs/apk/release/app-release.apk
```

Walk the journey:

1. Fresh install → sign up → create household → onboarding.
2. On ExpenseCategories select 3 items → tap Next.
3. Verify AllocateEnvelopes shows equal split adding to monthly income.
4. Adjust one envelope → To Assign becomes non-zero → Next is blocked with helpful message.
5. Restore to zero → Next → Payday → … → Finish → Dashboard.
6. Dashboard shows envelopes with real allocations, single "Add transaction" FAB, KPIs readable.
7. Tap FAB → AddTransaction → tap "Scan slip instead" → SlipScanning opens.
8. Back. Settings → Appearance → tap Dark → app goes dark end-to-end (including AddTransaction screen).
9. Tap System → returns to OS theme.

- [ ] **Step 4: Commit the assembled APK smoke result as a note (no binary)**

```bash
git commit --allow-empty -m "chore: Phase 1 smoke tested locally on RTL S24 (Android 15)"
```

---

## Task 19: Push and verify CI/CD

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Watch CI + CD**

Run: `gh run list --limit 2`
Expected: both CI and CD complete successfully.

- [ ] **Step 3: Promote to Play Store internal track (manual)**

Open Play Console → Testing → Internal testing → confirm the new AAB is available; promote from draft if needed.

- [ ] **Step 4: Exit criteria verification**

Confirm each of Phase 1's exit criteria from `docs/phased-roadmap.md`:

- Internal-tester journey: fresh install → signed in → allocated envelopes totalling their income → logged one transaction, all in <90s.
- Dark-mode toggle works on every screen a user can reach.
- No concurrent-run duplicate entries in `pendingSync` under network-regain + foreground races.

If any fail, open a follow-up task before declaring Phase 1 done.

---

## Self-review

**Spec coverage (vs Phase 1 scope in `docs/phased-roadmap.md`):**

- Onboarding allocation wizard → Tasks 9, 10, 11, 12 ✅
- Dashboard Add Transaction FAB → Task 13 ✅
- Dashboard KPI typography → Task 15 ✅
- Collapse stacked FABs (camera moved into AddTransaction) → Tasks 13 + 14 ✅
- Ramsey Score badge legibility → Task 15 ✅
- Theme fix (drop `userInterfaceStyle`, move raw-hex sites onto tokens) → Tasks 6 + 8 ✅
- Appearance row in Settings → Task 7 ✅
- Theme preference persistence (AsyncStorage + Supabase `user_preferences`) → Tasks 1–5 ✅
- `SyncOrchestrator.syncPending` concurrency latch → Task 17 ✅
- Non-null `householdId!` guards → Task 16 ✅

**Placeholder scan:** No "TBD", "implement later", or generic "handle edge cases" phrasing. Every step shows code.

**Type consistency:** `ThemePreference = 'system' | 'light' | 'dark'` used consistently across `themeStore.ts`, `userPreferences.ts`, `SettingsScreen.tsx`, and the migration CHECK constraint. `monthlyIncomeCents: number | null` is consistent across `appStore`, `IncomeStep`, and `AllocateEnvelopesStep`. The new `AllocateEnvelopes` route name is used identically in `types.ts`, `ExpenseCategoriesStep.tsx`'s `navigate` call, `OnboardingNavigator.tsx`'s `Stack.Screen name`, and `AllocateEnvelopesStep.tsx`'s `useRoute` typing.
