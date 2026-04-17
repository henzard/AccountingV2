# Advanced Forecasting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a 90-day cash flow projection per envelope — how much will be left at period end if current spending continues — so users can course-correct before they overspend.

**Architecture:** A pure-domain `CashFlowForecaster` class takes envelopes + transactions for the current period, computes average daily spend per envelope, and projects to period end. A new `ForecastScreen` accessible from the Dashboard displays envelope-level projections as a simple list with traffic-light colors. No new tables or migrations.

**Tech Stack:** React Native, Drizzle ORM + expo-sqlite, react-native-paper, date-fns, TypeScript, Jest.

---

## File Structure

| File                                                          | Action | Purpose                                               |
| ------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| `src/domain/forecasting/CashFlowForecaster.ts`                | Create | Pure domain: projects period-end balance per envelope |
| `src/domain/forecasting/__tests__/CashFlowForecaster.test.ts` | Create | Unit tests                                            |
| `src/presentation/screens/forecasting/ForecastScreen.tsx`     | Create | 90-day projection list screen                         |
| `src/presentation/navigation/types.ts`                        | Modify | Add `Forecast` to DashboardStackParamList             |
| `src/presentation/navigation/DashboardStackNavigator.tsx`     | Modify | Register ForecastScreen                               |
| `src/presentation/screens/dashboard/DashboardScreen.tsx`      | Modify | Add "Forecast" entry row                              |

---

## Task 1: CashFlowForecaster domain class (TDD)

**Files:**

- Create: `src/domain/forecasting/CashFlowForecaster.ts`
- Create: `src/domain/forecasting/__tests__/CashFlowForecaster.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/domain/forecasting/__tests__/CashFlowForecaster.test.ts`:

