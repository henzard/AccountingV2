# Business Expense Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users flag transactions as business expenses and optionally record a trigger note; provide a report screen that lists all business transactions grouped by month with totals, ready for SARS submission.

**Architecture:** The schema already has `isBusinessExpense` (boolean) and `spendingTriggerNote` (text) on the transactions table — no new migration needed. Work is entirely UI: add a toggle + note field to `AddTransactionScreen`, create `BusinessExpenseReportScreen`, add navigation from the Transactions tab header. The report queries local SQLite via Drizzle, no server calls.

**Tech Stack:** React Native, Drizzle ORM + expo-sqlite, react-native-paper, date-fns, existing `formatCurrency` utility.

---

## File Structure

| File                                                                    | Action | Purpose                                                   |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| `src/presentation/screens/transactions/AddTransactionScreen.tsx`        | Modify | Add business expense toggle + trigger note field          |
| `src/domain/transactions/BusinessExpenseReport.ts`                      | Create | Domain function: group transactions by month, sum totals  |
| `src/domain/transactions/__tests__/BusinessExpenseReport.test.ts`       | Create | Unit tests                                                |
| `src/presentation/screens/transactions/BusinessExpenseReportScreen.tsx` | Create | Report screen: grouped list + CSV export hint             |
| `src/presentation/navigation/types.ts`                                  | Modify | Add `BusinessExpenseReport` to TransactionsStackParamList |
| `src/presentation/navigation/TransactionsStackNavigator.tsx`            | Modify | Register screen + header button                           |

---

## Task 1: BusinessExpenseReport domain function (TDD)

**Files:**

- Create: `src/domain/transactions/BusinessExpenseReport.ts`
- Create: `src/domain/transactions/__tests__/BusinessExpenseReport.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/domain/transactions/__tests__/BusinessExpenseReport.test.ts`:

```typescript
import { groupBusinessExpenses } from '../BusinessExpenseReport';
import type { TransactionEntity } from '../TransactionEntity';

function tx(overrides: Partial<TransactionEntity>): TransactionEntity {
  return {
    id: 'id-1',
    householdId: 'hh-1',
    envelopeId: 'env-1',
    amountCents: 10000,
    payee: 'Supplier',
    description: null,
    transactionDate: '2026-03-15',
    isBusinessExpense: true,
    spendingTriggerNote: null,
    slipId: null,
    createdAt: '2026-03-15T10:00:00Z',
    updatedAt: '2026-03-15T10:00:00Z',
    ...overrides,
  };
}

describe('groupBusinessExpenses', () => {
  it('returns empty array for no transactions', () => {
    expect(groupBusinessExpenses([])).toEqual([]);
  });

  it('filters out non-business transactions', () => {
    const result = groupBusinessExpenses([tx({ isBusinessExpense: false })]);
    expect(result).toEqual([]);
  });

  it('groups by YYYY-MM month key', () => {
    const txs = [
      tx({ id: '1', transactionDate: '2026-03-10', amountCents: 5000 }),
      tx({ id: '2', transactionDate: '2026-03-25', amountCents: 3000 }),
      tx({ id: '3', transactionDate: '2026-04-05', amountCents: 7000 }),
    ];
    const result = groupBusinessExpenses(txs);
    expect(result).toHaveLength(2);
    expect(result[0].monthKey).toBe('2026-04'); // most recent first
    expect(result[0].totalCents).toBe(7000);
    expect(result[1].monthKey).toBe('2026-03');
    expect(result[1].totalCents).toBe(8000);
    expect(result[1].transactions).toHaveLength(2);
  });

  it('sorts months descending (most recent first)', () => {
    const txs = [
      tx({ id: '1', transactionDate: '2026-01-15', amountCents: 1000 }),
      tx({ id: '2', transactionDate: '2026-04-15', amountCents: 2000 }),
      tx({ id: '3', transactionDate: '2026-02-15', amountCents: 3000 }),
    ];
    const keys = groupBusinessExpenses(txs).map((g) => g.monthKey);
    expect(keys).toEqual(['2026-04', '2026-02', '2026-01']);
  });

  it('sorts transactions within month descending by date', () => {
    const txs = [
      tx({ id: '1', transactionDate: '2026-03-10', amountCents: 1000 }),
      tx({ id: '2', transactionDate: '2026-03-25', amountCents: 2000 }),
    ];
    const result = groupBusinessExpenses(txs);
    expect(result[0].transactions[0].transactionDate).toBe('2026-03-25');
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
npx jest src/domain/transactions/__tests__/BusinessExpenseReport.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement domain function**

Create `src/domain/transactions/BusinessExpenseReport.ts`:

```typescript
import type { TransactionEntity } from './TransactionEntity';

