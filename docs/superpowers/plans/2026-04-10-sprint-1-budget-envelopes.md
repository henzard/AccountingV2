# Sprint 1: Budget & Envelopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a fully working envelope budgeting screen — user logs in, sees their envelopes for the current budget period, can add and edit envelopes, and sees real-time balance and fill-bar per envelope, all stored in SQLite.

**Architecture:** Clean Architecture layers: domain use cases hold business rules (no DB imports in screens), a `useEnvelopes` hook bridges SQLite to React state, and the dashboard reads from that hook. Household ID = Supabase user ID (deterministic, no extra storage needed). Budget period calculated from `BudgetPeriodEngine` using the household's `payday_day`. All currency stored as integer cents.

**Tech Stack:** Expo SDK 55, expo-sqlite, drizzle-orm, Zustand (appStore), React Native Paper, react-navigation v6 (bottom tabs + native stack), date-fns, expo-crypto, Jest + jest-expo.

---

## File Structure

**New files:**
- `src/domain/households/EnsureHouseholdUseCase.ts` — finds or creates household record; household ID = Supabase user ID
- `src/domain/households/EnsureHouseholdUseCase.test.ts`
- `src/domain/envelopes/EnvelopeEntity.ts` — domain type + pure business functions (getRemainingCents, getPercentRemaining, isOverBudget)
- `src/domain/envelopes/EnvelopeEntity.test.ts`
- `src/domain/envelopes/CreateEnvelopeUseCase.ts` — validates + inserts envelope + logs audit
- `src/domain/envelopes/CreateEnvelopeUseCase.test.ts`
- `src/domain/envelopes/UpdateEnvelopeUseCase.ts` — validates + updates envelope + logs audit
- `src/domain/envelopes/UpdateEnvelopeUseCase.test.ts`
- `src/domain/envelopes/ArchiveEnvelopeUseCase.ts` — soft deletes envelope + logs audit
- `src/presentation/hooks/useEnvelopes.ts` — reactive SQLite hook for current period's envelopes
- `src/presentation/components/envelopes/EnvelopeCard.tsx` — envelope list card
- `src/presentation/screens/envelopes/AddEditEnvelopeScreen.tsx` — create/edit form
- `src/presentation/navigation/DashboardStackNavigator.tsx` — stack wrapper for Dashboard tab

**Modified files:**
- `src/presentation/stores/appStore.ts` — add `householdId`, `paydayDay`, their setters
- `src/presentation/navigation/types.ts` — add `DashboardStackParamList`
- `src/presentation/navigation/MainTabNavigator.tsx` — tab icons, use `DashboardStackNavigator`
- `src/presentation/navigation/RootNavigator.tsx` — gate Main tab on `householdId`
- `src/presentation/screens/dashboard/DashboardScreen.tsx` — real data: period header, summary, envelope list, FAB
- `App.tsx` — run `EnsureHouseholdUseCase` after session restore

---

## Task 1: Extend appStore with Household State

**Files:**
- Modify: `src/presentation/stores/appStore.ts`

- [ ] **Step 1: Write the failing test**

Create `src/presentation/stores/appStore.test.ts` (replace existing file if present):

```typescript
import { useAppStore } from './appStore';

describe('appStore — household slice', () => {
  beforeEach(() => {
    useAppStore.setState({
      householdId: null,
      paydayDay: 25,
    });
  });

  it('setHouseholdId updates householdId', () => {
    useAppStore.getState().setHouseholdId('hh-001');
    expect(useAppStore.getState().householdId).toBe('hh-001');
  });

  it('setPaydayDay updates paydayDay', () => {
    useAppStore.getState().setPaydayDay(1);
    expect(useAppStore.getState().paydayDay).toBe(1);
  });

  it('clearHousehold resets householdId to null', () => {
    useAppStore.getState().setHouseholdId('hh-001');
    useAppStore.getState().clearHousehold();
    expect(useAppStore.getState().householdId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/presentation/stores/appStore.test.ts --no-coverage
```

Expected: FAIL — `setHouseholdId is not a function`

- [ ] **Step 3: Update appStore.ts**

Replace `src/presentation/stores/appStore.ts` entirely:

```typescript
import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { BudgetPeriod } from '../../domain/shared/types';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

interface AppState {
  session: Session | null;
  userLevel: 1 | 2 | 3;
  currentPeriod: BudgetPeriod | null;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  pendingSyncCount: number;
  householdId: string | null;
  paydayDay: number;
}

interface AppActions {
  setSession: (session: Session | null) => void;
  setUserLevel: (level: 1 | 2 | 3) => void;
  setCurrentPeriod: (period: BudgetPeriod) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLastSyncAt: (isoDate: string) => void;
  setPendingSyncCount: (count: number) => void;
  setHouseholdId: (id: string) => void;
  setPaydayDay: (day: number) => void;
  clearHousehold: () => void;
}

export const useAppStore = create<AppState & AppActions>((set) => ({
  session: null,
  userLevel: 1,
  currentPeriod: null,
  syncStatus: 'idle',
  lastSyncAt: null,
  pendingSyncCount: 0,
  householdId: null,
  paydayDay: 25,
  setSession: (session): void => set({ session }),
  setUserLevel: (userLevel): void => set({ userLevel }),
  setCurrentPeriod: (currentPeriod): void => set({ currentPeriod }),
  setSyncStatus: (syncStatus): void => set({ syncStatus }),
  setLastSyncAt: (lastSyncAt): void => set({ lastSyncAt }),
  setPendingSyncCount: (pendingSyncCount): void => set({ pendingSyncCount }),
  setHouseholdId: (householdId): void => set({ householdId }),
  setPaydayDay: (paydayDay): void => set({ paydayDay }),
  clearHousehold: (): void => set({ householdId: null }),
}));
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/presentation/stores/appStore.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/presentation/stores/appStore.ts src/presentation/stores/appStore.test.ts
git commit -m "feat: add householdId and paydayDay slices to appStore"
```

