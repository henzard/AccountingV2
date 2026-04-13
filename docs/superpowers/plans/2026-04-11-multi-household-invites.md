# Multi-Household & Invite System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can belong to multiple households, switch between them, create new ones, and invite family members via a 6-character code.

**Architecture:** `household_members` (already added in plan 1) is the source of truth for which households a user belongs to. An `invitations` table in Supabase holds short-lived codes. The app shows a `HouseholdPickerScreen` when the user has multiple households. Invite and join flows are accessed from the Settings screen.

**Prerequisites:** The Supabase Sync & Cloud Persistence plan must be fully implemented before starting this plan. The `household_members` table and `RestoreService` are assumed to exist.

**Tech Stack:** Supabase JS client v2, Drizzle ORM, React Navigation native stack, React Native Paper, expo-sharing.

---

## Supabase SQL (run manually in Supabase dashboard — do this first)

```sql
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can look up an invitation by code (to join)
CREATE POLICY "authenticated users can read invitations" ON invitations
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only household members can create invitations for their household
CREATE POLICY "members can create invitations" ON invitations
  FOR INSERT WITH CHECK (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );

-- Only the creator can update (mark as used)
CREATE POLICY "system can update invitations" ON invitations
  FOR UPDATE USING (auth.uid() = created_by OR auth.uid() = used_by);
```

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/domain/households/CreateHouseholdUseCase.ts` | Create | Create a new household + owner membership |
| `src/domain/households/CreateHouseholdUseCase.test.ts` | Create | Unit tests |
| `src/domain/households/CreateInviteUseCase.ts` | Create | Generate 6-char invite code in Supabase |
| `src/domain/households/CreateInviteUseCase.test.ts` | Create | Unit tests |
| `src/domain/households/AcceptInviteUseCase.ts` | Create | Validate code, join household, restore data |
| `src/domain/households/AcceptInviteUseCase.test.ts` | Create | Unit tests |
| `src/presentation/stores/appStore.ts` | Modify | Active household can be switched; availableHouseholds list |
| `src/presentation/screens/household/HouseholdPickerScreen.tsx` | Create | List households, create new, switch |
| `src/presentation/screens/household/CreateHouseholdScreen.tsx` | Create | Form: name + payday day |
| `src/presentation/screens/household/ShareInviteScreen.tsx` | Create | Shows invite code + share button |
| `src/presentation/screens/household/JoinHouseholdScreen.tsx` | Create | Enter invite code to join |
| `src/presentation/navigation/types.ts` | Modify | Add new screens to RootStackParamList |
| `src/presentation/navigation/RootNavigator.tsx` | Modify | Add household screens to root stack |
| `src/presentation/screens/settings/SettingsScreen.tsx` | Modify | Add household management rows |
| `App.tsx` | Modify | Pass availableHouseholds to store after restore; route to picker if >1 |

---

### Task 1: CreateHouseholdUseCase

**Files:**
- Create: `src/domain/households/CreateHouseholdUseCase.ts`
- Create: `src/domain/households/CreateHouseholdUseCase.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/domain/households/CreateHouseholdUseCase.test.ts
import { CreateHouseholdUseCase } from './CreateHouseholdUseCase';

