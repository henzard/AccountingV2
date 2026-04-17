# StatCard Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a reusable `StatCard` component that displays a label + large metric value (currency or plain text), and replace the four ad-hoc duplicates across DebtDetailScreen and SnowballDashboardScreen.

**Architecture:** A single `StatCard` component in `src/presentation/components/shared/` that accepts a label, a pre-formatted value string, and an optional sub-label. Replace usages in debt screens. No new routes or migrations needed.

**Tech Stack:** React Native, react-native-paper MD3, TypeScript, Jest + @testing-library/react-native, existing token system.

---

## File Structure

| File                                                                | Action | Purpose                                                  |
| ------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| `src/presentation/components/shared/StatCard.tsx`                   | Create | Reusable stat display: label + value + optional sublabel |
| `src/presentation/components/shared/__tests__/StatCard.test.tsx`    | Create | Render tests                                             |
| `src/presentation/screens/debtSnowball/DebtDetailScreen.tsx`        | Modify | Replace inline stat blocks with StatCard                 |
| `src/presentation/screens/debtSnowball/SnowballDashboardScreen.tsx` | Modify | Replace inline stat blocks with StatCard                 |

---

## Task 1: StatCard component (TDD)

**Files:**

- Create: `src/presentation/components/shared/StatCard.tsx`
- Create: `src/presentation/components/shared/__tests__/StatCard.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/presentation/components/shared/__tests__/StatCard.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StatCard } from '../StatCard';

jest.mock('../../../theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      surface: '#fff',
      onSurface: '#000',
      onSurfaceVariant: '#666',
      primaryContainer: '#e8def8',
      onPrimaryContainer: '#21005d',
    },
  }),
}));

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Total Paid" value="R12,000.00" />);
    expect(screen.getByText('Total Paid')).toBeTruthy();
    expect(screen.getByText('R12,000.00')).toBeTruthy();
  });

  it('renders sublabel when provided', () => {
    render(<StatCard label="Balance" value="R5,000.00" sublabel="outstanding" />);
    expect(screen.getByText('outstanding')).toBeTruthy();
  });

  it('does not render sublabel when not provided', () => {
    render(<StatCard label="Balance" value="R5,000.00" />);
    expect(screen.queryByTestId('stat-card-sublabel')).toBeNull();
  });

  it('applies testID', () => {
    render(<StatCard label="Score" value="87" testID="score-stat" />);
    expect(screen.getByTestId('score-stat')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
npx jest src/presentation/components/shared/__tests__/StatCard.test.tsx
```

Expected: FAIL — `StatCard` not found.

- [ ] **Step 3: Implement StatCard**

Create `src/presentation/components/shared/StatCard.tsx`:

```tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

export interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  /** Override card background color. Defaults to colors.surface. */
  backgroundColor?: string;
  /** Override value text color. Defaults to colors.onSurface. */
  valueColor?: string;
  testID?: string;
}

export function StatCard({
  label,
  value,
  sublabel,
  backgroundColor,
  valueColor,
  testID,
}: StatCardProps): React.JSX.Element {
  const { colors } = useAppTheme();

  return (
    <Surface
      style={[styles.card, { backgroundColor: backgroundColor ?? colors.surface }]}
      elevation={1}
      testID={testID}
    >
      <Text
        style={[styles.label, { color: colors.onSurfaceVariant }]}
        variant="labelSmall"
        numberOfLines={1}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        style={[styles.value, { color: valueColor ?? colors.onSurface }]}
        variant="headlineSmall"
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {sublabel !== undefined && (
        <Text
          style={[styles.sublabel, { color: colors.onSurfaceVariant }]}
          variant="bodySmall"
          testID="stat-card-sublabel"
        >
          {sublabel}
        </Text>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.base,
  },
  label: {
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  value: {
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  sublabel: {
    marginTop: spacing.xs,
    opacity: 0.75,
  },
});
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest src/presentation/components/shared/__tests__/StatCard.test.tsx
```

Expected: 4 tests, all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/components/shared/StatCard.tsx \
        src/presentation/components/shared/__tests__/StatCard.test.tsx
git commit -m "feat(ui): StatCard shared component — label + value + optional sublabel"
```

---

## Task 2: Replace duplicates in DebtDetailScreen

**Files:**

- Modify: `src/presentation/screens/debtSnowball/DebtDetailScreen.tsx`

- [ ] **Step 1: Find the inline stat blocks**

```bash
grep -n "Outstanding\|Total paid\|Min payment\|statValue\|statLabel" \
  src/presentation/screens/debtSnowball/DebtDetailScreen.tsx | head -20
```

Note the line numbers of the three stat blocks.

- [ ] **Step 2: Replace with StatCard**

Add import at top of `DebtDetailScreen.tsx`:

```tsx
import { StatCard } from '../../components/shared/StatCard';
import { formatCurrency } from '../../utils/currency';
```

Replace the three inline stat `<View>` blocks with a row of `StatCard` components:

```tsx
<View style={styles.statsRow}>
  <StatCard
    label="Outstanding"
    value={formatCurrency(debt.outstandingBalanceCents)}
    testID="stat-outstanding"
  />
  <View style={styles.statSpacer} />
  <StatCard
    label="Total Paid"
    value={formatCurrency(debt.totalPaidCents)}
    testID="stat-total-paid"
  />
  <View style={styles.statSpacer} />
  <StatCard
    label="Min Payment"
    value={formatCurrency(debt.minimumPaymentCents)}
    sublabel="/ month"
    testID="stat-min-payment"
  />
</View>
```

Add to StyleSheet:

```typescript
statsRow: {
  flexDirection: 'row',
  paddingHorizontal: spacing.base,
  paddingVertical: spacing.sm,
  gap: spacing.sm,
},
statSpacer: { width: spacing.sm },
```

Remove the now-unused inline stat styles (`statCard`, `statLabel`, `statValue`, etc.) from the StyleSheet.

- [ ] **Step 3: Run tests**

```bash
npm run typecheck && npx jest --testPathPattern="DebtDetail" 2>&1 | tail -10
```

Expected: clean typecheck, tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/debtSnowball/DebtDetailScreen.tsx
git commit -m "refactor(debt): replace inline stat blocks with StatCard in DebtDetailScreen"
```

---

## Task 3: Replace duplicates in SnowballDashboardScreen

**Files:**

- Modify: `src/presentation/screens/debtSnowball/SnowballDashboardScreen.tsx`

- [ ] **Step 1: Find the inline stat blocks**

```bash
grep -n "paid off\|remaining\|statValue\|statLabel\|toLocaleString\|formatCurrency" \
  src/presentation/screens/debtSnowball/SnowballDashboardScreen.tsx | head -20
```

- [ ] **Step 2: Replace with StatCard**

Add import:

```tsx
import { StatCard } from '../../components/shared/StatCard';
```

Replace the summary stat section with:

```tsx
<View style={styles.statsRow}>
  <StatCard
    label="Total Remaining"
    value={formatCurrency(totalRemainingCents)}
    testID="stat-total-remaining"
  />
  <View style={{ width: spacing.sm }} />
  <StatCard label="Paid Off" value={formatCurrency(totalPaidCents)} testID="stat-total-paid" />
</View>
```

Remove old inline stat styles.

- [ ] **Step 3: Run full suite**

```bash
npm run typecheck && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/debtSnowball/SnowballDashboardScreen.tsx
git commit -m "refactor(snowball): replace inline stat blocks with StatCard in SnowballDashboardScreen"
```