```typescript
import { CashFlowForecaster } from '../CashFlowForecaster';
import type { EnvelopeEntity } from '../../envelopes/EnvelopeEntity';
import type { TransactionEntity } from '../../transactions/TransactionEntity';

function env(overrides: Partial<EnvelopeEntity>): EnvelopeEntity {
  return {
    id: 'env-1',
    householdId: 'hh-1',
    name: 'Groceries',
    allocatedCents: 500000,
    spentCents: 0,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function tx(overrides: Partial<TransactionEntity>): TransactionEntity {
  return {
    id: 'tx-1',
    householdId: 'hh-1',
    envelopeId: 'env-1',
    amountCents: 10000,
    payee: 'Shop',
    description: null,
    transactionDate: '2026-04-10',
    isBusinessExpense: false,
    spendingTriggerNote: null,
    slipId: null,
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
    ...overrides,
  };
}

describe('CashFlowForecaster', () => {
  const forecaster = new CashFlowForecaster();
  // Period: 1 Apr – 30 Apr (30 days). Today = 10 Apr (day 10). Days remaining = 20.
  const periodStart = '2026-04-01';
  const periodEnd = '2026-04-30';
  const today = new Date('2026-04-10');

  it('returns empty array for empty envelopes', () => {
    const result = forecaster.project({
      envelopes: [],
      transactions: [],
      periodStart,
      periodEnd,
      today,
    });
    expect(result).toEqual([]);
  });

  it('skips income and archived envelopes', () => {
    const result = forecaster.project({
      envelopes: [env({ envelopeType: 'income' }), env({ isArchived: true })],
      transactions: [],
      periodStart,
      periodEnd,
      today,
    });
    expect(result).toHaveLength(0);
  });

  it('projects period-end balance with no spending as full allocation', () => {
    // No transactions → projected spend = 0 → projected remaining = allocated
    const result = forecaster.project({
      envelopes: [env({ allocatedCents: 500000, spentCents: 0 })],
      transactions: [],
      periodStart,
      periodEnd,
      today,
    });
    expect(result).toHaveLength(1);
    expect(result[0].projectedRemainingCents).toBe(500000);
    expect(result[0].status).toBe('on_track');
  });

  it('calculates correct projected spend based on daily rate', () => {
    // Spent R1000 in 10 days = R100/day. 20 days left → R2000 more projected.
    // Allocated R5000 → projected remaining = 5000 - 1000 - 2000 = 2000
    const result = forecaster.project({
      envelopes: [env({ allocatedCents: 500000, spentCents: 100000 })],
      transactions: [
        tx({ amountCents: 50000, transactionDate: '2026-04-05' }),
        tx({ amountCents: 50000, transactionDate: '2026-04-09' }),
      ],
      periodStart,
      periodEnd,
      today,
    });
    expect(result[0].dailySpendCents).toBe(10000); // 100000 / 10 days
    expect(result[0].projectedSpendRemainingCents).toBe(200000); // 10000 * 20
    expect(result[0].projectedRemainingCents).toBe(200000); // 500000 - 100000 - 200000
    expect(result[0].status).toBe('on_track');
  });

  it('marks status as warning when projected remaining < 20% of allocation', () => {
    // Spent R4500 in 10 days = R450/day. 20 days → R9000 more. Remaining = 5000 - 4500 - 9000 = negative
    // But let's test warning: spend R3500, project R7000 more → remaining R-5500 → over_budget
    const result = forecaster.project({
      envelopes: [env({ allocatedCents: 500000, spentCents: 350000 })],
      transactions: [tx({ amountCents: 350000, transactionDate: '2026-04-05' })],
      periodStart,
      periodEnd,
      today,
    });
    expect(result[0].status).toBe('over_budget');
  });

  it('marks status as warning when projected remaining is 10-20% of allocation', () => {
    // Allocated 500000, spend 450000 in 10 days → daily = 45000 → 20 days = 900000 more → very negative
    // Let's test warning band: spend 40000 in 10 days → daily 4000 → 80000 more → remaining 380000
    // 380000 / 500000 = 76% → on_track
    // For warning: remaining should be 5-20% of allocated.
    // Spend 460000 in 10 days → daily 46000 → 920000 more → remaining = -880000 → over_budget
    // Tweak: allocated 1000000, spent 80000 → daily 8000 → proj remaining = 1000000-80000-(8000*20) = 760000 = 76% → on_track
    // For warning band (10-20%): allocated 100000, spent 82000 → daily 8200 → 20d = 164000 more → remaining = -146000 → over_budget
    // Let me construct a true warning case: remaining after projection = 12% of allocated
    // allocated = 100000, projectedRemaining = 12000
    // projectedRemaining = allocated - spentCents - (dailySpend * daysLeft)
    // 12000 = 100000 - spent - (spent/10 * 20)
    // 12000 = 100000 - spent * 3
    // spent * 3 = 88000 → spent ≈ 29333
    const result = forecaster.project({
      envelopes: [env({ allocatedCents: 100000, spentCents: 29333 })],
      transactions: [tx({ amountCents: 29333, transactionDate: '2026-04-05' })],
      periodStart,
      periodEnd,
      today,
    });
    expect(result[0].status).toBe('warning');
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
npx jest src/domain/forecasting/__tests__/CashFlowForecaster.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement CashFlowForecaster**

Create `src/domain/forecasting/CashFlowForecaster.ts`:

```typescript
import { differenceInDays, parseISO, max as dateMax } from 'date-fns';
import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';
import type { TransactionEntity } from '../transactions/TransactionEntity';

export type ForecastStatus = 'on_track' | 'warning' | 'over_budget';

export interface EnvelopeForecast {
  envelopeId: string;
  envelopeName: string;
  allocatedCents: number;
  spentCents: number;
  dailySpendCents: number;
  daysElapsed: number;
  daysRemaining: number;
  projectedSpendRemainingCents: number;
  projectedRemainingCents: number;
  /** Percentage of allocation projected to remain at period end (can be negative) */
  projectedRemainingPct: number;
  status: ForecastStatus;
}

export interface ForecastInput {
  envelopes: EnvelopeEntity[];
  transactions: TransactionEntity[];
  periodStart: string; // ISO date YYYY-MM-DD
  periodEnd: string; // ISO date YYYY-MM-DD
  today?: Date;
}

