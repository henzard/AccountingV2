# Sinking Funds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let households create target-date savings pools (school fees, car service, holiday) that show progress toward a goal amount and auto-calculate required monthly contributions.

**Architecture:** Add `target_amount_cents` and `target_date` nullable columns to the existing `envelopes` table and introduce a new `'sinking_fund'` EnvelopeType. The domain layer gains a `SinkingFundProjector` that calculates monthly top-up required. A new `SinkingFundsScreen` lists all sinking fund envelopes; `AddEditEnvelopeScreen` shows target fields when type is `sinking_fund`. No new tables — sinking funds are envelopes with extra metadata.

**Tech Stack:** React Native 0.83 + Expo SDK 55, TypeScript 5.9, Drizzle ORM + expo-sqlite, react-native-paper MD3, Supabase (Postgres + RLS), Jest + @testing-library/react-native, date-fns.

---

## File Structure

| File                                                                      | Action | Purpose                                                          |
| ------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| `supabase/migrations/009_sinking_funds.sql`                               | Create | Add target columns to envelopes; update merge_envelope RPC       |
| `src/data/local/schema.ts`                                                | Modify | Add `targetAmountCents` + `targetDate` to envelopes table        |
| `src/domain/envelopes/EnvelopeEntity.ts`                                  | Modify | Add `'sinking_fund'` to EnvelopeType; add optional target fields |
| `src/domain/envelopes/SinkingFundProjector.ts`                            | Create | Calculates months remaining + required monthly top-up            |
| `src/domain/envelopes/__tests__/SinkingFundProjector.test.ts`             | Create | Unit tests for projector                                         |
| `src/presentation/components/envelopes/SinkingFundCard.tsx`               | Create | Card showing saved/target + progress ring + months remaining     |
| `src/presentation/screens/sinkingFunds/SinkingFundsScreen.tsx`            | Create | List screen for all sinking fund envelopes                       |
| `src/presentation/screens/dashboard/components/AddEditEnvelopeScreen.tsx` | Modify | Show target fields when type = sinking_fund                      |
| `src/presentation/navigation/types.ts`                                    | Modify | Add `SinkingFunds` route to DashboardStackParamList              |
| `src/presentation/navigation/DashboardStackNavigator.tsx`                 | Modify | Register SinkingFundsScreen                                      |
| `src/presentation/screens/dashboard/DashboardScreen.tsx`                  | Modify | Add Sinking Funds entry point card                               |

---

## Task 1: Database migration — add target columns

**Files:**

- Create: `supabase/migrations/009_sinking_funds.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/009_sinking_funds.sql`:

```sql
-- 009_sinking_funds.sql
-- Add sinking fund target columns to envelopes table.
-- Both columns are nullable; non-null only when envelope_type = 'sinking_fund'.

ALTER TABLE public.envelopes
  ADD COLUMN IF NOT EXISTS target_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS target_date TEXT; -- ISO date YYYY-MM-DD

-- Update merge_envelope RPC to include the new columns.
CREATE OR REPLACE FUNCTION public.merge_envelope(r public.envelopes)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid()::text;
  is_member boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = r.household_id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', r.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.envelopes (
    id, household_id, name, allocated_cents, spent_cents,
    envelope_type, is_savings_locked, is_archived, period_start,
    target_amount_cents, target_date,
    created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.name, r.allocated_cents, r.spent_cents,
    r.envelope_type, r.is_savings_locked, r.is_archived, r.period_start,
    r.target_amount_cents, r.target_date,
    r.created_at, r.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      name                = EXCLUDED.name,
      allocated_cents     = EXCLUDED.allocated_cents,
      spent_cents         = EXCLUDED.spent_cents,
      envelope_type       = EXCLUDED.envelope_type,
      is_savings_locked   = EXCLUDED.is_savings_locked,
      is_archived         = EXCLUDED.is_archived,
      period_start        = EXCLUDED.period_start,
      target_amount_cents = EXCLUDED.target_amount_cents,
      target_date         = EXCLUDED.target_date,
      updated_at          = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at >= envelopes.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_envelope(public.envelopes) TO authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/009_sinking_funds.sql
git commit -m "feat(db): add target_amount_cents + target_date to envelopes; update merge_envelope RPC"
```

---

## Task 2: Update Drizzle schema + domain entity

**Files:**

- Modify: `src/data/local/schema.ts`
- Modify: `src/domain/envelopes/EnvelopeEntity.ts`

