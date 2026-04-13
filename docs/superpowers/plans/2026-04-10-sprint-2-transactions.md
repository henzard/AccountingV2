# Sprint 2: Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to record spending against envelopes and view transaction history, with envelope `spentCents` kept in sync so the dashboard always reflects reality.

**Architecture:** Transactions are child records of envelopes. Creating a transaction atomically increments `envelope.spentCents`; deleting decrements it. The Transactions tab replaces its placeholder with a real stack navigator containing a list screen and an add-transaction screen.

**Tech Stack:** Drizzle ORM (SQLite), Zustand (appStore), React Navigation (native stack inside bottom tab), react-native-paper (UI)

---

## File Structure

**New files:**
- `src/domain/transactions/TransactionEntity.ts` — domain type + pure functions
- `src/domain/transactions/CreateTransactionUseCase.ts` — insert transaction + increment spentCents
- `src/domain/transactions/DeleteTransactionUseCase.ts` — delete transaction + decrement spentCents
- `src/presentation/hooks/useTransactions.ts` — SQLite query hook
- `src/presentation/navigation/TransactionsStackNavigator.tsx` — stack for transactions tab
- `src/presentation/screens/transactions/TransactionListScreen.tsx` — grouped list + delete
- `src/presentation/screens/transactions/AddTransactionScreen.tsx` — add form with envelope picker

**Modified files:**
- `src/presentation/navigation/types.ts` — add `TransactionsStackParamList`, screen props
- `src/presentation/navigation/MainTabNavigator.tsx` — wire `TransactionsStackNavigator` in place of placeholder

---

### Task 1: TransactionEntity domain type

**Files:**
- Create: `src/domain/transactions/TransactionEntity.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/transactions/__tests__/TransactionEntity.test.ts`:

```typescript
import {
  TransactionEntity,
  getTransactionDisplayDate,
  formatTransactionAmount,
} from '../TransactionEntity';

const base: TransactionEntity = {
  id: 't1',
  householdId: 'h1',
  envelopeId: 'e1',
  amountCents: 2500,
  payee: 'Checkers',
  description: null,
  transactionDate: '2026-04-10',
  isBusinessExpense: false,
  spendingTriggerNote: null,
  createdAt: '2026-04-10T10:00:00.000Z',
  updatedAt: '2026-04-10T10:00:00.000Z',
};

describe('TransactionEntity', () => {
  it('getTransactionDisplayDate returns formatted date', () => {
    expect(getTransactionDisplayDate(base)).toBe('10 Apr 2026');
  });

  it('formatTransactionAmount returns positive cents as-is', () => {
    expect(formatTransactionAmount(base)).toBe(2500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/transactions/__tests__/TransactionEntity.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/transactions/TransactionEntity.ts`:

```typescript
import { format, parseISO } from 'date-fns';

export interface TransactionEntity {
  id: string;
  householdId: string;
  envelopeId: string;
  amountCents: number;
  payee: string | null;
  description: string | null;
  transactionDate: string; // ISO date YYYY-MM-DD
  isBusinessExpense: boolean;
  spendingTriggerNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getTransactionDisplayDate(tx: TransactionEntity): string {
  return format(parseISO(tx.transactionDate), 'd MMM yyyy');
}

export function formatTransactionAmount(tx: TransactionEntity): number {
  return tx.amountCents;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/transactions/__tests__/TransactionEntity.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/transactions/TransactionEntity.ts src/domain/transactions/__tests__/TransactionEntity.test.ts
git commit -m "feat(domain): add TransactionEntity type and pure functions"
```

---

### Task 2: CreateTransactionUseCase

**Files:**
- Create: `src/domain/transactions/CreateTransactionUseCase.ts`
- Test: `src/domain/transactions/__tests__/CreateTransactionUseCase.test.ts`

This use case inserts a transaction row AND increments `envelope.spentCents` in the same synchronous SQLite session. Drizzle's `sql` template literal handles the increment safely without a read-modify-write race.