---

## Task 2: EnsureHouseholdUseCase

**Files:**
- Create: `src/domain/households/EnsureHouseholdUseCase.ts`
- Create: `src/domain/households/EnsureHouseholdUseCase.test.ts`

The use case checks if a household with `id = userId` exists in SQLite. If found, returns it. If not, creates one with `name = 'My Household'` and `paydayDay = 25`.

- [ ] **Step 1: Write the failing test**

Create `src/domain/households/EnsureHouseholdUseCase.test.ts`:

```typescript
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid-1234' }));

import { EnsureHouseholdUseCase } from './EnsureHouseholdUseCase';

const makeDb = (existing: object | null) => ({
  select: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(existing ? [existing] : []),
      }),
    }),
  }),
  insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
});

const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

describe('EnsureHouseholdUseCase', () => {
  it('returns existing household when found', async () => {
    const db = makeDb({ id: 'user-abc', paydayDay: 1, name: 'Test' });
    const audit = makeAudit();
    const uc = new EnsureHouseholdUseCase(db as any, audit as any, 'user-abc');
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('user-abc');
      expect(result.data.paydayDay).toBe(1);
    }
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates household when not found', async () => {
    const db = makeDb(null);
    const audit = makeAudit();
    const uc = new EnsureHouseholdUseCase(db as any, audit as any, 'user-xyz');
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('user-xyz');
      expect(result.data.paydayDay).toBe(25);
    }
    expect(db.insert).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/domain/households/EnsureHouseholdUseCase.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './EnsureHouseholdUseCase'`

- [ ] **Step 3: Create EnsureHouseholdUseCase.ts**

Create `src/domain/households/EnsureHouseholdUseCase.ts`:

```typescript
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import type * as schema from '../../data/local/schema';
import { households } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';

export interface HouseholdSummary {
  id: string;
  name: string;
  paydayDay: number;
  userLevel: 1 | 2 | 3;
}

export class EnsureHouseholdUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly userId: string,
  ) {}

  async execute(): Promise<Result<HouseholdSummary>> {
    const [existing] = await this.db
      .select()
      .from(households)
      .where(eq(households.id, this.userId))
      .limit(1);

    if (existing) {
      return createSuccess({
        id: existing.id,
        name: existing.name,
        paydayDay: existing.paydayDay,
        userLevel: existing.userLevel as 1 | 2 | 3,
      });
    }

    const now = new Date().toISOString();
    const newHousehold = {
      id: this.userId,
      name: 'My Household',
      paydayDay: 25,
      userLevel: 1 as const,
      createdAt: now,
      updatedAt: now,
      isSynced: false as const,
    };

    await this.db.insert(households).values(newHousehold);
    await this.audit.log({
      householdId: this.userId,
      entityType: 'household',
      entityId: this.userId,
      action: 'create',
      previousValue: null,
      newValue: newHousehold as unknown as Record<string, unknown>,
    });

    return createSuccess({
      id: this.userId,
      name: 'My Household',
      paydayDay: 25,
      userLevel: 1,
    });
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/domain/households/EnsureHouseholdUseCase.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Wire EnsureHouseholdUseCase into App.tsx**

Replace `App.tsx` entirely:

```typescript
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';
import { useDatabaseMigrations } from './src/data/local/db';
import { useFonts } from './src/presentation/theme/useFonts';
import { appTheme } from './src/presentation/theme/theme';
import { RootNavigator } from './src/presentation/navigation/RootNavigator';
import { colours } from './src/presentation/theme/tokens';
import { supabase } from './src/data/remote/supabaseClient';
import { useAppStore } from './src/presentation/stores/appStore';
import { db } from './src/data/local/db';
import { AuditLogger } from './src/data/audit/AuditLogger';
import { EnsureHouseholdUseCase } from './src/domain/households/EnsureHouseholdUseCase';

const audit = new AuditLogger(db);

async function loadHousehold(
  userId: string,
  setHouseholdId: (id: string) => void,
  setPaydayDay: (day: number) => void,
): Promise<void> {
  const uc = new EnsureHouseholdUseCase(db, audit, userId);
  const result = await uc.execute();
  if (result.success) {
    setHouseholdId(result.data.id);
    setPaydayDay(result.data.paydayDay);
  }
}