- [ ] **Step 1: Add columns to Drizzle envelopes table**

In `src/data/local/schema.ts`, find the `envelopes` sqliteTable definition and add two columns after `periodStart`:

```typescript
// Add these two lines inside the envelopes table definition:
targetAmountCents: integer('target_amount_cents'),
targetDate: text('target_date'), // ISO date YYYY-MM-DD, nullable
```

The full table should look like:

```typescript
export const envelopes = sqliteTable('envelopes', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  name: text('name').notNull(),
  allocatedCents: integer('allocated_cents').notNull().default(0),
  spentCents: integer('spent_cents').notNull().default(0),
  envelopeType: text('envelope_type').notNull().default('spending'),
  isSavingsLocked: integer('is_savings_locked', { mode: 'boolean' }).notNull().default(false),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  periodStart: text('period_start').notNull(),
  targetAmountCents: integer('target_amount_cents'),
  targetDate: text('target_date'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
```

- [ ] **Step 2: Update EnvelopeEntity domain type**

Replace `EnvelopeEntity.ts` content:

```typescript
export type EnvelopeType =
  | 'spending'
  | 'savings'
  | 'emergency_fund'
  | 'baby_step'
  | 'utility'
  | 'income'
  | 'sinking_fund';

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
  targetAmountCents: number | null;
  targetDate: string | null; // ISO date YYYY-MM-DD
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

- [ ] **Step 3: Run typecheck to catch any callers that need updating**

```bash
npm run typecheck 2>&1 | head -40
```

Expected: errors only where `targetAmountCents`/`targetDate` are not yet mapped (row converters, use cases). Fix each one: add `targetAmountCents: row.targetAmountCents ?? null, targetDate: row.targetDate ?? null` to any place that maps DB rows to `EnvelopeEntity`.

- [ ] **Step 4: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all 559 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/local/schema.ts src/domain/envelopes/EnvelopeEntity.ts
git commit -m "feat(domain): add sinking_fund EnvelopeType + target fields to EnvelopeEntity"
```

---

## Task 3: SinkingFundProjector domain class (TDD)

**Files:**

- Create: `src/domain/envelopes/SinkingFundProjector.ts`
- Create: `src/domain/envelopes/__tests__/SinkingFundProjector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/domain/envelopes/__tests__/SinkingFundProjector.test.ts`:

```typescript
import { differenceInMonths, addMonths, startOfMonth } from 'date-fns';
import { SinkingFundProjector } from '../SinkingFundProjector';

const TODAY = new Date('2026-04-16');

describe('SinkingFundProjector', () => {
  const projector = new SinkingFundProjector();

  it('returns monthsRemaining = 0 when target date is in the past', () => {
    const result = projector.project({
      savedCents: 5000_00,
      targetAmountCents: 10000_00,
      targetDate: '2025-01-01',
      today: TODAY,
    });
    expect(result.monthsRemaining).toBe(0);
  });

  it('calculates correct monthly top-up for future target', () => {
    // Target: R12000 total, saved R2000, target in 10 months
    // Need R10000 more in 10 months = R1000/month
    const targetDate = '2027-02-16'; // ~10 months from TODAY
    const result = projector.project({
      savedCents: 2000_00,
      targetAmountCents: 12000_00,
      targetDate,
      today: TODAY,
    });
    expect(result.requiredMonthlyCents).toBe(1000_00);
    expect(result.monthsRemaining).toBe(10);
    expect(result.isOnTrack).toBe(false); // no current monthly contribution given
  });

  it('isOnTrack = true when currentMonthlyCents >= requiredMonthlyCents', () => {
    const targetDate = '2027-02-16';
    const result = projector.project({
      savedCents: 2000_00,
      targetAmountCents: 12000_00,
      targetDate,
      currentMonthlyCents: 1000_00,
      today: TODAY,
    });
    expect(result.isOnTrack).toBe(true);
  });

  it('returns percentComplete as integer 0-100', () => {
    const result = projector.project({
      savedCents: 5000_00,
      targetAmountCents: 10000_00,
      targetDate: '2027-04-16',
      today: TODAY,
    });
    expect(result.percentComplete).toBe(50);
  });

  it('clamps percentComplete to 100 when saved >= target', () => {
    const result = projector.project({
      savedCents: 12000_00,
      targetAmountCents: 10000_00,
      targetDate: '2027-04-16',
      today: TODAY,
    });
    expect(result.percentComplete).toBe(100);
    expect(result.requiredMonthlyCents).toBe(0);
  });

  it('requiredMonthlyCents = 0 when already at target', () => {
    const result = projector.project({
      savedCents: 10000_00,
      targetAmountCents: 10000_00,
      targetDate: '2027-04-16',
      today: TODAY,
    });
    expect(result.requiredMonthlyCents).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest src/domain/envelopes/__tests__/SinkingFundProjector.test.ts
```