- [ ] **Step 1: Write the failing test**

Create `src/domain/transactions/__tests__/CreateTransactionUseCase.test.ts`:

```typescript
import { CreateTransactionUseCase } from '../CreateTransactionUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

const mockInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
const mockUpdate = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
});
const mockDb = { insert: mockInsert, update: mockUpdate } as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

const input = {
  householdId: 'h1',
  envelopeId: 'e1',
  amountCents: 5000,
  payee: 'Pick n Pay',
  description: null,
  transactionDate: '2026-04-10',
};

describe('CreateTransactionUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns failure when amountCents is 0', async () => {
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, { ...input, amountCents: 0 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('returns failure when amountCents is negative', async () => {
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, { ...input, amountCents: -100 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('inserts transaction and updates spentCents on success', async () => {
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
  });

  it('returns transaction entity with correct id and fields', async () => {
    const uc = new CreateTransactionUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('uuid-1');
      expect(result.data.amountCents).toBe(5000);
      expect(result.data.envelopeId).toBe('e1');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/transactions/__tests__/CreateTransactionUseCase.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/transactions/CreateTransactionUseCase.ts`:

```typescript
import { randomUUID } from 'expo-crypto';
import { sql } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { transactions, envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { TransactionEntity } from './TransactionEntity';

interface CreateTransactionInput {
  householdId: string;
  envelopeId: string;
  amountCents: number;
  payee: string | null;
  description: string | null;
  transactionDate: string; // YYYY-MM-DD
}

export class CreateTransactionUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateTransactionInput,
  ) {}

  async execute(): Promise<Result<TransactionEntity>> {
    if (this.input.amountCents <= 0) {
      return createFailure({ code: 'INVALID_AMOUNT', message: 'Amount must be greater than zero' });
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    const tx: TransactionEntity = {
      id,
      householdId: this.input.householdId,
      envelopeId: this.input.envelopeId,
      amountCents: this.input.amountCents,
      payee: this.input.payee,
      description: this.input.description,
      transactionDate: this.input.transactionDate,
      isBusinessExpense: false,
      spendingTriggerNote: null,
      createdAt: now,
      updatedAt: now,
    };

    const row: InferInsertModel<typeof transactions> = { ...tx, isSynced: false };
    await this.db.insert(transactions).values(row);

    // Atomically increment envelope spentCents without a read-modify-write race
    await this.db
      .update(envelopes)
      .set({ spentCents: sql`${envelopes.spentCents} + ${this.input.amountCents}`, updatedAt: now })
      .where(sql`${envelopes.id} = ${this.input.envelopeId}`);

    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'transaction',
      entityId: id,
      action: 'create',
      previousValue: null,
      newValue: {
        id: tx.id,
        envelopeId: tx.envelopeId,
        amountCents: tx.amountCents,
        payee: tx.payee,
        transactionDate: tx.transactionDate,
      },
    });

    return createSuccess(tx);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/transactions/__tests__/CreateTransactionUseCase.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/transactions/CreateTransactionUseCase.ts src/domain/transactions/__tests__/CreateTransactionUseCase.test.ts
git commit -m "feat(domain): add CreateTransactionUseCase with atomic spentCents increment"
```

---

### Task 3: DeleteTransactionUseCase

**Files:**
- Create: `src/domain/transactions/DeleteTransactionUseCase.ts`
- Test: `src/domain/transactions/__tests__/DeleteTransactionUseCase.test.ts`

Deletes the transaction record and decrements `envelope.spentCents` by the transaction's `amountCents`.

- [ ] **Step 1: Write the failing test**

Create `src/domain/transactions/__tests__/DeleteTransactionUseCase.test.ts`:

```typescript
import { DeleteTransactionUseCase } from '../DeleteTransactionUseCase';
import type { TransactionEntity } from '../TransactionEntity';

const mockDelete = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
const mockUpdate = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
});
const mockDb = { delete: mockDelete, update: mockUpdate } as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

const tx: TransactionEntity = {
  id: 't1',
  householdId: 'h1',
  envelopeId: 'e1',
  amountCents: 3000,
  payee: 'Woolworths',
  description: null,
  transactionDate: '2026-04-10',
  isBusinessExpense: false,
  spendingTriggerNote: null,
  createdAt: '2026-04-10T10:00:00.000Z',
  updatedAt: '2026-04-10T10:00:00.000Z',
};

describe('DeleteTransactionUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes transaction row', async () => {
    const uc = new DeleteTransactionUseCase(mockDb, mockAudit, tx);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('decrements envelope spentCents', async () => {
    const uc = new DeleteTransactionUseCase(mockDb, mockAudit, tx);
    await uc.execute();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('logs audit event with action=delete', async () => {
    const uc = new DeleteTransactionUseCase(mockDb, mockAudit, tx);
    await uc.execute();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', entityId: 't1' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/transactions/__tests__/DeleteTransactionUseCase.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/transactions/DeleteTransactionUseCase.ts`:

```typescript
import { sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { transactions, envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';
import type { TransactionEntity } from './TransactionEntity';

export class DeleteTransactionUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly tx: TransactionEntity,
  ) {}

  async execute(): Promise<Result<void>> {
    const now = new Date().toISOString();

    await this.db
      .delete(transactions)
      .where(sql`${transactions.id} = ${this.tx.id}`);

    // Atomically decrement spentCents
    await this.db
      .update(envelopes)
      .set({ spentCents: sql`${envelopes.spentCents} - ${this.tx.amountCents}`, updatedAt: now })
      .where(sql`${envelopes.id} = ${this.tx.envelopeId}`);

    await this.audit.log({
      householdId: this.tx.householdId,
      entityType: 'transaction',
      entityId: this.tx.id,
      action: 'delete',
      previousValue: {
        id: this.tx.id,
        envelopeId: this.tx.envelopeId,
        amountCents: this.tx.amountCents,
        payee: this.tx.payee,
        transactionDate: this.tx.transactionDate,
      },
      newValue: null,
    });

    return createSuccess(undefined);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/transactions/__tests__/DeleteTransactionUseCase.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/transactions/DeleteTransactionUseCase.ts src/domain/transactions/__tests__/DeleteTransactionUseCase.test.ts
git commit -m "feat(domain): add DeleteTransactionUseCase with atomic spentCents decrement"
```

---

### Task 4: useTransactions hook

**Files:**
- Create: `src/presentation/hooks/useTransactions.ts`

Queries all transactions for a given `householdId` and `periodStart` (the current budget period start date), ordered by `transactionDate DESC`. Returns `{ transactions, loading, error, reload }`.

- [ ] **Step 1: Write the implementation** (no unit test — hook wires SQLite directly, covered by integration)

Create `src/presentation/hooks/useTransactions.ts`:

```typescript
import { useState, useCallback } from 'react';
import { and, eq, gte, desc } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { transactions as transactionsTable } from '../../data/local/schema';
import type { TransactionEntity } from '../../domain/transactions/TransactionEntity';

export interface UseTransactionsResult {
  transactions: TransactionEntity[];
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useTransactions(
  householdId: string,
  periodStart: string,
): UseTransactionsResult {
  const [txs, setTxs] = useState<TransactionEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await db
        .select()
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.householdId, householdId),
            gte(transactionsTable.transactionDate, periodStart),
          ),
        )
        .orderBy(desc(transactionsTable.transactionDate));
      setTxs(rows as TransactionEntity[]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [householdId, periodStart]);

  return { transactions: txs, loading, error, reload };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/hooks/useTransactions.ts
git commit -m "feat(hooks): add useTransactions hook"
```

---

### Task 5: Navigation types and TransactionsStackNavigator