export default function App(): React.JSX.Element {
  const { fontsLoaded, fontError } = useFonts();
  const { success: dbReady, error: dbError } = useDatabaseMigrations();
  const setSession = useAppStore((s) => s.setSession);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const clearHousehold = useAppStore((s) => s.clearHousehold);
  const [sessionRestored, setSessionRestored] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session ?? null;
      setSession(session);
      if (session) {
        await loadHousehold(session.user.id, setHouseholdId, setPaydayDay);
      }
      setSessionRestored(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session ?? null);
      if (session) {
        await loadHousehold(session.user.id, setHouseholdId, setPaydayDay);
      } else {
        clearHousehold();
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [setSession, setHouseholdId, setPaydayDay, clearHousehold]);

  if (fontError || dbError) {
    return (
      <View style={styles.center}>
        <Text>Error: {(fontError ?? dbError)?.message}</Text>
      </View>
    );
  }

  if (!fontsLoaded || !dbReady || !sessionRestored) {
    return <View style={styles.center} />;
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={appTheme}>
        <RootNavigator />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.surface },
});
```

- [ ] **Step 6: Update RootNavigator to gate on householdId**

Replace `src/presentation/navigation/RootNavigator.tsx`:

```typescript
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { useAppStore } from '../stores/appStore';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): React.JSX.Element {
  const session = useAppStore((s) => s.session);
  const householdId = useAppStore((s) => s.householdId);
  const isAuthenticated = Boolean(session && householdId);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Main" component={MainTabNavigator} />
        ) : (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add App.tsx src/domain/households/ src/presentation/navigation/RootNavigator.tsx
git commit -m "feat: auto-create household after login, gate navigation on householdId"
```

---

## Task 3: EnvelopeEntity Domain Types + Pure Functions

**Files:**
- Create: `src/domain/envelopes/EnvelopeEntity.ts`
- Create: `src/domain/envelopes/EnvelopeEntity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/envelopes/EnvelopeEntity.test.ts`:

```typescript
import {
  getRemainingCents,
  getPercentRemaining,
  isOverBudget,
} from './EnvelopeEntity';
import type { EnvelopeEntity } from './EnvelopeEntity';

const makeEnvelope = (allocated: number, spent: number): EnvelopeEntity => ({
  id: 'e1',
  householdId: 'hh1',
  name: 'Groceries',
  allocatedCents: allocated,
  spentCents: spent,
  envelopeType: 'spending',
  isSavingsLocked: false,
  isArchived: false,
  periodStart: '2026-03-25',
  createdAt: '2026-03-25T00:00:00.000Z',
  updatedAt: '2026-03-25T00:00:00.000Z',
});

describe('EnvelopeEntity pure functions', () => {
  describe('getRemainingCents', () => {
    it('returns allocated minus spent', () => {
      expect(getRemainingCents(makeEnvelope(200000, 75000))).toBe(125000);
    });

    it('returns negative when over budget', () => {
      expect(getRemainingCents(makeEnvelope(100000, 120000))).toBe(-20000);
    });
  });

  describe('getPercentRemaining', () => {
    it('returns 100 when nothing spent', () => {
      expect(getPercentRemaining(makeEnvelope(200000, 0))).toBe(100);
    });

    it('returns 50 when half spent', () => {
      expect(getPercentRemaining(makeEnvelope(200000, 100000))).toBe(50);
    });

    it('returns 0 when fully spent', () => {
      expect(getPercentRemaining(makeEnvelope(200000, 200000))).toBe(0);
    });

    it('returns 0 (not negative) when over budget', () => {
      expect(getPercentRemaining(makeEnvelope(100000, 120000))).toBe(0);
    });

    it('returns 100 when allocated is zero', () => {
      expect(getPercentRemaining(makeEnvelope(0, 0))).toBe(100);
    });
  });

  describe('isOverBudget', () => {
    it('returns false when under budget', () => {
      expect(isOverBudget(makeEnvelope(200000, 100000))).toBe(false);
    });

    it('returns true when over budget', () => {
      expect(isOverBudget(makeEnvelope(100000, 120000))).toBe(true);
    });

    it('returns false when exactly at budget', () => {
      expect(isOverBudget(makeEnvelope(100000, 100000))).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/domain/envelopes/EnvelopeEntity.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './EnvelopeEntity'`

- [ ] **Step 3: Create EnvelopeEntity.ts**

Create `src/domain/envelopes/EnvelopeEntity.ts`:

```typescript
export type EnvelopeType = 'spending' | 'savings' | 'emergency_fund' | 'baby_step' | 'utility';

export interface EnvelopeEntity {
  id: string;
  householdId: string;
  name: string;
  allocatedCents: number;
  spentCents: number;
  envelopeType: EnvelopeType;
  isSavingsLocked: boolean;
  isArchived: boolean;
  periodStart: string; // ISO date YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
}

export function getRemainingCents(envelope: EnvelopeEntity): number {
  return envelope.allocatedCents - envelope.spentCents;
}

export function getPercentRemaining(envelope: EnvelopeEntity): number {
  if (envelope.allocatedCents === 0) return 100;
  const pct = ((envelope.allocatedCents - envelope.spentCents) / envelope.allocatedCents) * 100;
  return Math.max(0, Math.round(pct));
}

export function isOverBudget(envelope: EnvelopeEntity): boolean {
  return envelope.spentCents > envelope.allocatedCents;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/domain/envelopes/EnvelopeEntity.test.ts --no-coverage
```

Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/domain/envelopes/EnvelopeEntity.ts src/domain/envelopes/EnvelopeEntity.test.ts
git commit -m "feat: EnvelopeEntity domain type and pure business functions"
```

---

## Task 4: CreateEnvelopeUseCase

**Files:**
- Create: `src/domain/envelopes/CreateEnvelopeUseCase.ts`
- Create: `src/domain/envelopes/CreateEnvelopeUseCase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/envelopes/CreateEnvelopeUseCase.test.ts`:

```typescript
jest.mock('expo-crypto', () => ({ randomUUID: () => 'new-env-uuid' }));

import { CreateEnvelopeUseCase } from './CreateEnvelopeUseCase';

const makeDb = () => ({
  insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
});
const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

const validInput = {
  householdId: 'hh-1',
  name: 'Groceries',
  allocatedCents: 300000,
  envelopeType: 'spending' as const,
  periodStart: '2026-03-25',
};

describe('CreateEnvelopeUseCase', () => {
  it('creates envelope and returns it', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const uc = new CreateEnvelopeUseCase(db as any, audit as any, validInput);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('new-env-uuid');
      expect(result.data.name).toBe('Groceries');
      expect(result.data.allocatedCents).toBe(300000);
      expect(result.data.spentCents).toBe(0);
    }
    expect(db.insert).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalled();
  });

  it('trims whitespace from name', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, {
      ...validInput,
      name: '  Groceries  ',
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Groceries');
  });

  it('returns failure when name is empty', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, {
      ...validInput,
      name: '   ',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns failure when allocatedCents is zero', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, {
      ...validInput,
      allocatedCents: 0,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('sets isSavingsLocked true for savings type', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as any, makeAudit() as any, {
      ...validInput,
      envelopeType: 'savings' as const,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/domain/envelopes/CreateEnvelopeUseCase.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './CreateEnvelopeUseCase'`

- [ ] **Step 3: Create CreateEnvelopeUseCase.ts**

Create `src/domain/envelopes/CreateEnvelopeUseCase.ts`:

```typescript
import { randomUUID } from 'expo-crypto';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { EnvelopeEntity, EnvelopeType } from './EnvelopeEntity';

interface CreateEnvelopeInput {
  householdId: string;
  name: string;
  allocatedCents: number;
  envelopeType: EnvelopeType;
  periodStart: string;
}

export class CreateEnvelopeUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateEnvelopeInput,
  ) {}

  async execute(): Promise<Result<EnvelopeEntity>> {
    const trimmedName = this.input.name.trim();
    if (!trimmedName) {
      return createFailure({ code: 'INVALID_NAME', message: 'Envelope name is required' });
    }
    if (this.input.allocatedCents <= 0) {
      return createFailure({ code: 'INVALID_AMOUNT', message: 'Budget amount must be greater than zero' });
    }

    const isSavingsLocked =
      this.input.envelopeType === 'savings' || this.input.envelopeType === 'emergency_fund';

    const now = new Date().toISOString();
    const id = randomUUID();

    const envelope: EnvelopeEntity = {
      id,
      householdId: this.input.householdId,
      name: trimmedName,
      allocatedCents: this.input.allocatedCents,
      spentCents: 0,
      envelopeType: this.input.envelopeType,
      isSavingsLocked,
      isArchived: false,
      periodStart: this.input.periodStart,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(envelopes).values({ ...envelope, isSynced: false });
    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'envelope',
      entityId: id,
      action: 'create',
      previousValue: null,
      newValue: envelope as unknown as Record<string, unknown>,
    });

    return createSuccess(envelope);
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/domain/envelopes/CreateEnvelopeUseCase.test.ts --no-coverage
```

Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/domain/envelopes/CreateEnvelopeUseCase.ts src/domain/envelopes/CreateEnvelopeUseCase.test.ts
git commit -m "feat: CreateEnvelopeUseCase with validation and audit logging"
```

---

## Task 5: UpdateEnvelopeUseCase + ArchiveEnvelopeUseCase

**Files:**
- Create: `src/domain/envelopes/UpdateEnvelopeUseCase.ts`
- Create: `src/domain/envelopes/UpdateEnvelopeUseCase.test.ts`
- Create: `src/domain/envelopes/ArchiveEnvelopeUseCase.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/domain/envelopes/UpdateEnvelopeUseCase.test.ts`:

```typescript
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

import { UpdateEnvelopeUseCase } from './UpdateEnvelopeUseCase';
import { ArchiveEnvelopeUseCase } from './ArchiveEnvelopeUseCase';
import type { EnvelopeEntity } from './EnvelopeEntity';

const makeDb = () => ({
  update: jest.fn().mockReturnValue({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
  }),
  select: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([]),
      }),
    }),
  }),
});
const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

const existing: EnvelopeEntity = {
  id: 'env-1',
  householdId: 'hh-1',
  name: 'Groceries',
  allocatedCents: 300000,
  spentCents: 50000,
  envelopeType: 'spending',
  isSavingsLocked: false,
  isArchived: false,
  periodStart: '2026-03-25',
  createdAt: '2026-03-25T00:00:00.000Z',
  updatedAt: '2026-03-25T00:00:00.000Z',
};

describe('UpdateEnvelopeUseCase', () => {
  it('updates name and amount', async () => {
    const db = makeDb();
    const uc = new UpdateEnvelopeUseCase(db as any, makeAudit() as any, existing, {
      name: 'Food',
      allocatedCents: 400000,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Food');
      expect(result.data.allocatedCents).toBe(400000);
    }
    expect(db.update).toHaveBeenCalled();
  });

  it('rejects empty name', async () => {
    const db = makeDb();
    const uc = new UpdateEnvelopeUseCase(db as any, makeAudit() as any, existing, {
      name: '',
      allocatedCents: 400000,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects zero amount', async () => {
    const db = makeDb();
    const uc = new UpdateEnvelopeUseCase(db as any, makeAudit() as any, existing, {
      name: 'Food',
      allocatedCents: 0,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });
});

describe('ArchiveEnvelopeUseCase', () => {
  it('sets isArchived to true', async () => {
    const db = makeDb();
    const uc = new ArchiveEnvelopeUseCase(db as any, makeAudit() as any, existing);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/domain/envelopes/UpdateEnvelopeUseCase.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './UpdateEnvelopeUseCase'`

- [ ] **Step 3: Create UpdateEnvelopeUseCase.ts**

Create `src/domain/envelopes/UpdateEnvelopeUseCase.ts`:

```typescript
import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { EnvelopeEntity } from './EnvelopeEntity';

interface UpdateInput {
  name: string;
  allocatedCents: number;
}

export class UpdateEnvelopeUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly current: EnvelopeEntity,
    private readonly input: UpdateInput,
  ) {}

  async execute(): Promise<Result<EnvelopeEntity>> {
    const trimmedName = this.input.name.trim();
    if (!trimmedName) {
      return createFailure({ code: 'INVALID_NAME', message: 'Envelope name is required' });
    }
    if (this.input.allocatedCents <= 0) {
      return createFailure({ code: 'INVALID_AMOUNT', message: 'Budget amount must be greater than zero' });
    }

    const now = new Date().toISOString();
    const updated: EnvelopeEntity = {
      ...this.current,
      name: trimmedName,
      allocatedCents: this.input.allocatedCents,
      updatedAt: now,
    };

    await this.db
      .update(envelopes)
      .set({ name: updated.name, allocatedCents: updated.allocatedCents, updatedAt: now, isSynced: false })
      .where(eq(envelopes.id, this.current.id));

    await this.audit.log({
      householdId: this.current.householdId,
      entityType: 'envelope',
      entityId: this.current.id,
      action: 'update',
      previousValue: this.current as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>,
    });

    return createSuccess(updated);
  }
}
```

- [ ] **Step 4: Create ArchiveEnvelopeUseCase.ts**

Create `src/domain/envelopes/ArchiveEnvelopeUseCase.ts`:

```typescript
import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';
import type { EnvelopeEntity } from './EnvelopeEntity';

export class ArchiveEnvelopeUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly envelope: EnvelopeEntity,
  ) {}

  async execute(): Promise<Result<void>> {
    const now = new Date().toISOString();
    await this.db
      .update(envelopes)
      .set({ isArchived: true, updatedAt: now, isSynced: false })
      .where(eq(envelopes.id, this.envelope.id));

    await this.audit.log({
      householdId: this.envelope.householdId,
      entityType: 'envelope',
      entityId: this.envelope.id,
      action: 'archive',
      previousValue: { isArchived: false },
      newValue: { isArchived: true },
    });

    return createSuccess(undefined);
  }
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
npx jest src/domain/envelopes/UpdateEnvelopeUseCase.test.ts --no-coverage
```

Expected: PASS — 4 tests

- [ ] **Step 6: Commit**

```bash
git add src/domain/envelopes/UpdateEnvelopeUseCase.ts src/domain/envelopes/UpdateEnvelopeUseCase.test.ts src/domain/envelopes/ArchiveEnvelopeUseCase.ts
git commit -m "feat: UpdateEnvelopeUseCase and ArchiveEnvelopeUseCase"
```

---

## Task 6: useEnvelopes Hook

**Files:**
- Create: `src/presentation/hooks/useEnvelopes.ts`

This hook queries SQLite for non-archived envelopes in the current period and returns `{ envelopes, loading, error, reload }`.

- [ ] **Step 1: Create useEnvelopes.ts**

Create `src/presentation/hooks/useEnvelopes.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { eq, and } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { envelopes as envelopesTable } from '../../data/local/schema';
import type { EnvelopeEntity } from '../../domain/envelopes/EnvelopeEntity';

export interface UseEnvelopesResult {
  envelopes: EnvelopeEntity[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useEnvelopes(householdId: string, periodStart: string): UseEnvelopesResult {
  const [envelopes, setEnvelopes] = useState<EnvelopeEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await db
        .select()
        .from(envelopesTable)
        .where(
          and(
            eq(envelopesTable.householdId, householdId),
            eq(envelopesTable.periodStart, periodStart),
            eq(envelopesTable.isArchived, false),
          ),
        );
      setEnvelopes(rows as EnvelopeEntity[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load envelopes');
    } finally {
      setLoading(false);
    }
  }, [householdId, periodStart]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { envelopes, loading, error, reload };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/presentation/hooks/useEnvelopes.ts
git commit -m "feat: useEnvelopes hook — reactive SQLite query for current period"
```

---

## Task 7: Navigation — Dashboard Stack + Tab Icons

**Files:**
- Create: `src/presentation/navigation/DashboardStackNavigator.tsx`
- Modify: `src/presentation/navigation/types.ts`
- Modify: `src/presentation/navigation/MainTabNavigator.tsx`

The Dashboard tab becomes a stack navigator so we can push the AddEditEnvelope screen. All tabs get MaterialCommunityIcons icons.

- [ ] **Step 1: Update types.ts**

Replace `src/presentation/navigation/types.ts`:

```typescript
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  OnboardingWizard: undefined;
};

export type DashboardStackParamList = {
  DashboardHome: undefined;
  AddEditEnvelope: { envelopeId?: string } | undefined;
};

export type MainTabParamList = {
  DashboardTab: undefined;
  Transactions: undefined;
  Meters: undefined;
  Snowball: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type LoginScreenProps = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export type DashboardScreenProps = CompositeScreenProps<
  NativeStackScreenProps<DashboardStackParamList, 'DashboardHome'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddEditEnvelopeScreenProps = NativeStackScreenProps<
  DashboardStackParamList,
  'AddEditEnvelope'
>;
```

- [ ] **Step 2: Create DashboardStackNavigator.tsx**

Create `src/presentation/navigation/DashboardStackNavigator.tsx`:

```typescript
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { AddEditEnvelopeScreen } from '../screens/envelopes/AddEditEnvelopeScreen';
import { colours } from '../theme/tokens';
import type { DashboardStackParamList } from './types';

const Stack = createNativeStackNavigator<DashboardStackParamList>();

export function DashboardStackNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="DashboardHome"
        component={DashboardScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddEditEnvelope"
        component={AddEditEnvelopeScreen}
        options={{
          title: 'Envelope',
          headerStyle: { backgroundColor: colours.surface },
          headerTintColor: colours.primary,
          headerShadowVisible: false,
        }}
      />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 3: Update MainTabNavigator.tsx with icons**

Replace `src/presentation/navigation/MainTabNavigator.tsx`:

```typescript
import React from 'react';
import { View, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { DashboardStackNavigator } from './DashboardStackNavigator';
import { colours } from '../theme/tokens';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

function PlaceholderScreen({ name }: { name: string }): React.JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>{name} — coming soon</Text>
    </View>
  );
}

function TabIcon({ name, color, size }: { name: string; color: string; size: number }) {
  return <MaterialCommunityIcons name={name} color={color} size={size} />;
}

export function MainTabNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colours.primary,
        tabBarInactiveTintColor: colours.onSurfaceVariant,
        tabBarStyle: { backgroundColor: colours.surface, borderTopColor: colours.outlineVariant },
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="wallet-outline" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Transactions"
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="swap-horizontal" color={color} size={size} />,
        }}
        children={() => <PlaceholderScreen name="Transactions" />}
      />
      <Tab.Screen
        name="Meters"
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="gauge" color={color} size={size} />,
        }}
        children={() => <PlaceholderScreen name="Meters" />}
      />
      <Tab.Screen
        name="Snowball"
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="snowflake" color={color} size={size} />,
        }}
        children={() => <PlaceholderScreen name="Snowball" />}
      />
      <Tab.Screen
        name="Settings"
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="cog-outline" color={color} size={size} />,
        }}
        children={() => <PlaceholderScreen name="Settings" />}
      />
    </Tab.Navigator>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (AddEditEnvelopeScreen doesn't exist yet — if it fails on that import, skip the DashboardStackNavigator creation for now and add it after Task 8)

- [ ] **Step 5: Commit**

```bash
git add src/presentation/navigation/types.ts src/presentation/navigation/DashboardStackNavigator.tsx src/presentation/navigation/MainTabNavigator.tsx
git commit -m "feat: Dashboard tab stack navigator and tab bar icons"
```

---

## Task 8: EnvelopeCard Component

**Files:**
- Create: `src/presentation/components/envelopes/EnvelopeCard.tsx`

- [ ] **Step 1: Create EnvelopeCard.tsx**

Create `src/presentation/components/envelopes/EnvelopeCard.tsx`:

```typescript
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Surface } from 'react-native-paper';
import { EnvelopeFillBar } from '../shared/EnvelopeFillBar';
import { CurrencyText } from '../shared/CurrencyText';
import { colours, spacing, radius } from '../../theme/tokens';
import {
  getRemainingCents,
  getPercentRemaining,
  isOverBudget,
} from '../../../domain/envelopes/EnvelopeEntity';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

interface Props {
  envelope: EnvelopeEntity;
  onPress: () => void;
}

export function EnvelopeCard({ envelope, onPress }: Props): React.JSX.Element {
  const remaining = getRemainingCents(envelope);
  const pct = getPercentRemaining(envelope);
  const over = isOverBudget(envelope);

  return (
    <Surface style={styles.surface} elevation={1}>
      <TouchableRipple onPress={onPress} style={styles.ripple} borderless>
        <View style={styles.content}>
          <View style={styles.row}>
            <Text variant="titleSmall" style={styles.name} numberOfLines={1}>
              {envelope.name}
            </Text>
            <CurrencyText
              amountCents={remaining}
              style={[styles.remaining, over ? styles.overBudget : styles.underBudget]}
            />
          </View>
          <Text variant="bodySmall" style={styles.meta}>
            of{' '}
            <CurrencyText
              amountCents={envelope.allocatedCents}
              style={styles.meta}
            />{' '}
            budgeted · {pct}% remaining
          </Text>
          <View style={styles.bar}>
            <EnvelopeFillBar percentRemaining={pct} height={6} />
          </View>
        </View>
      </TouchableRipple>
    </Surface>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    backgroundColor: colours.surface,
  },
  ripple: {
    borderRadius: radius.lg,
  },
  content: {
    padding: spacing.base,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  name: {
    flex: 1,
    color: colours.onSurface,
    marginRight: spacing.sm,
  },
  remaining: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  underBudget: {
    color: colours.onSurface,
  },
  overBudget: {
    color: colours.error,
  },
  meta: {
    color: colours.onSurfaceVariant,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  bar: {
    marginTop: spacing.xs,
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/presentation/components/envelopes/EnvelopeCard.tsx
git commit -m "feat: EnvelopeCard component with fill bar and over-budget highlight"
```

---

## Task 9: AddEditEnvelopeScreen

**Files:**
- Create: `src/presentation/screens/envelopes/AddEditEnvelopeScreen.tsx`

Shows a form for creating or editing an envelope. When `route.params.envelopeId` is provided, load that envelope and pre-fill the form. On save, runs `CreateEnvelopeUseCase` or `UpdateEnvelopeUseCase`, then navigates back.

- [ ] **Step 1: Create AddEditEnvelopeScreen.tsx**

Create `src/presentation/screens/envelopes/AddEditEnvelopeScreen.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, SegmentedButtons, Snackbar } from 'react-native-paper';
import { eq } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { envelopes as envelopesTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateEnvelopeUseCase } from '../../../domain/envelopes/CreateEnvelopeUseCase';
import { UpdateEnvelopeUseCase } from '../../../domain/envelopes/UpdateEnvelopeUseCase';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { AddEditEnvelopeScreenProps } from '../../navigation/types';
import type { EnvelopeEntity, EnvelopeType } from '../../../domain/envelopes/EnvelopeEntity';
import { format } from 'date-fns';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

function toCents(randStr: string): number {
  const n = parseFloat(randStr.replace(',', '.'));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

function toRandString(cents: number): string {
  if (cents === 0) return '';
  return (cents / 100).toFixed(2);
}

export const AddEditEnvelopeScreen: React.FC<AddEditEnvelopeScreenProps> = ({ route, navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);
  const envelopeId = route.params?.envelopeId;

  const [existing, setExisting] = useState<EnvelopeEntity | null>(null);
  const [name, setName] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [envelopeType, setEnvelopeType] = useState<EnvelopeType>('spending');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: envelopeId ? 'Edit Envelope' : 'Add Envelope' });
    if (envelopeId) {
      db.select()
        .from(envelopesTable)
        .where(eq(envelopesTable.id, envelopeId))
        .limit(1)
        .then(([row]) => {
          if (row) {
            setExisting(row as EnvelopeEntity);
            setName(row.name);
            setAmountStr(toRandString(row.allocatedCents));
            setEnvelopeType(row.envelopeType as EnvelopeType);
          }
        });
    }
  }, [envelopeId, navigation]);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    const allocatedCents = toCents(amountStr);
    const period = engine.getCurrentPeriod(paydayDay);
    const periodStart = format(period.startDate, 'yyyy-MM-dd');

    let result;
    if (existing) {
      const uc = new UpdateEnvelopeUseCase(db, audit, existing, { name, allocatedCents });
      result = await uc.execute();
    } else {
      const uc = new CreateEnvelopeUseCase(db, audit, { householdId, name, allocatedCents, envelopeType, periodStart });
      result = await uc.execute();
    }

    setLoading(false);
    if (result.success) {
      navigation.goBack();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <TextInput
          label="Envelope name"
          value={name}
          onChangeText={setName}
          mode="outlined"
          style={styles.input}
          disabled={loading}
          placeholder="e.g. Groceries"
        />

        <TextInput
          label="Monthly budget (R)"
          value={amountStr}
          onChangeText={setAmountStr}
          mode="outlined"
          style={styles.input}
          keyboardType="decimal-pad"
          disabled={loading}
          placeholder="0.00"
          left={<TextInput.Affix text="R" />}
        />

        <Text variant="labelLarge" style={styles.typeLabel}>
          Type
        </Text>
        <SegmentedButtons
          value={envelopeType}
          onValueChange={(v) => setEnvelopeType(v as EnvelopeType)}
          buttons={[
            { value: 'spending', label: 'Spending' },
            { value: 'savings', label: 'Savings' },
            { value: 'utility', label: 'Utility' },
          ]}
          style={styles.segmented}
        />

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          {existing ? 'Save Changes' : 'Add Envelope'}
        </Button>
      </ScrollView>

      <Snackbar
        visible={error !== null}
        onDismiss={() => setError(null)}
        duration={4000}
        action={{ label: 'OK', onPress: () => setError(null) }}
      >
        {error}
      </Snackbar>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.surface },
  container: { padding: spacing.base, gap: spacing.sm },
  input: { backgroundColor: colours.surface },
  typeLabel: { color: colours.onSurface, marginTop: spacing.sm },
  segmented: { marginTop: spacing.xs },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/presentation/screens/envelopes/AddEditEnvelopeScreen.tsx
git commit -m "feat: AddEditEnvelopeScreen — create and edit envelope form"
```

---

## Task 10: DashboardScreen — Real Data

**Files:**
- Modify: `src/presentation/screens/dashboard/DashboardScreen.tsx`

Replace the placeholder with: current period header, total allocated/spent/remaining summary cards, scrollable list of `EnvelopeCard` components, FAB to add envelope, and an empty state when no envelopes exist.

- [ ] **Step 1: Create the real DashboardScreen**

Replace `src/presentation/screens/dashboard/DashboardScreen.tsx` entirely:

```typescript
import React, { useCallback } from 'react';
import { View, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { Text, FAB, ActivityIndicator, Surface } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppStore } from '../../stores/appStore';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { EnvelopeCard } from '../../components/envelopes/EnvelopeCard';
import { CurrencyText } from '../../components/shared/CurrencyText';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { colours, spacing, radius } from '../../theme/tokens';
import { format } from 'date-fns';
import type { DashboardScreenProps } from '../../navigation/types';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

const engine = new BudgetPeriodEngine();

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);

  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');

  const { envelopes, loading, reload } = useEnvelopes(householdId, periodStart);

  // Reload whenever this screen comes into focus (e.g. after adding an envelope)
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const totalAllocated = envelopes.reduce((s, e) => s + e.allocatedCents, 0);
  const totalSpent = envelopes.reduce((s, e) => s + e.spentCents, 0);
  const totalRemaining = totalAllocated - totalSpent;

  const handleAddEnvelope = () => {
    navigation.navigate('AddEditEnvelope', {});
  };

  const handleEditEnvelope = (envelope: EnvelopeEntity) => {
    navigation.navigate('AddEditEnvelope', { envelopeId: envelope.id });
  };

  return (
    <View style={styles.flex}>
      {/* Period Header */}
      <Surface style={styles.header} elevation={0}>
        <Text variant="labelMedium" style={styles.periodLabel}>
          BUDGET PERIOD
        </Text>
        <Text variant="headlineSmall" style={styles.periodTitle}>
          {period.label}
        </Text>
      </Surface>

      {/* Summary Bar */}
      {envelopes.length > 0 && (
        <Surface style={styles.summary} elevation={1}>
          <View style={styles.summaryItem}>
            <Text variant="labelSmall" style={styles.summaryLabel}>ALLOCATED</Text>
            <CurrencyText amountCents={totalAllocated} style={styles.summaryValue} />
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text variant="labelSmall" style={styles.summaryLabel}>SPENT</Text>
            <CurrencyText amountCents={totalSpent} style={styles.summaryValue} />
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text variant="labelSmall" style={styles.summaryLabel}>REMAINING</Text>
            <CurrencyText
              amountCents={totalRemaining}
              style={[styles.summaryValue, totalRemaining < 0 ? styles.overBudget : null]}
            />
          </View>
        </Surface>
      )}

      {/* Envelope List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator animating color={colours.primary} />
        </View>
      ) : envelopes.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="wallet-outline" size={64} color={colours.outlineVariant} />
          <Text variant="titleMedium" style={styles.emptyTitle}>
            No envelopes yet
          </Text>
          <Text variant="bodyMedium" style={styles.emptyBody}>
            Tap + to create your first envelope
          </Text>
        </View>
      ) : (
        <FlatList
          data={envelopes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <EnvelopeCard envelope={item} onPress={() => handleEditEnvelope(item)} />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={reload}
              colors={[colours.primary]}
            />
          }
        />
      )}

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={handleAddEnvelope}
        color={colours.onPrimary}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
    backgroundColor: colours.surface,
  },
  periodLabel: {
    color: colours.onSurfaceVariant,
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  periodTitle: {
    color: colours.primary,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  summary: {
    flexDirection: 'row',
    marginHorizontal: spacing.base,
    marginTop: spacing.base,
    borderRadius: radius.lg,
    padding: spacing.base,
    backgroundColor: colours.primaryContainer,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryLabel: {
    color: colours.onPrimaryContainer,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  summaryValue: {
    color: colours.onPrimaryContainer,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: colours.outlineVariant,
    marginVertical: spacing.xs,
  },
  overBudget: { color: colours.error },
  list: {
    padding: spacing.base,
    paddingBottom: 100,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    color: colours.onSurface,
    marginTop: spacing.base,
  },
  emptyBody: {
    color: colours.onSurfaceVariant,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  fab: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.xl,
    backgroundColor: colours.primary,
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all existing tests PASS

- [ ] **Step 4: Verify app on emulator**

Ensure Metro is running:
```bash
npx expo start --dev-client --android --port 8085
```

Open the app → login → you should see:
1. Period header showing current budget period (e.g. "25 Mar – 24 Apr")
2. Empty state with wallet icon and "No envelopes yet"
3. FAB (+) button
4. Tap FAB → AddEditEnvelope screen opens
5. Enter name "Groceries", amount "3000", type "Spending" → tap "Add Envelope"
6. Returns to dashboard → Groceries envelope appears with R3 000.00 budget, 100% fill bar
7. Tap the envelope → Edit screen opens pre-filled

- [ ] **Step 5: Commit**

```bash
git add src/presentation/screens/dashboard/DashboardScreen.tsx
git commit -m "feat: DashboardScreen with real SQLite data, period header, summary, envelope list, FAB"
```

---

## Sprint 1 Deliverable Checklist

After completing all tasks, verify the following works end-to-end on the emulator:

- [ ] User opens app → login screen
- [ ] User logs in → dashboard appears immediately (no blank screen)
- [ ] Dashboard shows current budget period label
- [ ] Dashboard shows empty state with "No envelopes yet" + FAB
- [ ] Tap FAB → Add Envelope screen with name, amount, type fields
- [ ] Enter "Groceries", "3000.00", Spending → tap Add → returns to dashboard
- [ ] Groceries envelope card shows: name, R3 000.00, 100% fill bar
- [ ] Tap Groceries card → Edit screen opens pre-filled
- [ ] Change name to "Food & Groceries" → tap Save → card updates on dashboard
- [ ] All unit tests pass: `npx jest --no-coverage`
- [ ] TypeScript clean: `npx tsc --noEmit`