Expected: FAIL — `SinkingFundProjector` not found.

- [ ] **Step 3: Implement SinkingFundProjector**

Create `src/domain/envelopes/SinkingFundProjector.ts`:

```typescript
import { differenceInMonths, parseISO } from 'date-fns';

export interface SinkingFundProjection {
  percentComplete: number; // 0-100
  monthsRemaining: number; // 0 if target date passed
  requiredMonthlyCents: number; // 0 if already at target or past due
  isOnTrack: boolean; // true if currentMonthlyCents >= requiredMonthlyCents
}

export interface SinkingFundProjectInput {
  savedCents: number;
  targetAmountCents: number;
  targetDate: string; // ISO date YYYY-MM-DD
  currentMonthlyCents?: number; // current envelope allocation
  today?: Date;
}

export class SinkingFundProjector {
  project(input: SinkingFundProjectInput): SinkingFundProjection {
    const today = input.today ?? new Date();
    const target = parseISO(input.targetDate);
    const monthsRemaining = Math.max(0, differenceInMonths(target, today));
    const shortfallCents = Math.max(0, input.targetAmountCents - input.savedCents);
    const percentComplete =
      input.targetAmountCents === 0
        ? 100
        : Math.min(100, Math.round((input.savedCents / input.targetAmountCents) * 100));
    const requiredMonthlyCents =
      monthsRemaining === 0 ? 0 : Math.ceil(shortfallCents / monthsRemaining);
    const currentMonthly = input.currentMonthlyCents ?? 0;
    const isOnTrack = shortfallCents === 0 || currentMonthly >= requiredMonthlyCents;

    return { percentComplete, monthsRemaining, requiredMonthlyCents, isOnTrack };
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest src/domain/envelopes/__tests__/SinkingFundProjector.test.ts
```

Expected: 6 tests, all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/envelopes/SinkingFundProjector.ts src/domain/envelopes/__tests__/SinkingFundProjector.test.ts
git commit -m "feat(domain): SinkingFundProjector — monthly top-up + on-track calculation"
```

---

## Task 4: SinkingFundCard component

**Files:**

- Create: `src/presentation/components/envelopes/SinkingFundCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { format, parseISO } from 'date-fns';
import { formatCurrency } from '../../utils/currency';
import { SinkingFundProjector } from '../../../domain/envelopes/SinkingFundProjector';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

interface SinkingFundCardProps {
  envelope: EnvelopeEntity;
  onPress?: () => void;
  testID?: string;
}

const projector = new SinkingFundProjector();