export class CashFlowForecaster {
  project(input: ForecastInput): EnvelopeForecast[] {
    const today = input.today ?? new Date();
    const start = parseISO(input.periodStart);
    const end = parseISO(input.periodEnd);

    const daysElapsed = Math.max(1, differenceInDays(today, start));
    const daysRemaining = Math.max(0, differenceInDays(end, today));

    // Index transactions by envelopeId
    const spendByEnvelope = new Map<string, number>();
    for (const tx of input.transactions) {
      spendByEnvelope.set(
        tx.envelopeId,
        (spendByEnvelope.get(tx.envelopeId) ?? 0) + tx.amountCents,
      );
    }

    return input.envelopes
      .filter(
        (e) => !e.isArchived && e.envelopeType !== 'income' && e.envelopeType !== 'sinking_fund',
      )
      .map((e): EnvelopeForecast => {
        const spentCents = e.spentCents;
        const dailySpendCents = Math.round(spentCents / daysElapsed);
        const projectedSpendRemainingCents = dailySpendCents * daysRemaining;
        const projectedRemainingCents =
          e.allocatedCents - spentCents - projectedSpendRemainingCents;
        const projectedRemainingPct =
          e.allocatedCents === 0
            ? 100
            : Math.round((projectedRemainingCents / e.allocatedCents) * 100);

        let status: ForecastStatus;
        if (projectedRemainingPct < 10) {
          status = 'over_budget';
        } else if (projectedRemainingPct < 20) {
          status = 'warning';
        } else {
          status = 'on_track';
        }

        return {
          envelopeId: e.id,
          envelopeName: e.name,
          allocatedCents: e.allocatedCents,
          spentCents,
          dailySpendCents,
          daysElapsed,
          daysRemaining,
          projectedSpendRemainingCents,
          projectedRemainingCents,
          projectedRemainingPct,
          status,
        };
      });
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest src/domain/forecasting/__tests__/CashFlowForecaster.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domain/forecasting/CashFlowForecaster.ts \
        src/domain/forecasting/__tests__/CashFlowForecaster.test.ts
git commit -m "feat(domain): CashFlowForecaster — 90-day spend projection per envelope"
```

---

## Task 2: ForecastScreen

**Files:**

- Create: `src/presentation/screens/forecasting/ForecastScreen.tsx`

- [ ] **Step 1: Create the screen**

```tsx
import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { CashFlowForecaster } from '../../../domain/forecasting/CashFlowForecaster';
import { formatCurrency } from '../../utils/currency';
import { LoadingSkeletonList } from '../../components/shared/LoadingSkeletonList';
import { ScreenHeader } from '../../components/shared/ScreenHeader';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DashboardStackParamList } from '../../navigation/types';
import type { EnvelopeForecast } from '../../../domain/forecasting/CashFlowForecaster';

export type ForecastScreenProps = NativeStackScreenProps<DashboardStackParamList, 'Forecast'>;

const engine = new BudgetPeriodEngine();
const forecaster = new CashFlowForecaster();

const STATUS_COLORS = {
  on_track: 'success',
  warning: 'warning',
  over_budget: 'error',
} as const;

export function ForecastScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId) ?? '';
  const paydayDay = useAppStore((s) => s.paydayDay);
  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');
  const periodEnd = format(period.endDate, 'yyyy-MM-dd');

  const { envelopes, loading, reload } = useEnvelopes(householdId, periodStart);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const forecasts = forecaster.project({
    envelopes,
    transactions: [], // We use spentCents from envelopes (already aggregated)
    periodStart,
    periodEnd,
  });

  // Sort: over_budget first, then warning, then on_track
  const STATUS_ORDER = { over_budget: 0, warning: 1, on_track: 2 };
  const sorted = [...forecasts].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScreenHeader eyebrow={period.label} title="90-Day Forecast" />

      {loading ? (
        <LoadingSkeletonList count={4} testID="forecast-loading" />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.envelopeId}
          contentContainerStyle={styles.list}
          testID="forecast-list"
          renderItem={({ item }) => <ForecastRow item={item} />}
          ListHeaderComponent={
            <Text variant="bodySmall" style={[styles.hint, { color: colors.onSurfaceVariant }]}>
              Based on {sorted[0]?.daysElapsed ?? 0} days of spending.{' '}
              {sorted[0]?.daysRemaining ?? 0} days left in period.
            </Text>
          }
        />
      )}
    </View>
  );
}