describe('CreateHouseholdUseCase', () => {
  const makeDb = () => {
    const inserted: unknown[] = [];
    return {
      insert: jest.fn().mockReturnValue({ values: (row: unknown) => { inserted.push(row); return Promise.resolve(); } }),
      _inserted: inserted,
    };
  };
  const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

  it('returns INVALID_NAME when name is blank', async () => {
    const db = makeDb();
    const uc = new CreateHouseholdUseCase(db as any, makeAudit() as any, { userId: 'u1', name: '  ', paydayDay: 25 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
  });

  it('returns INVALID_PAYDAY when paydayDay is out of range', async () => {
    const db = makeDb();
    const uc = new CreateHouseholdUseCase(db as any, makeAudit() as any, { userId: 'u1', name: 'Home', paydayDay: 0 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('inserts household + membership rows on success', async () => {
    const db = makeDb();
    const uc = new CreateHouseholdUseCase(db as any, makeAudit() as any, { userId: 'u1', name: 'Home', paydayDay: 25 });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    // 4 inserts: household, household_members, pending_sync x2
    expect(db._inserted.length).toBe(4);
    const hh = db._inserted[0] as any;
    expect(hh.name).toBe('Home');
    expect(hh.paydayDay).toBe(25);
    expect(typeof hh.id).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest CreateHouseholdUseCase.test --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Implement CreateHouseholdUseCase**

```typescript
// src/domain/households/CreateHouseholdUseCase.ts
import { randomUUID } from 'expo-crypto';
import type { InferInsertModel } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { households, householdMembers } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { HouseholdSummary } from './EnsureHouseholdUseCase';

interface CreateHouseholdInput {
  userId: string;
  name: string;
  paydayDay: number;
}

export class CreateHouseholdUseCase {
  private readonly enqueuer: PendingSyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateHouseholdInput,
  ) {
    this.enqueuer = new PendingSyncEnqueuer(db);
  }

  async execute(): Promise<Result<HouseholdSummary>> {
    const name = this.input.name.trim();
    if (!name) {
      return createFailure({ code: 'INVALID_NAME', message: 'Household name is required' });
    }
    if (this.input.paydayDay < 1 || this.input.paydayDay > 28) {
      return createFailure({ code: 'INVALID_PAYDAY', message: 'Payday day must be between 1 and 28' });
    }

    const now = new Date().toISOString();
    const householdId = randomUUID();

    const newHousehold: InferInsertModel<typeof households> = {
      id: householdId,
      name,
      paydayDay: this.input.paydayDay,
      userLevel: 1,
      createdAt: now,
      updatedAt: now,
      isSynced: false,
    };
    await this.db.insert(households).values(newHousehold);

    const memberId = randomUUID();
    const memberRow: InferInsertModel<typeof householdMembers> = {
      id: memberId,
      householdId,
      userId: this.input.userId,
      role: 'owner',
      joinedAt: now,
    };
    await this.db.insert(householdMembers).values(memberRow);

    await this.audit.log({
      householdId,
      entityType: 'household',
      entityId: householdId,
      action: 'create',
      previousValue: null,
      newValue: { id: householdId, name, paydayDay: this.input.paydayDay },
    });

    await this.enqueuer.enqueue('households', householdId, 'INSERT');
    await this.enqueuer.enqueue('household_members', memberId, 'INSERT');

    return createSuccess({ id: householdId, name, paydayDay: this.input.paydayDay, userLevel: 1 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest CreateHouseholdUseCase.test --no-coverage
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/households/CreateHouseholdUseCase.ts src/domain/households/CreateHouseholdUseCase.test.ts
git commit -m "feat(household): add CreateHouseholdUseCase"
```

---

### Task 2: CreateInviteUseCase

**Files:**
- Create: `src/domain/households/CreateInviteUseCase.ts`
- Create: `src/domain/households/CreateInviteUseCase.test.ts`

This use case talks directly to Supabase — no local SQLite (invitations are ephemeral).

- [ ] **Step 1: Write the failing test**

```typescript
// src/domain/households/CreateInviteUseCase.test.ts
import { CreateInviteUseCase } from './CreateInviteUseCase';

describe('CreateInviteUseCase', () => {
  it('returns the 6-character code on success', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { code: 'ABC123' }, error: null }) }) }),
      }),
    } as any;
    const uc = new CreateInviteUseCase(supabase, { householdId: 'hh-1', createdByUserId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toHaveLength(6);
      expect(result.data.code).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it('returns INVITE_CREATE_FAILED when Supabase errors', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'fail' } }) }) }),
      }),
    } as any;
    const uc = new CreateInviteUseCase(supabase, { householdId: 'hh-1', createdByUserId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_CREATE_FAILED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest CreateInviteUseCase.test --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Implement CreateInviteUseCase**

```typescript
// src/domain/households/CreateInviteUseCase.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

interface CreateInviteInput {
  householdId: string;
  createdByUserId: string;
}

export interface InviteResult {
  code: string;
  expiresAt: string;
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export class CreateInviteUseCase {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly input: CreateInviteInput,
  ) {}

  async execute(): Promise<Result<InviteResult>> {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48 hours

    const { data, error } = await this.supabase
      .from('invitations')
      .insert({
        code,
        household_id: this.input.householdId,
        created_by: this.input.createdByUserId,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error || !data) {
      return createFailure({ code: 'INVITE_CREATE_FAILED', message: error?.message ?? 'Failed to create invite' });
    }

    return createSuccess({ code: data.code as string, expiresAt });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest CreateInviteUseCase.test --no-coverage
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/households/CreateInviteUseCase.ts src/domain/households/CreateInviteUseCase.test.ts
git commit -m "feat(household): add CreateInviteUseCase — generates 6-char code in Supabase"
```

---

### Task 3: AcceptInviteUseCase

**Files:**
- Create: `src/domain/households/AcceptInviteUseCase.ts`
- Create: `src/domain/households/AcceptInviteUseCase.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/domain/households/AcceptInviteUseCase.test.ts
import { AcceptInviteUseCase } from './AcceptInviteUseCase';

const makeSupabase = ({
  inviteData = null as unknown,
  inviteError = null as unknown,
  insertError = null as unknown,
} = {}) => ({
  from: jest.fn().mockImplementation((table: string) => {
    if (table === 'invitations') {
      return {
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: inviteData, error: inviteError }) }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'household_members') {
      return {
        insert: () => Promise.resolve({ error: insertError }),
      };
    }
    return {};
  }),
});

describe('AcceptInviteUseCase', () => {
  it('returns INVITE_NOT_FOUND when code does not exist', async () => {
    const supabase = makeSupabase({ inviteData: null, inviteError: { message: 'not found' } });
    const db = {} as any;
    const restoreSvc = {} as any;
    const uc = new AcceptInviteUseCase(supabase as any, db, restoreSvc, { code: 'ZZZ999', userId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_NOT_FOUND');
  });

  it('returns INVITE_EXPIRED when expiry is in the past', async () => {
    const supabase = makeSupabase({
      inviteData: {
        household_id: 'hh-1',
        expires_at: new Date(Date.now() - 1000).toISOString(),
        used_by: null,
      },
    });
    const db = {} as any;
    const restoreSvc = {} as any;
    const uc = new AcceptInviteUseCase(supabase as any, db, restoreSvc, { code: 'ABC123', userId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_EXPIRED');
  });

  it('returns INVITE_ALREADY_USED when used_by is set', async () => {
    const supabase = makeSupabase({
      inviteData: {
        household_id: 'hh-1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        used_by: 'someone-else',
      },
    });
    const db = {} as any;
    const restoreSvc = {} as any;
    const uc = new AcceptInviteUseCase(supabase as any, db, restoreSvc, { code: 'ABC123', userId: 'u-1' });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVITE_ALREADY_USED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest AcceptInviteUseCase.test --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Implement AcceptInviteUseCase**

```typescript
// src/domain/households/AcceptInviteUseCase.ts
import { randomUUID } from 'expo-crypto';
import type { InferInsertModel } from 'drizzle-orm';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { householdMembers } from '../../data/local/schema';
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
import type { RestoreService, HouseholdSummary } from '../../data/sync/RestoreService';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

interface AcceptInviteInput {
  code: string;
  userId: string;
}

export class AcceptInviteUseCase {
  private readonly enqueuer: PendingSyncEnqueuer;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly restoreService: RestoreService,
    private readonly input: AcceptInviteInput,
  ) {
    this.enqueuer = new PendingSyncEnqueuer(db);
  }

  async execute(): Promise<Result<HouseholdSummary>> {
    // 1. Fetch the invitation
    const { data: invite, error: inviteError } = await this.supabase
      .from('invitations')
      .select('household_id, expires_at, used_by')
      .eq('code', this.input.code.toUpperCase())
      .single();

    if (inviteError || !invite) {
      return createFailure({ code: 'INVITE_NOT_FOUND', message: 'Invite code not found' });
    }

    if (new Date(invite.expires_at as string) < new Date()) {
      return createFailure({ code: 'INVITE_EXPIRED', message: 'This invite code has expired' });
    }

    if (invite.used_by) {
      return createFailure({ code: 'INVITE_ALREADY_USED', message: 'This invite code has already been used' });
    }

    const householdId = invite.household_id as string;

    // 2. Add user to household_members in Supabase
    const memberId = randomUUID();
    const now = new Date().toISOString();

    const { error: insertError } = await this.supabase
      .from('household_members')
      .insert({
        id: memberId,
        household_id: householdId,
        user_id: this.input.userId,
        role: 'member',
        joined_at: now,
      });

    if (insertError) {
      return createFailure({ code: 'JOIN_FAILED', message: insertError.message });
    }

    // 3. Mark invitation as used
    await this.supabase
      .from('invitations')
      .update({ used_by: this.input.userId })
      .eq('code', this.input.code.toUpperCase());

    // 4. Insert member row locally
    const localMember: InferInsertModel<typeof householdMembers> = {
      id: memberId,
      householdId,
      userId: this.input.userId,
      role: 'member',
      joinedAt: now,
    };
    await this.db.insert(householdMembers).values(localMember);

    // 5. Restore the household data locally
    const summary = await this.restoreService.restoreHousehold(householdId, 'member', this.input.userId);
    if (!summary) {
      return createFailure({ code: 'RESTORE_FAILED', message: 'Joined but failed to restore household data' });
    }

    return createSuccess(summary);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest AcceptInviteUseCase.test --no-coverage
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/households/AcceptInviteUseCase.ts src/domain/households/AcceptInviteUseCase.test.ts
git commit -m "feat(household): add AcceptInviteUseCase — validates code and joins household"
```

---

### Task 4: Navigation updates

**Files:**
- Modify: `src/presentation/navigation/types.ts`
- Modify: `src/presentation/navigation/RootNavigator.tsx`

- [ ] **Step 1: Add household screens to RootStackParamList**

In `src/presentation/navigation/types.ts`, add to `RootStackParamList`:
```typescript
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  HouseholdPicker: undefined;
  CreateHousehold: undefined;
  ShareInvite: { householdId: string; householdName: string };
  JoinHousehold: undefined;
};
```

Add screen prop types:
```typescript
export type HouseholdPickerScreenProps = NativeStackScreenProps<RootStackParamList, 'HouseholdPicker'>;
export type CreateHouseholdScreenProps = NativeStackScreenProps<RootStackParamList, 'CreateHousehold'>;
export type ShareInviteScreenProps = NativeStackScreenProps<RootStackParamList, 'ShareInvite'>;
export type JoinHouseholdScreenProps = NativeStackScreenProps<RootStackParamList, 'JoinHousehold'>;
```

- [ ] **Step 2: Add screens to RootNavigator**

In `src/presentation/navigation/RootNavigator.tsx`, import the four new screens and add them inside the `Stack.Navigator`:

```typescript
import { HouseholdPickerScreen } from '../screens/household/HouseholdPickerScreen';
import { CreateHouseholdScreen } from '../screens/household/CreateHouseholdScreen';
import { ShareInviteScreen } from '../screens/household/ShareInviteScreen';
import { JoinHouseholdScreen } from '../screens/household/JoinHouseholdScreen';

// Inside Stack.Navigator (always rendered, guarded by navigation logic):
<Stack.Screen name="HouseholdPicker" component={HouseholdPickerScreen} options={{ title: 'Your Households' }} />
<Stack.Screen name="CreateHousehold" component={CreateHouseholdScreen} options={{ title: 'New Household' }} />
<Stack.Screen name="ShareInvite" component={ShareInviteScreen} options={{ title: 'Invite Member' }} />
<Stack.Screen name="JoinHousehold" component={JoinHouseholdScreen} options={{ title: 'Join a Household' }} />
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: errors about missing screen components — that's expected until Task 5.

- [ ] **Step 4: Commit (partial — will be amended by Task 5)**

```bash
git add src/presentation/navigation/types.ts src/presentation/navigation/RootNavigator.tsx
git commit -m "feat(household): add household nav types and root stack screens"
```

---

### Task 5: HouseholdPickerScreen

**Files:**
- Create: `src/presentation/screens/household/HouseholdPickerScreen.tsx`

- [ ] **Step 1: Implement HouseholdPickerScreen**

```typescript
// src/presentation/screens/household/HouseholdPickerScreen.tsx
import React from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text, Surface, TouchableRipple, FAB, Button } from 'react-native-paper';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing, radius } from '../../theme/tokens';
import type { HouseholdPickerScreenProps } from '../../navigation/types';
import type { HouseholdSummary } from '../../../domain/households/EnsureHouseholdUseCase';

export const HouseholdPickerScreen: React.FC<HouseholdPickerScreenProps> = ({ navigation }) => {
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);

  const handleSelect = (hh: HouseholdSummary): void => {
    setHouseholdId(hh.id);
    setPaydayDay(hh.paydayDay);
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  const renderItem = ({ item }: { item: HouseholdSummary }): React.JSX.Element => (
    <TouchableRipple onPress={() => handleSelect(item)} rippleColor={colours.primaryContainer}>
      <Surface style={styles.row} elevation={1}>
        <View style={styles.rowLeft}>
          <Text variant="titleSmall" style={styles.name}>{item.name}</Text>
          <Text variant="bodySmall" style={styles.sub}>Payday: day {item.paydayDay}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colours.onSurfaceVariant} />
      </Surface>
    </TouchableRipple>
  );

  return (
    <View style={styles.flex}>
      <Surface style={styles.header} elevation={0}>
        <Text variant="labelMedium" style={styles.headerLabel}>YOUR HOUSEHOLDS</Text>
        <Text variant="bodySmall" style={styles.headerSub}>Select a household to manage</Text>
      </Surface>

      <FlatList
        data={availableHouseholds}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          <View style={styles.footer}>
            <Button
              mode="outlined"
              icon="plus"
              onPress={() => navigation.navigate('CreateHousehold')}
              style={styles.footerBtn}
            >
              Create New Household
            </Button>
            <Button
              mode="text"
              icon="account-plus-outline"
              onPress={() => navigation.navigate('JoinHousehold')}
              style={styles.footerBtn}
            >
              Join with Invite Code
            </Button>
          </View>
        }
      />

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => navigation.navigate('CreateHousehold')}
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
  headerLabel: { color: colours.onSurfaceVariant, letterSpacing: 1.5 },
  headerSub: { color: colours.onSurfaceVariant, marginTop: spacing.xs },
  list: { paddingBottom: 100 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
    backgroundColor: colours.surface,
  },
  rowLeft: { flex: 1 },
  name: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  sub: { color: colours.onSurfaceVariant, marginTop: 2 },
  footer: { padding: spacing.base, gap: spacing.sm },
  footerBtn: { marginTop: spacing.xs },
  fab: { position: 'absolute', right: spacing.base, bottom: spacing.xl, backgroundColor: colours.primary },
});
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/presentation/screens/household/HouseholdPickerScreen.tsx
git commit -m "feat(household): add HouseholdPickerScreen"
```

---

### Task 6: CreateHouseholdScreen

**Files:**
- Create: `src/presentation/screens/household/CreateHouseholdScreen.tsx`

- [ ] **Step 1: Implement CreateHouseholdScreen**

```typescript
// src/presentation/screens/household/CreateHouseholdScreen.tsx
import React, { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button, Snackbar } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateHouseholdUseCase } from '../../../domain/households/CreateHouseholdUseCase';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { CreateHouseholdScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);

export const CreateHouseholdScreen: React.FC<CreateHouseholdScreenProps> = ({ navigation }) => {
  const session = useAppStore((s) => s.session);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const setAvailableHouseholds = useAppStore((s) => s.setAvailableHouseholds);
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);

  const [name, setName] = useState('');
  const [paydayDay, setPaydayDayInput] = useState('25');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    if (!session) return;
    const day = parseInt(paydayDay, 10);
    setLoading(true);
    setError(null);

    const uc = new CreateHouseholdUseCase(db, audit, {
      userId: session.user.id,
      name,
      paydayDay: day,
    });
    const result = await uc.execute();
    setLoading(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }

    setHouseholdId(result.data.id);
    setPaydayDay(result.data.paydayDay);
    setAvailableHouseholds([...availableHouseholds, result.data]);
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="bodyMedium" style={styles.description}>
          Give your household a name and set your payday. You can invite members after creating it.
        </Text>

        <TextInput
          label="Household name"
          value={name}
          onChangeText={setName}
          mode="outlined"
          style={styles.input}
          disabled={loading}
        />

        <TextInput
          label="Payday day of month (1–28)"
          value={paydayDay}
          onChangeText={setPaydayDayInput}
          keyboardType="numeric"
          mode="outlined"
          style={styles.input}
          disabled={loading}
        />

        <Button
          mode="contained"
          onPress={handleCreate}
          loading={loading}
          disabled={loading}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          Create Household
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
  container: { flexGrow: 1, padding: spacing.xl, gap: spacing.base },
  description: { color: colours.onSurfaceVariant, marginBottom: spacing.base },
  input: { backgroundColor: colours.surface },
  button: { marginTop: spacing.sm },
  buttonContent: { paddingVertical: spacing.xs },
});
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/presentation/screens/household/CreateHouseholdScreen.tsx
git commit -m "feat(household): add CreateHouseholdScreen"
```

---

### Task 7: ShareInviteScreen

**Files:**
- Create: `src/presentation/screens/household/ShareInviteScreen.tsx`

- [ ] **Step 1: Implement ShareInviteScreen**

```typescript
// src/presentation/screens/household/ShareInviteScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Share } from 'react-native';
import { Text, Surface, Button, ActivityIndicator } from 'react-native-paper';
import { supabase } from '../../../data/remote/supabaseClient';
import { CreateInviteUseCase } from '../../../domain/households/CreateInviteUseCase';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing, radius } from '../../theme/tokens';
import type { ShareInviteScreenProps } from '../../navigation/types';

export const ShareInviteScreen: React.FC<ShareInviteScreenProps> = ({ route }) => {
  const { householdName } = route.params;
  const session = useAppStore((s) => s.session);
  const householdId = useAppStore((s) => s.householdId)!;

  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const uc = new CreateInviteUseCase(supabase, {
      householdId,
      createdByUserId: session.user.id,
    });
    uc.execute().then((result) => {
      setLoading(false);
      if (result.success) {
        setCode(result.data.code);
        setExpiresAt(result.data.expiresAt);
      } else {
        setError(result.error.message);
      }
    });
  }, [householdId, session]);

  const handleShare = async (): Promise<void> => {
    if (!code) return;
    await Share.share({
      message: `Join "${householdName}" on AccountingV2!\n\nUse invite code: ${code}\n\nExpires in 48 hours.`,
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator animating color={colours.primary} />
      </View>
    );
  }

  if (error || !code) {
    return (
      <View style={styles.center}>
        <Text variant="bodyMedium" style={styles.errorText}>{error ?? 'Failed to generate code'}</Text>
      </View>
    );
  }

  const expiryDate = expiresAt ? new Date(expiresAt).toLocaleDateString('en-ZA') : '';

  return (
    <View style={styles.flex}>
      <Surface style={styles.card} elevation={1}>
        <Text variant="labelMedium" style={styles.label}>INVITE CODE</Text>
        <Text variant="displaySmall" style={styles.code}>{code}</Text>
        <Text variant="bodySmall" style={styles.expiry}>Expires {expiryDate} · Single use</Text>
      </Surface>

      <Text variant="bodyMedium" style={styles.instructions}>
        Share this code with the person you want to invite. They can enter it in Settings → Join a Household.
      </Text>

      <Button
        mode="contained"
        icon="share-variant"
        onPress={handleShare}
        style={styles.shareBtn}
        contentStyle={styles.shareBtnContent}
      >
        Share Code
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background, padding: spacing.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    alignItems: 'center',
    borderRadius: radius.xl,
    padding: spacing.xl,
    backgroundColor: colours.primaryContainer,
    marginTop: spacing.xl,
    marginBottom: spacing.base,
  },
  label: { color: colours.onPrimaryContainer, letterSpacing: 1.5, marginBottom: spacing.sm },
  code: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 8 },
  expiry: { color: colours.onPrimaryContainer, marginTop: spacing.sm },
  instructions: { color: colours.onSurfaceVariant, textAlign: 'center', marginHorizontal: spacing.base },
  errorText: { color: colours.error, textAlign: 'center' },
  shareBtn: { marginTop: spacing.xl, backgroundColor: colours.primary },
  shareBtnContent: { paddingVertical: spacing.xs },
});
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/presentation/screens/household/ShareInviteScreen.tsx
git commit -m "feat(household): add ShareInviteScreen with 48h invite code"
```

---

### Task 8: JoinHouseholdScreen

**Files:**
- Create: `src/presentation/screens/household/JoinHouseholdScreen.tsx`

- [ ] **Step 1: Implement JoinHouseholdScreen**

```typescript
// src/presentation/screens/household/JoinHouseholdScreen.tsx
import React, { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, Snackbar } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { supabase } from '../../../data/remote/supabaseClient';
import { AcceptInviteUseCase } from '../../../domain/households/AcceptInviteUseCase';
import { RestoreService } from '../../../data/sync/RestoreService';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { JoinHouseholdScreenProps } from '../../navigation/types';

const restoreService = new RestoreService(db, supabase);

export const JoinHouseholdScreen: React.FC<JoinHouseholdScreenProps> = ({ navigation }) => {
  const session = useAppStore((s) => s.session);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const setAvailableHouseholds = useAppStore((s) => s.setAvailableHouseholds);
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async (): Promise<void> => {
    if (!session) return;
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode.length !== 6) {
      setError('Please enter a 6-character invite code');
      return;
    }

    setLoading(true);
    setError(null);

    const uc = new AcceptInviteUseCase(supabase, db, restoreService, {
      code: trimmedCode,
      userId: session.user.id,
    });
    const result = await uc.execute();
    setLoading(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }

    // Switch to the newly joined household
    setHouseholdId(result.data.id);
    setPaydayDay(result.data.paydayDay);
    setAvailableHouseholds([...availableHouseholds, result.data]);
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.container}>
        <Text variant="bodyMedium" style={styles.description}>
          Enter the 6-character code shared by your household member.
        </Text>

        <TextInput
          label="Invite code"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          mode="outlined"
          style={styles.input}
          disabled={loading}
        />

        <Button
          mode="contained"
          onPress={handleJoin}
          loading={loading}
          disabled={loading || code.trim().length !== 6}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          Join Household
        </Button>
      </View>

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
  container: { flexGrow: 1, padding: spacing.xl, gap: spacing.base },
  description: { color: colours.onSurfaceVariant, marginBottom: spacing.base },
  input: { backgroundColor: colours.surface },
  button: { marginTop: spacing.sm },
  buttonContent: { paddingVertical: spacing.xs },
});
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/presentation/screens/household/JoinHouseholdScreen.tsx
git commit -m "feat(household): add JoinHouseholdScreen — accept 6-char invite code"
```

---

### Task 9: Settings screen household management + App.tsx routing

**Files:**
- Modify: `src/presentation/screens/settings/SettingsScreen.tsx`
- Modify: `App.tsx`

- [ ] **Step 1: Update SettingsScreen with household management rows**

In `src/presentation/screens/settings/SettingsScreen.tsx`, import `useNavigation` and add a "Household" section:

```typescript
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

// Inside component:
const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
const householdId = useAppStore((s) => s.householdId);
const availableHouseholds = useAppStore((s) => s.availableHouseholds);
const currentHousehold = availableHouseholds.find((h) => h.id === householdId);

// Add this section above the notifications section:
<List.Section>
  <List.Subheader style={styles.subheader}>Household</List.Subheader>
  <Surface style={styles.section} elevation={0}>
    <List.Item
      title={currentHousehold?.name ?? 'My Household'}
      description="Active household"
      left={(props) => <List.Icon {...props} icon="home-outline" />}
    />
    <Divider />
    <List.Item
      title="Invite Member"
      description="Share an invite code"
      left={(props) => <List.Icon {...props} icon="account-plus-outline" />}
      right={(props) => <List.Icon {...props} icon="chevron-right" />}
      onPress={() => navigation.navigate('ShareInvite', {
        householdId: householdId!,
        householdName: currentHousehold?.name ?? 'My Household',
      })}
    />
    <Divider />
    <List.Item
      title="Join a Household"
      description="Enter an invite code"
      left={(props) => <List.Icon {...props} icon="account-multiple-plus-outline" />}
      right={(props) => <List.Icon {...props} icon="chevron-right" />}
      onPress={() => navigation.navigate('JoinHousehold')}
    />
    {availableHouseholds.length > 1 && (
      <>
        <Divider />
        <List.Item
          title="Switch Household"
          description={`${availableHouseholds.length} households available`}
          left={(props) => <List.Icon {...props} icon="swap-horizontal" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => navigation.navigate('HouseholdPicker')}
        />
      </>
    )}
  </Surface>
</List.Section>
```

Also add `Divider` to the imports from `react-native-paper`.

- [ ] **Step 2: Update App.tsx to populate availableHouseholds after restore**

In `App.tsx`, update `initSession` to call `setAvailableHouseholds` with the restored list:

```typescript
const setAvailableHouseholds = useAppStore((s) => s.setAvailableHouseholds);

// In initSession:
try {
  const summaries = await restoreService.restore(userId);
  if (summaries.length > 0) {
    setAvailableHouseholds(summaries);
  }
} catch {
  // offline — continue with local data
}
```

- [ ] **Step 3: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: all tests pass

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Lint check**

```bash
npx eslint src/ --ext .ts,.tsx --max-warnings 0
```

- [ ] **Step 6: Commit**

```bash
git add src/presentation/screens/settings/SettingsScreen.tsx App.tsx
git commit -m "feat(household): settings household section + App.tsx populates availableHouseholds"
```

---

### Task 10: Final integration test + commit

- [ ] **Step 1: Full test run**

```bash
npx jest --no-coverage
```
Expected: all tests pass.

- [ ] **Step 2: Build on emulator**

```bash
npx expo run:android
```

- [ ] **Step 3: Manual test — invite flow**
  - Log in as User A
  - Go to Settings → Invite Member → note the 6-character code
  - Log in as User B on a second device (or second account in the emulator)
  - Go to Settings → Join a Household → enter the code
  - Confirm: User B is now in User A's household and sees the same data

- [ ] **Step 4: Manual test — multi-household**
  - As User A: Settings → Create New Household → name it "Work Budget"
  - Confirm: switch household appears in Settings
  - Switch → new household shows empty dashboard

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(sprint-4): multi-household + invite system — family can share one household"
```