**Files:**
- Modify: `src/presentation/navigation/types.ts`
- Create: `src/presentation/navigation/TransactionsStackNavigator.tsx`
- Modify: `src/presentation/navigation/MainTabNavigator.tsx`

The Transactions tab gets its own native stack: `TransactionList` (default) and `AddTransaction` screens.

- [ ] **Step 1: Update navigation types**

In `src/presentation/navigation/types.ts`, add after the `DashboardStackParamList` block:

```typescript
export type TransactionsStackParamList = {
  TransactionList: undefined;
  AddTransaction: undefined;
};

export type TransactionListScreenProps = CompositeScreenProps<
  NativeStackScreenProps<TransactionsStackParamList, 'TransactionList'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddTransactionScreenProps = NativeStackScreenProps<
  TransactionsStackParamList,
  'AddTransaction'
>;
```

Full updated `src/presentation/navigation/types.ts`:

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

export type TransactionsStackParamList = {
  TransactionList: undefined;
  AddTransaction: undefined;
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

export type TransactionListScreenProps = CompositeScreenProps<
  NativeStackScreenProps<TransactionsStackParamList, 'TransactionList'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddTransactionScreenProps = NativeStackScreenProps<
  TransactionsStackParamList,
  'AddTransaction'
>;
```

- [ ] **Step 2: Create TransactionsStackNavigator**

Create `src/presentation/navigation/TransactionsStackNavigator.tsx`:

```typescript
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colours } from '../theme/tokens';
import type { TransactionsStackParamList } from './types';
import { TransactionListScreen } from '../screens/transactions/TransactionListScreen';
import { AddTransactionScreen } from '../screens/transactions/AddTransactionScreen';

const Stack = createNativeStackNavigator<TransactionsStackParamList>();

export function TransactionsStackNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colours.surface },
        headerTintColor: colours.primary,
        headerTitleStyle: { fontFamily: 'PlusJakartaSans_700Bold' },
      }}
    >
      <Stack.Screen
        name="TransactionList"
        component={TransactionListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddTransaction"
        component={AddTransactionScreen}
        options={{ title: 'Add Transaction' }}
      />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 3: Wire in MainTabNavigator**

In `src/presentation/navigation/MainTabNavigator.tsx`, replace the `Transactions` placeholder tab:

Full updated file:

```typescript
import React from 'react';
import { View, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { DashboardStackNavigator } from './DashboardStackNavigator';
import { TransactionsStackNavigator } from './TransactionsStackNavigator';
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

function TabIcon({ name, color, size }: { name: string; color: string; size: number }): React.JSX.Element {
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
        component={TransactionsStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="swap-horizontal" color={color} size={size} />,
        }}
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

- [ ] **Step 4: Commit**

```bash
git add src/presentation/navigation/types.ts src/presentation/navigation/TransactionsStackNavigator.tsx src/presentation/navigation/MainTabNavigator.tsx
git commit -m "feat(nav): add TransactionsStackNavigator and wire into main tabs"
```

---

### Task 6: TransactionListScreen

**Files:**
- Create: `src/presentation/screens/transactions/TransactionListScreen.tsx`

Shows all transactions for the current budget period, grouped by date (section header per date). Each row shows: payee (or "Unknown"), envelope name (fetched alongside), amount in red (it's spending). Long-press a row to delete (Alert confirmation). FAB navigates to AddTransaction. Reloads on screen focus.

The screen needs envelope names for each transaction. Rather than a join query (complex with Drizzle), the screen queries envelopes separately and builds a `Map<envelopeId, name>` for display.

- [ ] **Step 1: Write the implementation**

Create `src/presentation/screens/transactions/TransactionListScreen.tsx`:

```typescript
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  SectionList,
  Alert,
} from 'react-native';
import { Text, FAB, ActivityIndicator, Surface, TouchableRipple } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { eq } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { envelopes as envelopesTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { DeleteTransactionUseCase } from '../../../domain/transactions/DeleteTransactionUseCase';
import { useTransactions } from '../../hooks/useTransactions';
import { CurrencyText } from '../../components/shared/CurrencyText';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing, radius } from '../../theme/tokens';
import { format, parseISO } from 'date-fns';
import type { TransactionListScreenProps } from '../../navigation/types';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