export interface BusinessExpenseGroup {
  monthKey: string; // 'YYYY-MM'
  monthLabel: string; // 'March 2026'
  totalCents: number;
  transactions: TransactionEntity[];
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function groupBusinessExpenses(transactions: TransactionEntity[]): BusinessExpenseGroup[] {
  const business = transactions.filter((t) => t.isBusinessExpense);

  const map = new Map<string, TransactionEntity[]>();
  for (const tx of business) {
    const monthKey = tx.transactionDate.slice(0, 7); // 'YYYY-MM'
    const bucket = map.get(monthKey) ?? [];
    bucket.push(tx);
    map.set(monthKey, bucket);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a)) // descending
    .map(([monthKey, txs]) => {
      const [year, month] = monthKey.split('-');
      const monthLabel = `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}`;
      const sorted = [...txs].sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
      const totalCents = sorted.reduce((sum, t) => sum + t.amountCents, 0);
      return { monthKey, monthLabel, totalCents, transactions: sorted };
    });
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest src/domain/transactions/__tests__/BusinessExpenseReport.test.ts
```

Expected: 5 tests, all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/transactions/BusinessExpenseReport.ts \
        src/domain/transactions/__tests__/BusinessExpenseReport.test.ts
git commit -m "feat(domain): groupBusinessExpenses — monthly grouping for SARS report"
```

---

## Task 2: AddTransactionScreen — business toggle + note

**Files:**

- Modify: `src/presentation/screens/transactions/AddTransactionScreen.tsx`

- [ ] **Step 1: Add state variables**

In `AddTransactionScreen.tsx`, after the existing state declarations, add:

```tsx
const [isBusinessExpense, setIsBusinessExpense] = useState(false);
const [spendingTriggerNote, setSpendingTriggerNote] = useState('');
```

- [ ] **Step 2: Add Switch import**

Add `Switch` to the react-native import and `Switch` from react-native-paper (use the RN native one for the toggle row):

```tsx
import { StyleSheet, ScrollView, KeyboardAvoidingView, Platform, View, Switch } from 'react-native';
```

- [ ] **Step 3: Add business expense UI after the description field**

Find the description `TextInput` in the JSX. After it, add:

```tsx
{
  /* Business expense toggle */
}
<View style={styles.toggleRow}>
  <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
    Business expense
  </Text>
  <Switch
    value={isBusinessExpense}
    onValueChange={setIsBusinessExpense}
    testID="business-expense-toggle"
    trackColor={{ true: colors.primary, false: colors.surfaceVariant }}
    thumbColor={colors.onPrimary}
  />
</View>;

{
  isBusinessExpense && (
    <TextInput
      label="Trigger note (optional)"
      value={spendingTriggerNote}
      onChangeText={setSpendingTriggerNote}
      mode="outlined"
      placeholder="e.g. Client lunch, travel reimbursement"
      testID="trigger-note-input"
      style={styles.input}
    />
  );
}
```

Add to StyleSheet:

```typescript
toggleRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingVertical: spacing.sm,
  marginBottom: spacing.sm,
},
```

- [ ] **Step 4: Pass fields to CreateTransactionUseCase**

Find where the transaction is created (the `handleSave` or equivalent function). Add the two fields:

```typescript
isBusinessExpense,
spendingTriggerNote: isBusinessExpense ? spendingTriggerNote.trim() || null : null,
```

- [ ] **Step 5: Run typecheck + tests**

```bash
npm run typecheck && npx jest --testPathPattern="AddTransaction" 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/screens/transactions/AddTransactionScreen.tsx
git commit -m "feat(ui): add business expense toggle + trigger note to AddTransactionScreen"
```

---

## Task 3: BusinessExpenseReportScreen

**Files:**

- Create: `src/presentation/screens/transactions/BusinessExpenseReportScreen.tsx`

- [ ] **Step 1: Create the screen**

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, SectionList } from 'react-native';
import { Text, Surface, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { eq, and } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { transactions as txTable } from '../../../data/local/schema';
import { groupBusinessExpenses } from '../../../domain/transactions/BusinessExpenseReport';
import { formatCurrency } from '../../utils/currency';
import { EmptyState } from '../../components/shared/EmptyState';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { useAppStore } from '../../stores/appStore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TransactionsStackParamList } from '../../navigation/types';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';

export type BusinessExpenseReportScreenProps = NativeStackScreenProps<
  TransactionsStackParamList,
  'BusinessExpenseReport'
>;

export function BusinessExpenseReportScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId) ?? '';
  const [groups, setGroups] = useState<ReturnType<typeof groupBusinessExpenses>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const rows = await db
      .select()
      .from(txTable)
      .where(and(eq(txTable.householdId, householdId), eq(txTable.isBusinessExpense, true)));
    const entities: TransactionEntity[] = rows.map((r) => ({
      id: r.id,
      householdId: r.householdId,
      envelopeId: r.envelopeId,
      amountCents: r.amountCents,
      payee: r.payee ?? null,
      description: r.description ?? null,
      transactionDate: r.transactionDate,
      isBusinessExpense: Boolean(r.isBusinessExpense),
      spendingTriggerNote: r.spendingTriggerNote ?? null,
      slipId: r.slipId ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    setGroups(groupBusinessExpenses(entities));
    setLoading(false);
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        title="No business expenses"
        body="Toggle 'Business expense' when logging a transaction to track it here."
        testID="biz-expense-empty"
      />
    );
  }

  const sections = groups.map((g) => ({
    title: g.monthLabel,
    total: g.totalCents,
    data: g.transactions,
  }));

  return (
    <SectionList
      style={[styles.flex, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(item) => item.id}
      renderSectionHeader={({ section }) => (
        <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
          <Text variant="titleSmall" style={{ color: colors.onSurface }}>
            {section.title}
          </Text>
          <Text variant="titleSmall" style={{ color: colors.primary }}>
            {formatCurrency(section.total)}
          </Text>
        </View>
      )}
      renderItem={({ item }) => (
        <Surface style={[styles.row, { backgroundColor: colors.surface }]} elevation={0}>
          <View style={styles.rowMain}>
            <Text variant="bodyMedium" style={{ color: colors.onSurface }} numberOfLines={1}>
              {item.payee ?? 'Unknown payee'}
            </Text>
            {item.spendingTriggerNote ? (
              <Text
                variant="bodySmall"
                style={{ color: colors.onSurfaceVariant }}
                numberOfLines={1}
              >
                {item.spendingTriggerNote}
              </Text>
            ) : null}
          </View>
          <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
            {formatCurrency(item.amountCents)}
          </Text>
        </Surface>
      )}
      testID="biz-expense-list"
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: spacing.xl },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.base,
    marginBottom: spacing.xs,
    borderRadius: radius.md,
  },
  rowMain: { flex: 1, marginRight: spacing.sm },
});
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck 2>&1 | grep -i business
```

Expected: only missing navigation route (fixed next task).

- [ ] **Step 3: Commit**

```bash
git add src/presentation/screens/transactions/BusinessExpenseReportScreen.tsx
git commit -m "feat(ui): BusinessExpenseReportScreen — monthly grouped SARS-ready expense list"
```

---

## Task 4: Wire navigation

**Files:**

- Modify: `src/presentation/navigation/types.ts`
- Modify: `src/presentation/navigation/TransactionsStackNavigator.tsx`

- [ ] **Step 1: Add route to TransactionsStackParamList**

In `src/presentation/navigation/types.ts`, add to `TransactionsStackParamList`:

```typescript
export type TransactionsStackParamList = {
  TransactionList: undefined;
  AddTransaction: undefined;
  BusinessExpenseReport: undefined; // ← add this
};
```

- [ ] **Step 2: Register screen + add header button**

In `src/presentation/navigation/TransactionsStackNavigator.tsx`:

```tsx
import { BusinessExpenseReportScreen } from '../screens/transactions/BusinessExpenseReportScreen';
import { TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';

// In Stack.Navigator add:
<Stack.Screen
  name="BusinessExpenseReport"
  component={BusinessExpenseReportScreen}
  options={{ title: 'Business Expenses' }}
/>

// On the TransactionList screen options, add a header right button:
<Stack.Screen
  name="TransactionList"
  component={TransactionListScreen}
  options={({ navigation }) => ({
    title: 'Transactions',
    headerRight: () => (
      <TouchableOpacity
        onPress={() => navigation.navigate('BusinessExpenseReport')}
        style={{ marginRight: 8 }}
        testID="biz-expense-header-button"
      >
        <Text style={{ color: colors.primary }}>Business</Text>
      </TouchableOpacity>
    ),
  })}
/>
```

- [ ] **Step 3: Run full suite**

```bash
npm run typecheck && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/navigation/types.ts \
        src/presentation/navigation/TransactionsStackNavigator.tsx
git commit -m "feat(nav): add BusinessExpenseReport screen to TransactionsStack"
```