export function SinkingFundCard({
  envelope,
  onPress,
  testID,
}: SinkingFundCardProps): React.JSX.Element {
  const { colors } = useAppTheme();

  const projection =
    envelope.targetAmountCents && envelope.targetDate
      ? projector.project({
          savedCents: envelope.allocatedCents,
          targetAmountCents: envelope.targetAmountCents,
          targetDate: envelope.targetDate,
          currentMonthlyCents: envelope.allocatedCents,
        })
      : null;

  const barColor = projection
    ? projection.isOnTrack
      ? colors.success
      : colors.warning
    : colors.primary;

  return (
    <TouchableOpacity onPress={onPress} disabled={!onPress} testID={testID}>
      <Surface style={[styles.card, { backgroundColor: colors.surface }]} elevation={1}>
        <View style={styles.header}>
          <Text variant="titleSmall" style={{ color: colors.onSurface }}>
            {envelope.name}
          </Text>
          {envelope.targetDate && (
            <Text style={[styles.dueDate, { color: colors.onSurfaceVariant }]}>
              {format(parseISO(envelope.targetDate), 'MMM yyyy')}
            </Text>
          )}
        </View>

        {projection && (
          <>
            <View style={styles.amountRow}>
              <Text variant="headlineSmall" style={{ color: colors.onSurface }}>
                {formatCurrency(envelope.allocatedCents)}
              </Text>
              <Text style={[styles.target, { color: colors.onSurfaceVariant }]}>
                {' of '}
                {formatCurrency(envelope.targetAmountCents!)}
              </Text>
            </View>

            {/* Progress bar */}
            <View style={[styles.track, { backgroundColor: colors.surfaceVariant }]}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${projection.percentComplete}%` as `${number}%`,
                    backgroundColor: barColor,
                  },
                ]}
                testID="sinking-fund-progress-bar"
              />
            </View>

            <View style={styles.footer}>
              <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>
                {projection.monthsRemaining} month{projection.monthsRemaining !== 1 ? 's' : ''} left
              </Text>
              {projection.requiredMonthlyCents > 0 && (
                <Text
                  style={[
                    styles.meta,
                    { color: projection.isOnTrack ? colors.success : colors.warning },
                  ]}
                >
                  {formatCurrency(projection.requiredMonthlyCents)}/mo needed
                </Text>
              )}
            </View>
          </>
        )}
      </Surface>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  dueDate: {
    fontSize: fontSize.sm,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  target: {
    fontSize: fontSize.md,
  },
  track: {
    height: 6,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  fill: {
    height: 6,
    borderRadius: radius.full,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meta: {
    fontSize: fontSize.sm,
  },
});
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck 2>&1 | grep SinkingFund
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/presentation/components/envelopes/SinkingFundCard.tsx
git commit -m "feat(ui): SinkingFundCard — progress bar + monthly top-up display"
```

---

## Task 5: SinkingFundsScreen

**Files:**

- Create: `src/presentation/screens/sinkingFunds/SinkingFundsScreen.tsx`

- [ ] **Step 1: Create the screen**

```tsx
import React, { useCallback } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { FAB } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { SinkingFundCard } from '../../components/envelopes/SinkingFundCard';
import { EmptyState } from '../../components/shared/EmptyState';
import { LoadingSkeletonList } from '../../components/shared/LoadingSkeletonList';
import { ScreenHeader } from '../../components/shared/ScreenHeader';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { format } from 'date-fns';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DashboardStackParamList } from '../../navigation/types';

export type SinkingFundsScreenProps = NativeStackScreenProps<
  DashboardStackParamList,
  'SinkingFunds'
>;

const engine = new BudgetPeriodEngine();

export function SinkingFundsScreen({ navigation }: SinkingFundsScreenProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId) ?? '';
  const paydayDay = useAppStore((s) => s.paydayDay);
  const periodStart = format(engine.getCurrentPeriod(paydayDay).startDate, 'yyyy-MM-dd');

  const { envelopes, loading, reload } = useEnvelopes(householdId, periodStart);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const funds = envelopes.filter((e) => e.envelopeType === 'sinking_fund');

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScreenHeader eyebrow="Savings goals" title="Sinking Funds" />

      {loading ? (
        <LoadingSkeletonList count={3} testID="sinking-funds-loading" />
      ) : funds.length === 0 ? (
        <EmptyState
          title="No sinking funds yet"
          body="Create a goal to save toward a specific target — car service, school fees, holiday."
          testID="sinking-funds-empty"
        />
      ) : (
        <FlatList
          data={funds}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SinkingFundCard
              envelope={item}
              onPress={() => navigation.navigate('AddEditEnvelope', { envelopeId: item.id })}
              testID={`sinking-fund-card-${item.id}`}
            />
          )}
          contentContainerStyle={styles.list}
          testID="sinking-funds-list"
        />
      )}

      <FAB
        icon="plus"
        label="New goal"
        style={[styles.fab, { backgroundColor: colors.primary }]}
        color={colors.onPrimary}
        onPress={() => navigation.navigate('AddEditEnvelope', { preselectedType: 'sinking_fund' })}
        testID="new-sinking-fund-fab"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.base, paddingBottom: spacing.xl + 56 + spacing.md },
  fab: { position: 'absolute', right: spacing.base, bottom: spacing.xl },
});
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck 2>&1 | grep -i sinking
```

Expected: no errors (route doesn't exist yet — we'll add it in Task 6).

- [ ] **Step 3: Commit**

```bash
git add src/presentation/screens/sinkingFunds/SinkingFundsScreen.tsx
git commit -m "feat(ui): SinkingFundsScreen — list + empty state + new goal FAB"
```

---

## Task 6: Wire navigation + AddEditEnvelope target fields

**Files:**

- Modify: `src/presentation/navigation/types.ts`
- Modify: `src/presentation/navigation/DashboardStackNavigator.tsx`
- Modify: `src/presentation/screens/dashboard/AddEditEnvelopeScreen.tsx` (add target fields)
- Modify: `src/presentation/screens/dashboard/DashboardScreen.tsx` (add entry point)

- [ ] **Step 1: Add SinkingFunds to DashboardStackParamList**

In `src/presentation/navigation/types.ts`, add to `DashboardStackParamList`:

```typescript
export type DashboardStackParamList = {
  DashboardHome: undefined;
  AddEditEnvelope:
    | {
        envelopeId?: string;
        preselectedType?: import('../../domain/envelopes/EnvelopeEntity').EnvelopeType;
      }
    | undefined;
  BabySteps: undefined;
  AddTransaction: undefined;
  SinkingFunds: undefined; // ← add this line
};
```

- [ ] **Step 2: Register screen in navigator**

In `src/presentation/navigation/DashboardStackNavigator.tsx`, add the SinkingFunds screen after the BabySteps screen registration:

```tsx
import { SinkingFundsScreen } from '../screens/sinkingFunds/SinkingFundsScreen';

// Inside the Stack.Navigator, add:
<Stack.Screen
  name="SinkingFunds"
  component={SinkingFundsScreen}
  options={{ title: 'Sinking Funds' }}
/>;
```

- [ ] **Step 3: Add target fields to AddEditEnvelopeScreen**

In `src/presentation/screens/dashboard/AddEditEnvelopeScreen.tsx` (or wherever AddEditEnvelope lives), add target amount and date fields that appear when `envelopeType === 'sinking_fund'`:

Find the form section and add after the envelope type picker:

```tsx
{
  envelopeType === 'sinking_fund' && (
    <>
      <TextInput
        label="Target amount (R)"
        value={targetAmountStr}
        onChangeText={setTargetAmountStr}
        keyboardType="decimal-pad"
        mode="outlined"
        testID="target-amount-input"
        style={styles.input}
      />
      <TextInput
        label="Target date (YYYY-MM-DD)"
        value={targetDate}
        onChangeText={setTargetDate}
        placeholder="2027-12-01"
        mode="outlined"
        testID="target-date-input"
        style={styles.input}
      />
    </>
  );
}
```

Add state:

```tsx
const [targetAmountStr, setTargetAmountStr] = useState(
  envelope?.targetAmountCents ? String(envelope.targetAmountCents / 100) : '',
);
const [targetDate, setTargetDate] = useState(envelope?.targetDate ?? '');
```

When saving, include:

```tsx
targetAmountCents: envelopeType === 'sinking_fund' && targetAmountStr
  ? Math.round(parseFloat(targetAmountStr.replace(',', '.')) * 100)
  : null,
targetDate: envelopeType === 'sinking_fund' && targetDate ? targetDate : null,
```

- [ ] **Step 4: Add Sinking Funds entry point to DashboardScreen**

In `src/presentation/screens/dashboard/DashboardScreen.tsx`, add a Sinking Funds button below the BabyStepsCard:

```tsx
{
  /* Sinking Funds entry */
}
<TouchableOpacity
  style={[styles.sinkingFundsRow, { backgroundColor: colors.secondaryContainer }]}
  onPress={() => navigation.navigate('SinkingFunds')}
  testID="sinking-funds-entry"
>
  <Text variant="labelLarge" style={{ color: colors.onSecondaryContainer }}>
    Sinking Funds
  </Text>
  <Text style={{ color: colors.onSecondaryContainer }}>›</Text>
</TouchableOpacity>;
```

Add to StyleSheet:

```typescript
sinkingFundsRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginHorizontal: spacing.base,
  marginBottom: spacing.sm,
  padding: spacing.base,
  borderRadius: radius.lg,
},
```

Add imports: `TouchableOpacity` from `'react-native'`, `radius` from tokens.

- [ ] **Step 5: Run full suite**

```bash
npm run typecheck && npm test 2>&1 | tail -10
```

Expected: typecheck clean, all 559+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/navigation/types.ts \
        src/presentation/navigation/DashboardStackNavigator.tsx \
        src/presentation/screens/dashboard/DashboardScreen.tsx
git commit -m "feat(nav): add SinkingFunds screen to DashboardStack + entry point on Dashboard"
```

- [ ] **Step 7: Commit AddEditEnvelope changes separately**

```bash
git add src/presentation/screens/dashboard/AddEditEnvelopeScreen.tsx
git commit -m "feat(ui): show target amount + date fields for sinking_fund envelope type"
```