interface Section {
  title: string; // e.g. "10 Apr 2026"
  data: TransactionEntity[];
}

function groupByDate(txs: TransactionEntity[]): Section[] {
  const map = new Map<string, TransactionEntity[]>();
  for (const tx of txs) {
    const label = format(parseISO(tx.transactionDate), 'd MMM yyyy');
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(tx);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

export const TransactionListScreen: React.FC<TransactionListScreenProps> = ({ navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);
  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');

  const { transactions, loading, reload } = useTransactions(householdId, periodStart);
  const [envelopeNames, setEnvelopeNames] = useState<Map<string, string>>(new Map());

  // Load envelope names once (lightweight — only current period envelopes)
  useEffect(() => {
    db.select({ id: envelopesTable.id, name: envelopesTable.name })
      .from(envelopesTable)
      .where(eq(envelopesTable.householdId, householdId))
      .then((rows) => {
        setEnvelopeNames(new Map(rows.map((r) => [r.id, r.name])));
      });
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const handleDelete = useCallback(
    (tx: TransactionEntity) => {
      Alert.alert(
        'Delete transaction?',
        `${tx.payee ?? 'Unknown'} — ${(tx.amountCents / 100).toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              const uc = new DeleteTransactionUseCase(db, audit, tx);
              await uc.execute();
              void reload();
            },
          },
        ],
      );
    },
    [reload],
  );

  const sections = groupByDate(transactions);

  return (
    <View style={styles.flex}>
      <Surface style={styles.header} elevation={0}>
        <Text variant="labelMedium" style={styles.periodLabel}>TRANSACTIONS</Text>
        <Text variant="headlineSmall" style={styles.periodTitle}>{period.label}</Text>
      </Surface>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator animating color={colours.primary} />
        </View>
      ) : transactions.length === 0 ? (
        <View style={styles.center}>
          <Text variant="titleMedium" style={styles.emptyTitle}>No transactions yet</Text>
          <Text variant="bodyMedium" style={styles.emptyBody}>Tap + to record spending</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text variant="labelMedium" style={styles.sectionTitle}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableRipple onLongPress={() => handleDelete(item)} rippleColor={colours.errorContainer}>
              <Surface style={styles.row} elevation={1}>
                <View style={styles.rowLeft}>
                  <Text variant="bodyLarge" style={styles.payee} numberOfLines={1}>
                    {item.payee ?? 'Unknown'}
                  </Text>
                  <Text variant="bodySmall" style={styles.envelopeName}>
                    {envelopeNames.get(item.envelopeId) ?? '—'}
                  </Text>
                </View>
                <CurrencyText amountCents={item.amountCents} style={styles.amount} />
              </Surface>
            </TouchableRipple>
          )}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled
        />
      )}

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => navigation.navigate('AddTransaction')}
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
  periodLabel: { color: colours.onSurfaceVariant, letterSpacing: 1.5, marginBottom: spacing.xs },
  periodTitle: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { color: colours.onSurface, marginTop: spacing.base },
  emptyBody: { color: colours.onSurfaceVariant, textAlign: 'center', marginTop: spacing.sm },
  sectionHeader: {
    backgroundColor: colours.surfaceVariant,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
  },
  sectionTitle: { color: colours.onSurfaceVariant, letterSpacing: 0.8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
    backgroundColor: colours.surface,
  },
  rowLeft: { flex: 1, marginRight: spacing.base },
  payee: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  envelopeName: { color: colours.onSurfaceVariant, marginTop: 2 },
  amount: { color: colours.error, fontSize: 14, fontFamily: 'PlusJakartaSans_700Bold' },
  list: { paddingBottom: 100 },
  fab: { position: 'absolute', right: spacing.base, bottom: spacing.xl, backgroundColor: colours.primary },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/screens/transactions/TransactionListScreen.tsx
git commit -m "feat(screen): add TransactionListScreen with grouped date sections and delete"
```

---

### Task 7: AddTransactionScreen

**Files:**
- Create: `src/presentation/screens/transactions/AddTransactionScreen.tsx`

Form: envelope picker (modal FlatList of current-period envelopes), amount, payee, date (defaults today). On save, calls `CreateTransactionUseCase`, then `navigation.goBack()`. Envelope picker shows a bottom-sheet style modal with a list of envelopes to tap.

- [ ] **Step 1: Write the implementation**

Create `src/presentation/screens/transactions/AddTransactionScreen.tsx`:

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { Text, TextInput, Button, Snackbar, TouchableRipple, Surface } from 'react-native-paper';
import { and, eq } from 'drizzle-orm';
import { format } from 'date-fns';
import { db } from '../../../data/local/db';
import { envelopes as envelopesTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateTransactionUseCase } from '../../../domain/transactions/CreateTransactionUseCase';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing, radius } from '../../theme/tokens';
import type { AddTransactionScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

interface EnvelopeOption {
  id: string;
  name: string;
}

function toCents(randStr: string): number {
  const n = parseFloat(randStr.replace(',', '.'));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

export const AddTransactionScreen: React.FC<AddTransactionScreenProps> = ({ navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);

  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');
  const today = format(new Date(), 'yyyy-MM-dd');

  const [envelopes, setEnvelopes] = useState<EnvelopeOption[]>([]);
  const [selectedEnvelope, setSelectedEnvelope] = useState<EnvelopeOption | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [amountStr, setAmountStr] = useState('');
  const [payee, setPayee] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.select({ id: envelopesTable.id, name: envelopesTable.name })
      .from(envelopesTable)
      .where(
        and(
          eq(envelopesTable.householdId, householdId),
          eq(envelopesTable.periodStart, periodStart),
          eq(envelopesTable.isArchived, false),
        ),
      )
      .then((rows) => {
        setEnvelopes(rows);
        if (rows.length === 1) setSelectedEnvelope(rows[0]);
      });
  }, [householdId, periodStart]);

  const handleSave = useCallback(async () => {
    if (!selectedEnvelope) {
      setError('Please select an envelope');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const uc = new CreateTransactionUseCase(db, audit, {
        householdId,
        envelopeId: selectedEnvelope.id,
        amountCents: toCents(amountStr),
        payee: payee.trim() || null,
        description: description.trim() || null,
        transactionDate: today,
      });
      const result = await uc.execute();
      if (result.success) {
        navigation.goBack();
      } else {
        setError(result.error.message);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedEnvelope, amountStr, payee, description, householdId, today, navigation]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* Envelope Picker */}
        <Text variant="labelLarge" style={styles.label}>Envelope</Text>
        <TouchableRipple onPress={() => setShowPicker(true)} style={styles.pickerButton}>
          <View style={styles.pickerInner}>
            <Text
              variant="bodyLarge"
              style={selectedEnvelope ? styles.pickerValue : styles.pickerPlaceholder}
            >
              {selectedEnvelope ? selectedEnvelope.name : 'Select envelope…'}
            </Text>
            <Text style={styles.pickerChevron}>›</Text>
          </View>
        </TouchableRipple>

        <TextInput
          label="Amount (R)"
          value={amountStr}
          onChangeText={setAmountStr}
          mode="outlined"
          style={styles.input}
          keyboardType="decimal-pad"
          disabled={loading}
          placeholder="0.00"
          left={<TextInput.Affix text="R" />}
        />

        <TextInput
          label="Payee (optional)"
          value={payee}
          onChangeText={setPayee}
          mode="outlined"
          style={styles.input}
          disabled={loading}
          placeholder="e.g. Checkers"
        />

        <TextInput
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          mode="outlined"
          style={styles.input}
          disabled={loading}
          placeholder="e.g. Weekly groceries"
        />

        <Text variant="bodySmall" style={styles.dateNote}>
          Date: {format(new Date(), 'd MMM yyyy')} (today)
        </Text>

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          Record Transaction
        </Button>
      </ScrollView>

      {/* Envelope Picker Modal */}
      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPicker(false)}
      >
        <TouchableOpacity style={styles.modalBackdrop} onPress={() => setShowPicker(false)} activeOpacity={1}>
          <Surface style={styles.modalSheet} elevation={4}>
            <View style={styles.modalHandle} />
            <Text variant="titleMedium" style={styles.modalTitle}>Select Envelope</Text>
            <FlatList
              data={envelopes}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableRipple
                  onPress={() => {
                    setSelectedEnvelope(item);
                    setShowPicker(false);
                  }}
                  style={styles.modalItem}
                >
                  <Text
                    variant="bodyLarge"
                    style={
                      selectedEnvelope?.id === item.id
                        ? styles.modalItemSelected
                        : styles.modalItemText
                    }
                  >
                    {item.name}
                  </Text>
                </TouchableRipple>
              )}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text variant="bodyMedium" style={{ color: colours.onSurfaceVariant }}>
                    No envelopes for this period. Add envelopes first.
                  </Text>
                </View>
              }
            />
          </Surface>
        </TouchableOpacity>
      </Modal>

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
  label: { color: colours.onSurface, marginTop: spacing.xs },
  input: { backgroundColor: colours.surface },
  pickerButton: {
    borderWidth: 1,
    borderColor: colours.outline,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  pickerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
  },
  pickerValue: { flex: 1, color: colours.onSurface },
  pickerPlaceholder: { flex: 1, color: colours.onSurfaceVariant },
  pickerChevron: { color: colours.onSurfaceVariant, fontSize: 20 },
  dateNote: { color: colours.onSurfaceVariant, marginTop: spacing.xs },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colours.scrim },
  modalSheet: {
    backgroundColor: colours.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: spacing.xl,
    maxHeight: '60%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: colours.outlineVariant,
    borderRadius: radius.full,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  modalTitle: {
    color: colours.onSurface,
    fontFamily: 'PlusJakartaSans_700Bold',
    paddingHorizontal: spacing.base,
    marginBottom: spacing.sm,
  },
  modalItem: { paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  modalItemText: { color: colours.onSurface },
  modalItemSelected: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  center: { padding: spacing.base },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/screens/transactions/AddTransactionScreen.tsx
git commit -m "feat(screen): add AddTransactionScreen with envelope picker modal"
```

---

### Task 8: Final integration test

- [ ] **Step 1: Run all tests**

```
cd C:\Project\AccountingV2 && npx jest --no-coverage 2>&1 | tail -30
```

Expected: all tests pass

- [ ] **Step 2: Kill any stale Metro and restart**

```
npx kill-port 8085 2>/dev/null || true
```

Then start: `npx expo start --port 8085`

- [ ] **Step 3: Manual smoke test**

1. Login → Dashboard shows envelope list (from Sprint 1)
2. Tap Transactions tab (swap-horizontal icon) → shows "No transactions yet"
3. Tap + → AddTransaction screen opens
4. Select envelope from picker → tap envelope name in modal
5. Enter amount e.g. 50.00, payee e.g. "Checkers"
6. Tap "Record Transaction" → goes back to list, transaction appears
7. Switch to Dashboard tab → envelope's remaining amount has decreased
8. Long-press transaction → Alert appears → tap Delete → transaction removed, envelope spentCents decremented
9. Switch to Dashboard → remaining amount restored

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "feat(sprint-2): Transactions — record spending against envelopes"
git push
```