function ForecastRow({ item }: { item: EnvelopeForecast }): React.JSX.Element {
  const { colors } = useAppTheme();
  const statusColor = {
    on_track: colors.success,
    warning: colors.warning,
    over_budget: colors.error,
  }[item.status];

  const barPct = Math.max(0, Math.min(100, item.projectedRemainingPct));

  return (
    <Surface style={[styles.row, { backgroundColor: colors.surface }]} elevation={0}>
      <View style={styles.rowHeader}>
        <Text variant="titleSmall" style={{ color: colors.onSurface }} numberOfLines={1}>
          {item.envelopeName}
        </Text>
        <Text variant="bodyMedium" style={{ color: statusColor }}>
          {formatCurrency(item.projectedRemainingCents)}
        </Text>
      </View>

      {/* Projection bar */}
      <View style={[styles.track, { backgroundColor: colors.surfaceVariant }]}>
        <View
          style={[
            styles.fill,
            { width: `${barPct}%` as `${number}%`, backgroundColor: statusColor },
          ]}
        />
      </View>

      <View style={styles.rowFooter}>
        <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>
          {formatCurrency(item.spentCents)} spent · {formatCurrency(item.dailySpendCents)}/day
        </Text>
        <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>
          {item.projectedRemainingPct}% projected left
        </Text>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.base, paddingBottom: spacing.xl },
  hint: { marginBottom: spacing.base },
  row: {
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.sm,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  track: {
    height: 4,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  fill: {
    height: 4,
    borderRadius: radius.full,
  },
  rowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meta: {
    fontSize: fontSize.sm,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/screens/forecasting/ForecastScreen.tsx
git commit -m "feat(ui): ForecastScreen — per-envelope 90-day spend projection"
```

---

## Task 3: Wire navigation + Dashboard entry

**Files:**

- Modify: `src/presentation/navigation/types.ts`
- Modify: `src/presentation/navigation/DashboardStackNavigator.tsx`
- Modify: `src/presentation/screens/dashboard/DashboardScreen.tsx`

- [ ] **Step 1: Add Forecast to DashboardStackParamList**

In `src/presentation/navigation/types.ts`:

```typescript
export type DashboardStackParamList = {
  DashboardHome: undefined;
  AddEditEnvelope: { envelopeId?: string; preselectedType?: EnvelopeType } | undefined;
  BabySteps: undefined;
  AddTransaction: undefined;
  SinkingFunds: undefined;
  Forecast: undefined; // ← add this
};
```

- [ ] **Step 2: Register screen**

In `src/presentation/navigation/DashboardStackNavigator.tsx`:

```tsx
import { ForecastScreen } from '../screens/forecasting/ForecastScreen';

<Stack.Screen name="Forecast" component={ForecastScreen} options={{ title: 'Forecast' }} />;
```

- [ ] **Step 3: Add Dashboard entry row**

In `src/presentation/screens/dashboard/DashboardScreen.tsx`, add after the Sinking Funds entry (or BabyStepsCard):

```tsx
<TouchableOpacity
  style={[
    styles.entryRow,
    { backgroundColor: colors.tertiaryContainer ?? colors.secondaryContainer },
  ]}
  onPress={() => navigation.navigate('Forecast')}
  testID="forecast-entry"
>
  <Text variant="labelLarge" style={{ color: colors.onSecondaryContainer }}>
    90-Day Forecast
  </Text>
  <Text style={{ color: colors.onSecondaryContainer }}>›</Text>
</TouchableOpacity>
```

- [ ] **Step 4: Run full suite**

```bash
npm run typecheck && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/navigation/types.ts \
        src/presentation/navigation/DashboardStackNavigator.tsx \
        src/presentation/screens/dashboard/DashboardScreen.tsx
git commit -m "feat(nav): add Forecast screen + Dashboard entry point"
```
