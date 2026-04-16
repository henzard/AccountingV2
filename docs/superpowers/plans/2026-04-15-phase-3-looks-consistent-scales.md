# Phase 3 — "Looks Consistent + Scales" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract five missing UI primitives, flatten transaction rows, consolidate sync stores, and delete the empty DI directory — removing ~200 LOC of duplicated JSX and raising visual consistency.

**Architecture:** Each primitive lives in `src/presentation/components/shared/` (or co-located for `OnboardingStepLayout`). Every extraction follows the same pattern: write a focused component test first, build the component, then swap in every call site one file at a time. The sync slice consolidation replaces `networkStore.ts` and removes sync fields from `appStore.ts` into a dedicated `syncStore.ts`.

**Tech Stack:** React Native, Expo SDK 55, React Native Paper (MD3), TypeScript strict, Jest + @testing-library/react-native, Zustand

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/presentation/components/shared/SectionHeader.tsx` | Create | Unified section header (filled vs sparse, optional divider) |
| `src/presentation/components/shared/__tests__/SectionHeader.test.tsx` | Create | Tests for SectionHeader |
| `src/presentation/components/shared/KPIRow.tsx` | Create | 3-column Allocated/Spent/Remaining strip |
| `src/presentation/components/shared/__tests__/KPIRow.test.tsx` | Create | Tests for KPIRow |
| `src/presentation/components/shared/PickerField.tsx` | Create | Bordered tap-to-pick trigger (envelope + date variants) |
| `src/presentation/components/shared/__tests__/PickerField.test.tsx` | Create | Tests for PickerField |
| `src/presentation/screens/auth/onboarding/OnboardingStepLayout.tsx` | Create | KeyboardAvoidingView + ScrollView + Title + Subtitle + CTA chrome |
| `src/presentation/screens/auth/onboarding/__tests__/OnboardingStepLayout.test.tsx` | Create | Tests for OnboardingStepLayout |
| `src/presentation/components/shared/ListRow.tsx` | Create | Flat list row without Surface elevation |
| `src/presentation/components/shared/__tests__/ListRow.test.tsx` | Create | Tests for ListRow |
| `src/presentation/stores/syncStore.ts` | Create | Merged isOnline + pendingSyncCount + syncStatus + lastSyncAt |
| `src/presentation/stores/__tests__/syncStore.test.ts` | Create | Tests for syncStore |
| `src/presentation/screens/transactions/TransactionListScreen.tsx` | Modify | Use SectionHeader + ListRow, add Divider separator |
| `src/presentation/screens/budgets/BudgetScreen.tsx` | Modify | Use SectionHeader |
| `src/presentation/screens/babySteps/BabyStepsScreen.tsx` | Modify | Use SectionHeader |
| `src/presentation/screens/dashboard/DashboardScreen.tsx` | Modify | Use KPIRow |
| `src/presentation/screens/transactions/AddTransactionScreen.tsx` | Modify | Use PickerField for envelope + date triggers |
| `src/presentation/screens/auth/onboarding/IncomeStep.tsx` | Modify | Use OnboardingStepLayout |
| `src/presentation/screens/auth/onboarding/PaydayStep.tsx` | Modify | Use OnboardingStepLayout |
| `src/presentation/screens/auth/onboarding/ExpenseCategoriesStep.tsx` | Modify | Use OnboardingStepLayout (avoidKeyboard=false) |
| `src/presentation/stores/appStore.ts` | Modify | Remove syncStatus, lastSyncAt, pendingSyncCount and their setters |
| `src/presentation/stores/appStore.test.ts` | Modify | Remove tests for migrated sync fields |
| `src/presentation/components/shared/OfflineBanner.tsx` | Modify | Import isOnline from syncStore |
| `src/presentation/screens/slipScanning/SlipCaptureScreen.tsx` | Modify | Import isOnline from syncStore |
| `App.tsx` | Modify | Use subscribeNetworkChanges() from syncStore; call syncStore.reset() on sign-out |
| `src/presentation/stores/networkStore.ts` | Delete | Replaced by syncStore |
| `src/infrastructure/di/.gitkeep` | Delete | Remove empty DI directory |

---

## Task 1: SectionHeader Primitive

**Files:**
- Create: `src/presentation/components/shared/SectionHeader.tsx`
- Create: `src/presentation/components/shared/__tests__/SectionHeader.test.tsx`
- Modify: `src/presentation/screens/transactions/TransactionListScreen.tsx:109-117`
- Modify: `src/presentation/screens/budgets/BudgetScreen.tsx:84-94`
- Modify: `src/presentation/screens/babySteps/BabyStepsScreen.tsx` (lines ~104-111, ~126-132)

- [ ] **Step 1: Write the failing test**

Create `src/presentation/components/shared/__tests__/SectionHeader.test.tsx`:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { SectionHeader } from '../SectionHeader';

describe('SectionHeader', () => {
  it('renders title in upper case', () => {
    const { getByText } = render(<SectionHeader title="january" />);
    expect(getByText('JANUARY')).toBeTruthy();
  });

  it('applies testID', () => {
    const { getByTestId } = render(<SectionHeader title="foo" testID="sh" />);
    expect(getByTestId('sh')).toBeTruthy();
  });

  it('renders Divider when showDivider is true', () => {
    const { getByTestId } = render(<SectionHeader title="foo" showDivider testID="sh" />);
    expect(getByTestId('sh-divider')).toBeTruthy();
  });

  it('does not render Divider by default', () => {
    const { queryByTestId } = render(<SectionHeader title="foo" testID="sh" />);
    expect(queryByTestId('sh-divider')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest --testPathPatterns="SectionHeader.test" --no-coverage
```

Expected: FAIL — "SectionHeader" not found.

- [ ] **Step 3: Create SectionHeader component**

Create `src/presentation/components/shared/SectionHeader.tsx`:

```tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Divider } from 'react-native-paper';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing } from '../../theme/tokens';

interface SectionHeaderProps {
  title: string;
  /**
   * filled=true  → surfaceVariant background + labelMedium (for sticky list headers)
   * filled=false → transparent background + labelSmall   (for page-level sections)
   */
  filled?: boolean;
  /** Render a 1 px outlineVariant divider below the title. */
  showDivider?: boolean;
  testID?: string;
}

export function SectionHeader({
  title,
  filled = false,
  showDivider = false,
  testID,
}: SectionHeaderProps): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: filled ? colors.surfaceVariant : 'transparent' },
      ]}
      testID={testID}
    >
      <Text
        variant={filled ? 'labelMedium' : 'labelSmall'}
        style={[
          filled ? styles.filledTitle : styles.sparseTitle,
          { color: colors.onSurfaceVariant },
        ]}
      >
        {title.toUpperCase()}
      </Text>
      {showDivider && (
        <Divider
          style={{ backgroundColor: colors.outlineVariant }}
          testID={testID ? `${testID}-divider` : 'sh-divider'}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
  },
  filledTitle: { letterSpacing: 0.8 },
  sparseTitle: { letterSpacing: 1.2, marginBottom: spacing.xs },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest --testPathPatterns="SectionHeader.test" --no-coverage
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Replace ad-hoc header in TransactionListScreen**

Open `src/presentation/screens/transactions/TransactionListScreen.tsx`.

Add import at the top (after existing imports):
```tsx
import { SectionHeader } from '../../components/shared/SectionHeader';
```

Replace lines 109–117 (the inline renderSectionHeader):
```tsx
// BEFORE:
renderSectionHeader={({ section }) => (
  <View style={[styles.sectionHeader, { backgroundColor: colors.surfaceVariant }]}>
    <Text
      variant="labelMedium"
      style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}
    >
      {section.title}
    </Text>
  </View>
)}

// AFTER:
renderSectionHeader={({ section }) => (
  <SectionHeader title={section.title} filled />
)}
```

Remove from `StyleSheet.create` (lines ~168-172, the now-unused styles):
```tsx
// DELETE these two entries:
sectionHeader: {
  paddingHorizontal: spacing.base,
  paddingVertical: spacing.xs,
},
sectionTitle: { letterSpacing: 0.8 },
```

- [ ] **Step 6: Replace ad-hoc header in BudgetScreen**

Open `src/presentation/screens/budgets/BudgetScreen.tsx`.

Add import:
```tsx
import { SectionHeader } from '../../components/shared/SectionHeader';
```

Replace lines 84–94 (the inline renderSectionHeader):
```tsx
// BEFORE:
renderSectionHeader={({ section: { title } }) => (
  <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
    <Text
      variant="labelSmall"
      style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}
    >
      {title.toUpperCase()}
    </Text>
    <Divider style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
  </View>
)}

// AFTER:
renderSectionHeader={({ section: { title } }) => (
  <SectionHeader title={title} showDivider />
)}
```

Remove now-unused styles from `StyleSheet.create`:
```tsx
// DELETE:
sectionHeader: {
  paddingHorizontal: spacing.base,
  paddingTop: spacing.base,
  paddingBottom: spacing.xs,
},
sectionTitle: {
  letterSpacing: 1.2,
  marginBottom: spacing.xs,
},
divider: {},
```

If `Divider` was only used in the section header, remove it from the imports at the top.

- [ ] **Step 7: Replace ad-hoc labels in BabyStepsScreen**

Open `src/presentation/screens/babySteps/BabyStepsScreen.tsx`.

Add import:
```tsx
import { SectionHeader } from '../../components/shared/SectionHeader';
```

Find every occurrence of the pattern (there are 2–3):
```tsx
// BEFORE:
<Text
  variant="labelSmall"
  style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}
>
  COMPLETED
</Text>

// AFTER:
<SectionHeader title="COMPLETED" />
```

Repeat for "CURRENT STEP" and any other section labels using the same pattern.

Remove now-unused style entries (`sectionLabel`) from `StyleSheet.create`.

- [ ] **Step 8: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: same number of passing tests as before this task (no regressions).

- [ ] **Step 9: Commit**

```bash
git add src/presentation/components/shared/SectionHeader.tsx \
        src/presentation/components/shared/__tests__/SectionHeader.test.tsx \
        src/presentation/screens/transactions/TransactionListScreen.tsx \
        src/presentation/screens/budgets/BudgetScreen.tsx \
        src/presentation/screens/babySteps/BabyStepsScreen.tsx
git commit -m "feat(ui): extract SectionHeader primitive — unify 3 ad-hoc implementations"
```

---

## Task 2: KPIRow Primitive (Dashboard Summary Strip)

**Files:**
- Create: `src/presentation/components/shared/KPIRow.tsx`
- Create: `src/presentation/components/shared/__tests__/KPIRow.test.tsx`
- Modify: `src/presentation/screens/dashboard/DashboardScreen.tsx:92-139`

- [ ] **Step 1: Write the failing test**

Create `src/presentation/components/shared/__tests__/KPIRow.test.tsx`:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { KPIRow } from '../KPIRow';

const items = [
  { label: 'Allocated', valueCents: 500000 },
  { label: 'Spent', valueCents: 120050 },
  { label: 'Remaining', valueCents: 379950, errorWhenNegative: true },
];

describe('KPIRow', () => {
  it('renders all item labels in upper case', () => {
    const { getByText } = render(<KPIRow items={items} />);
    expect(getByText('ALLOCATED')).toBeTruthy();
    expect(getByText('SPENT')).toBeTruthy();
    expect(getByText('REMAINING')).toBeTruthy();
  });

  it('applies testID to the surface', () => {
    const { getByTestId } = render(<KPIRow items={items} testID="kpi" />);
    expect(getByTestId('kpi')).toBeTruthy();
  });

  it('renders without crashing when items list is empty', () => {
    expect(() => render(<KPIRow items={[]} />)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest --testPathPatterns="KPIRow.test" --no-coverage
```

Expected: FAIL — "KPIRow" not found.

- [ ] **Step 3: Create KPIRow component**

Create `src/presentation/components/shared/KPIRow.tsx`:

```tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import { CurrencyText } from './CurrencyText';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing, radius } from '../../theme/tokens';

export interface KPIItem {
  label: string;
  valueCents: number;
  /** Show error color when valueCents is negative. Default: false */
  errorWhenNegative?: boolean;
}

interface KPIRowProps {
  items: KPIItem[];
  testID?: string;
}

export function KPIRow({ items, testID }: KPIRowProps): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <Surface
      style={[styles.surface, { backgroundColor: colors.primaryContainer }]}
      elevation={1}
      testID={testID}
    >
      {items.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 && (
            <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
          )}
          <View style={styles.item}>
            <Text
              variant="labelSmall"
              style={[styles.label, { color: colors.onPrimaryContainer }]}
            >
              {item.label.toUpperCase()}
            </Text>
            <CurrencyText
              amountCents={item.valueCents}
              style={{
                ...styles.value,
                color:
                  item.errorWhenNegative && item.valueCents < 0
                    ? colors.error
                    : colors.onPrimaryContainer,
              }}
            />
          </View>
        </React.Fragment>
      ))}
    </Surface>
  );
}

const styles = StyleSheet.create({
  surface: {
    flexDirection: 'row',
    marginHorizontal: spacing.base,
    marginTop: spacing.base,
    borderRadius: radius.lg,
    padding: spacing.base,
  },
  item: { flex: 1, alignItems: 'center' },
  label: { letterSpacing: 0.8, marginBottom: spacing.xs },
  value: {
    fontSize: 24,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontVariant: ['tabular-nums'],
  },
  divider: { width: 1, marginVertical: spacing.xs },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest --testPathPatterns="KPIRow.test" --no-coverage
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Swap KPIRow into DashboardScreen**

Open `src/presentation/screens/dashboard/DashboardScreen.tsx`.

Add import:
```tsx
import { KPIRow } from '../../components/shared/KPIRow';
```

Replace lines 92–139 (the inline `<Surface>` summary block):
```tsx
// BEFORE:
{envelopes.length > 0 && (
  <Surface
    style={[styles.summary, { backgroundColor: colors.primaryContainer }]}
    elevation={1}
  >
    <View style={styles.summaryItem}>
      <Text
        variant="labelSmall"
        style={[styles.summaryLabel, { color: colors.onPrimaryContainer }]}
      >
        ALLOCATED
      </Text>
      <CurrencyText
        amountCents={totalAllocated}
        style={{ ...styles.summaryValue, color: colors.onPrimaryContainer }}
      />
    </View>
    <View style={[styles.summaryDivider, { backgroundColor: colors.outlineVariant }]} />
    <View style={styles.summaryItem}>
      <Text
        variant="labelSmall"
        style={[styles.summaryLabel, { color: colors.onPrimaryContainer }]}
      >
        SPENT
      </Text>
      <CurrencyText
        amountCents={totalSpent}
        style={{ ...styles.summaryValue, color: colors.onPrimaryContainer }}
      />
    </View>
    <View style={[styles.summaryDivider, { backgroundColor: colors.outlineVariant }]} />
    <View style={styles.summaryItem}>
      <Text
        variant="labelSmall"
        style={[styles.summaryLabel, { color: colors.onPrimaryContainer }]}
      >
        REMAINING
      </Text>
      <CurrencyText
        amountCents={totalRemaining}
        style={{
          ...styles.summaryValue,
          color: totalRemaining < 0 ? colors.error : colors.onPrimaryContainer,
        }}
      />
    </View>
  </Surface>
)}

// AFTER:
{envelopes.length > 0 && (
  <KPIRow
    items={[
      { label: 'Allocated', valueCents: totalAllocated },
      { label: 'Spent', valueCents: totalSpent },
      { label: 'Remaining', valueCents: totalRemaining, errorWhenNegative: true },
    ]}
    testID="dashboard-kpi-row"
  />
)}
```

Remove from imports: `Surface` (if it's no longer used elsewhere in the file), `CurrencyText` (if no other usage).

Remove from `StyleSheet.create` the now-unused styles: `summary`, `summaryItem`, `summaryLabel`, `summaryValue`, `summaryDivider`.

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: same pass count, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/components/shared/KPIRow.tsx \
        src/presentation/components/shared/__tests__/KPIRow.test.tsx \
        src/presentation/screens/dashboard/DashboardScreen.tsx
git commit -m "feat(ui): extract KPIRow primitive — replace inline Dashboard summary Surface"
```

---

## Task 3: PickerField Primitive

**Files:**
- Create: `src/presentation/components/shared/PickerField.tsx`
- Create: `src/presentation/components/shared/__tests__/PickerField.test.tsx`
- Modify: `src/presentation/screens/transactions/AddTransactionScreen.tsx:134-165,199-216`

- [ ] **Step 1: Write the failing test**

Create `src/presentation/components/shared/__tests__/PickerField.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PickerField } from '../PickerField';

describe('PickerField', () => {
  it('shows value when provided', () => {
    const { getByText } = render(
      <PickerField value="Groceries" onPress={jest.fn()} />,
    );
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('shows placeholder when no value', () => {
    const { getByText } = render(
      <PickerField placeholder="Select envelope…" onPress={jest.fn()} />,
    );
    expect(getByText('Select envelope…')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <PickerField placeholder="Pick one" onPress={onPress} testID="pf" />,
    );
    fireEvent.press(getByTestId('pf'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows trailing text when provided', () => {
    const { getByText } = render(
      <PickerField value="Groceries" trailing="R120 left" onPress={jest.fn()} />,
    );
    expect(getByText('R120 left')).toBeTruthy();
  });

  it('shows inline label when label prop is provided', () => {
    const { getByText } = render(
      <PickerField label="Date" value="8 Apr 2026" onPress={jest.fn()} />,
    );
    expect(getByText('Date')).toBeTruthy();
    expect(getByText('8 Apr 2026')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest --testPathPatterns="PickerField.test" --no-coverage
```

Expected: FAIL — "PickerField" not found.

- [ ] **Step 3: Create PickerField component**

Create `src/presentation/components/shared/PickerField.tsx`:

```tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing, radius } from '../../theme/tokens';

interface PickerFieldProps {
  /**
   * When set, renders as "inline label | value" row (date-picker style).
   * When absent, renders as "value fills space | trailing | chevron" (selection style).
   */
  label?: string;
  /** Placeholder text when value is absent (selection style only). */
  placeholder?: string;
  /** Currently selected value. */
  value?: string;
  /** Secondary text rendered to the right (e.g. "R120 left"). */
  trailing?: string;
  /** Color for trailing text. Defaults to onSurfaceVariant. */
  trailingColor?: string;
  /** Show › chevron at trailing edge (selection style). Default: false */
  showChevron?: boolean;
  onPress: () => void;
  testID?: string;
}

export function PickerField({
  label,
  placeholder,
  value,
  trailing,
  trailingColor,
  showChevron = false,
  onPress,
  testID,
}: PickerFieldProps): React.JSX.Element {
  const { colors } = useAppTheme();

  return (
    <TouchableRipple
      onPress={onPress}
      style={[styles.trigger, { borderColor: colors.outline }]}
      testID={testID}
    >
      <View style={styles.inner}>
        {label !== undefined ? (
          // Inline-label style (date picker): "Date    8 Apr 2026"
          <>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
              {label}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
              {value ?? placeholder ?? ''}
            </Text>
          </>
        ) : (
          // Selection style (envelope picker): value fills width, trailing + chevron on right
          <>
            <Text
              variant="bodyLarge"
              style={[
                styles.selectionValue,
                { color: value !== undefined ? colors.onSurface : colors.onSurfaceVariant },
              ]}
            >
              {value ?? placeholder ?? ''}
            </Text>
            {trailing !== undefined && (
              <Text
                variant="bodySmall"
                style={{
                  color: trailingColor ?? colors.onSurfaceVariant,
                  marginRight: spacing.sm,
                }}
              >
                {trailing}
              </Text>
            )}
            {showChevron && (
              <Text style={{ color: colors.onSurfaceVariant }}>›</Text>
            )}
          </>
        )}
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectionValue: { flex: 1 },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest --testPathPatterns="PickerField.test" --no-coverage
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Swap PickerField into AddTransactionScreen**

Open `src/presentation/screens/transactions/AddTransactionScreen.tsx`.

Add import:
```tsx
import { PickerField } from '../../components/shared/PickerField';
```

Replace the envelope picker trigger (lines ~134–165):
```tsx
// BEFORE:
<Text variant="labelLarge" style={[styles.label, { color: colors.onSurface }]}>
  Envelope
</Text>
<TouchableRipple
  onPress={() => setShowPicker(true)}
  style={[styles.pickerButton, { borderColor: colors.outline }]}
  testID="envelope-picker-trigger"
>
  <View style={styles.pickerInner}>
    <Text
      variant="bodyLarge"
      style={[
        { flex: 1 },
        selectedEnvelope ? { color: colors.onSurface } : { color: colors.onSurfaceVariant },
      ]}
    >
      {selectedEnvelope ? selectedEnvelope.name : 'Select envelope…'}
    </Text>
    {selectedEnvelope && (
      <Text
        variant="bodySmall"
        style={{
          color: balanceColor(selectedEnvelope),
          marginRight: spacing.sm,
        }}
      >
        {formatBalance(selectedEnvelope)} left
      </Text>
    )}
    <Text style={[styles.pickerChevron, { color: colors.onSurfaceVariant }]}>›</Text>
  </View>
</TouchableRipple>

// AFTER:
<Text variant="labelLarge" style={[styles.label, { color: colors.onSurface }]}>
  Envelope
</Text>
<PickerField
  placeholder="Select envelope…"
  value={selectedEnvelope?.name}
  trailing={selectedEnvelope ? `${formatBalance(selectedEnvelope)} left` : undefined}
  trailingColor={selectedEnvelope ? balanceColor(selectedEnvelope) : undefined}
  showChevron
  onPress={() => setShowPicker(true)}
  testID="envelope-picker-trigger"
/>
```

Replace the date picker trigger (lines ~199–216):
```tsx
// BEFORE:
<TouchableRipple
  onPress={() => setShowDatePicker(true)}
  style={[styles.dateButton, { borderColor: colors.outline }]}
  testID="date-picker-trigger"
>
  <View style={styles.pickerInner}>
    <Text
      variant="bodyMedium"
      style={[styles.dateLabel, { color: colors.onSurfaceVariant }]}
    >
      Date
    </Text>
    <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
      {format(transactionDate, 'd MMM yyyy')}
    </Text>
  </View>
</TouchableRipple>

// AFTER:
<PickerField
  label="Date"
  value={format(transactionDate, 'd MMM yyyy')}
  onPress={() => setShowDatePicker(true)}
  testID="date-picker-trigger"
/>
```

Remove from imports: `TouchableRipple` (if no longer used elsewhere in file).

Remove from `StyleSheet.create` the now-unused styles: `pickerButton`, `pickerInner`, `pickerChevron`, `dateButton`, `dateLabel` (verify each is actually unused first).

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: same pass count, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/components/shared/PickerField.tsx \
        src/presentation/components/shared/__tests__/PickerField.test.tsx \
        src/presentation/screens/transactions/AddTransactionScreen.tsx
git commit -m "feat(ui): extract PickerField primitive — replace inline picker triggers in AddTransactionScreen"
```

---

## Task 4: OnboardingStepLayout Primitive

Refactors **IncomeStep**, **PaydayStep**, and **ExpenseCategoriesStep** to share a common chrome. AllocateEnvelopesStep is excluded (too much unique inner layout — it requires its own ToAssign tracker).

**Files:**
- Create: `src/presentation/screens/auth/onboarding/OnboardingStepLayout.tsx`
- Create: `src/presentation/screens/auth/onboarding/__tests__/OnboardingStepLayout.test.tsx`
- Modify: `src/presentation/screens/auth/onboarding/IncomeStep.tsx`
- Modify: `src/presentation/screens/auth/onboarding/PaydayStep.tsx`
- Modify: `src/presentation/screens/auth/onboarding/ExpenseCategoriesStep.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/presentation/screens/auth/onboarding/__tests__/OnboardingStepLayout.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native-paper';
import { OnboardingStepLayout } from '../OnboardingStepLayout';

describe('OnboardingStepLayout', () => {
  it('renders title and subtitle', () => {
    const { getByText } = render(
      <OnboardingStepLayout title="Step title" subtitle="Step subtitle" onCta={jest.fn()}>
        <Text>child</Text>
      </OnboardingStepLayout>,
    );
    expect(getByText('Step title')).toBeTruthy();
    expect(getByText('Step subtitle')).toBeTruthy();
  });

  it('renders children', () => {
    const { getByText } = render(
      <OnboardingStepLayout title="T" subtitle="S" onCta={jest.fn()}>
        <Text>custom child</Text>
      </OnboardingStepLayout>,
    );
    expect(getByText('custom child')).toBeTruthy();
  });

  it('renders default CTA label "Next"', () => {
    const { getByText } = render(
      <OnboardingStepLayout title="T" subtitle="S" onCta={jest.fn()} />,
    );
    expect(getByText('Next')).toBeTruthy();
  });

  it('renders custom CTA label', () => {
    const { getByText } = render(
      <OnboardingStepLayout title="T" subtitle="S" ctaLabel="Save & Continue" onCta={jest.fn()} />,
    );
    expect(getByText('Save & Continue')).toBeTruthy();
  });

  it('calls onCta when CTA is pressed', () => {
    const onCta = jest.fn();
    const { getByText } = render(
      <OnboardingStepLayout title="T" subtitle="S" onCta={onCta} />,
    );
    fireEvent.press(getByText('Next'));
    expect(onCta).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest --testPathPatterns="OnboardingStepLayout.test" --no-coverage
```

Expected: FAIL — "OnboardingStepLayout" not found.

- [ ] **Step 3: Create OnboardingStepLayout component**

Create `src/presentation/screens/auth/onboarding/OnboardingStepLayout.tsx`:

```tsx
import React from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useAppTheme } from '../../../theme/useAppTheme';
import { spacing } from '../../../theme/tokens';

interface OnboardingStepLayoutProps {
  title: string;
  subtitle: string;
  /**
   * Wrap content in KeyboardAvoidingView.
   * Set false for steps that have no text inputs (e.g. chip pickers).
   * Default: true
   */
  avoidKeyboard?: boolean;
  /** CTA button label. Default: "Next" */
  ctaLabel?: string;
  onCta: () => void | Promise<void>;
  ctaLoading?: boolean;
  ctaDisabled?: boolean;
  children?: React.ReactNode;
}

export function OnboardingStepLayout({
  title,
  subtitle,
  avoidKeyboard = true,
  ctaLabel = 'Next',
  onCta,
  ctaLoading,
  ctaDisabled,
  children,
}: OnboardingStepLayoutProps): React.JSX.Element {
  const { colors } = useAppTheme();

  const scrollContent = (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text variant="headlineMedium" style={[styles.title, { color: colors.primary }]}>
        {title}
      </Text>
      <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
        {subtitle}
      </Text>
      {children}
      <Button
        mode="contained"
        onPress={onCta}
        loading={ctaLoading}
        disabled={ctaDisabled}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        {ctaLabel}
      </Button>
    </ScrollView>
  );

  if (!avoidKeyboard) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        {scrollContent}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {scrollContent}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.base },
  title: { fontFamily: 'PlusJakartaSans_700Bold' },
  subtitle: { marginBottom: spacing.base },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest --testPathPatterns="OnboardingStepLayout.test" --no-coverage
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Refactor IncomeStep**

Replace entire content of `src/presentation/screens/auth/onboarding/IncomeStep.tsx`:

```tsx
import React, { useState } from 'react';
import { TextInput, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppStore } from '../../../stores/appStore';
import { useAppTheme } from '../../../theme/useAppTheme';
import { spacing } from '../../../theme/tokens';
import type { OnboardingStackParamList } from './OnboardingNavigator';
import { OnboardingStepLayout } from './OnboardingStepLayout';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Income'>;

function toCents(str: string): number {
  const n = parseFloat(str.replace(',', '.'));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function IncomeStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();

  const [amountStr, setAmountStr] = useState('');
  const [error, setError] = useState<string | null>(null);

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

  return (
    <OnboardingStepLayout
      title="What's your monthly income?"
      subtitle="This helps us plan your budget envelopes."
      onCta={handleNext}
    >
      <TextInput
        label="Monthly income (R)"
        value={amountStr}
        onChangeText={setAmountStr}
        mode="outlined"
        style={{ backgroundColor: colors.surface }}
        keyboardType="decimal-pad"
        placeholder="0.00"
        left={<TextInput.Affix text="R" />}
      />
      {error !== null && (
        <HelperText type="error" visible>
          {error}
        </HelperText>
      )}
    </OnboardingStepLayout>
  );
}
```

Note: `StyleSheet` and `Platform`/`KeyboardAvoidingView`/`ScrollView` imports are removed — the layout handles them.
Also: `spacing` import may no longer be used — remove it if so.

- [ ] **Step 6: Refactor PaydayStep**

Replace entire content of `src/presentation/screens/auth/onboarding/PaydayStep.tsx`:

```tsx
import React, { useState } from 'react';
import { TextInput, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { db } from '../../../../data/local/db';
import { UpdateHouseholdPaydayDayUseCase } from '../../../../domain/households/UpdateHouseholdPaydayDayUseCase';
import { useAppStore } from '../../../stores/appStore';
import { useAppTheme } from '../../../theme/useAppTheme';
import { LoadingSplash } from '../../../components/shared/LoadingSplash';
import type { OnboardingStackParamList } from './OnboardingNavigator';
import { OnboardingStepLayout } from './OnboardingStepLayout';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Payday'>;

export function PaydayStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();
  const householdId = useAppStore((s) => s.householdId);
  const currentPaydayDay = useAppStore((s) => s.paydayDay);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);

  const [dayStr, setDayStr] = useState(String(currentPaydayDay));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!householdId) return <LoadingSplash />;

  const handleNext = async (): Promise<void> => {
    setError(null);
    const day = parseInt(dayStr, 10);
    if (isNaN(day) || day < 1 || day > 28) {
      setError('Enter a day between 1 and 28');
      return;
    }
    setLoading(true);
    try {
      const uc = new UpdateHouseholdPaydayDayUseCase(db, householdId, day);
      const result = await uc.execute();
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      setPaydayDay(day);
      navigation.navigate('MeterSetup');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingStepLayout
      title="When do you get paid?"
      subtitle="Your payday resets your budget period each month."
      onCta={handleNext}
      ctaLoading={loading}
      ctaDisabled={loading}
    >
      <TextInput
        label="Day of month (1–28)"
        value={dayStr}
        onChangeText={setDayStr}
        mode="outlined"
        style={{ backgroundColor: colors.surface }}
        keyboardType="numeric"
        disabled={loading}
        placeholder="25"
      />
      {error !== null && (
        <HelperText type="error" visible>
          {error}
        </HelperText>
      )}
    </OnboardingStepLayout>
  );
}
```

- [ ] **Step 7: Refactor ExpenseCategoriesStep**

Replace the return value inside `ExpenseCategoriesStep` (the entire function body from `return (` to the closing parenthesis):

```tsx
// Replace the return statement and remove the StyleSheet. The function signature,
// state declarations, and handlers stay exactly the same.

// New return:
return (
  <OnboardingStepLayout
    title="What do you spend money on?"
    subtitle="Select categories to create your spending envelopes. You can adjust amounts later."
    avoidKeyboard={false}
    onCta={handleNext}
  >
    <View style={styles.chipWrap}>
      {DEFAULT_CATEGORIES.map((cat) => (
        <Chip
          key={cat}
          selected={selected.has(cat)}
          onPress={() => toggleCategory(cat)}
          style={styles.chip}
          testID={`category-${cat}`}
        >
          {cat}
        </Chip>
      ))}
    </View>
    {error !== null && (
      <HelperText type="error" visible>
        {error}
      </HelperText>
    )}
  </OnboardingStepLayout>
);
```

Add import at top of file:
```tsx
import { OnboardingStepLayout } from './OnboardingStepLayout';
```

Update the `StyleSheet.create` — remove `container`, `title`, `subtitle`, `button`, `buttonContent` (now handled by layout). Keep only `chipWrap` and `chip`:
```tsx
const styles = StyleSheet.create({
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { marginBottom: spacing.xs },
});
```

Remove unused imports: `StyleSheet` (if no longer needed), `ScrollView`, `Button`, `Text` — keep `View`, `Chip`, `HelperText`, `useNavigation`, `spacing`, `useAppTheme`, `OnboardingNavigator` type.

- [ ] **Step 8: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: same pass count.

- [ ] **Step 9: Commit**

```bash
git add src/presentation/screens/auth/onboarding/OnboardingStepLayout.tsx \
        src/presentation/screens/auth/onboarding/__tests__/OnboardingStepLayout.test.tsx \
        src/presentation/screens/auth/onboarding/IncomeStep.tsx \
        src/presentation/screens/auth/onboarding/PaydayStep.tsx \
        src/presentation/screens/auth/onboarding/ExpenseCategoriesStep.tsx
git commit -m "feat(ui): extract OnboardingStepLayout — refactor Income, Payday, ExpenseCategories steps"
```

---

## Task 5: ListRow + Flatten Transaction Rows

**Files:**
- Create: `src/presentation/components/shared/ListRow.tsx`
- Create: `src/presentation/components/shared/__tests__/ListRow.test.tsx`
- Modify: `src/presentation/screens/transactions/TransactionListScreen.tsx:119-148`

- [ ] **Step 1: Write the failing test**

Create `src/presentation/components/shared/__tests__/ListRow.test.tsx`:

```tsx
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { ListRow } from '../ListRow';

describe('ListRow', () => {
  it('renders title', () => {
    const { getByText } = render(<ListRow title="Checkers" />);
    expect(getByText('Checkers')).toBeTruthy();
  });

  it('renders subtitle when provided', () => {
    const { getByText } = render(<ListRow title="Checkers" subtitle="Groceries" />);
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('does not render subtitle when omitted', () => {
    const { queryByTestId } = render(<ListRow title="Checkers" testID="row" />);
    expect(queryByTestId('row-subtitle')).toBeNull();
  });

  it('renders trailing content', () => {
    const { getByText } = render(
      <ListRow title="T" trailing={<Text>R120</Text>} />,
    );
    expect(getByText('R120')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<ListRow title="T" onPress={onPress} testID="row" />);
    fireEvent.press(getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('applies testID to the container', () => {
    const { getByTestId } = render(<ListRow title="T" testID="my-row" />);
    expect(getByTestId('my-row')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest --testPathPatterns="ListRow.test" --no-coverage
```

Expected: FAIL — "ListRow" not found.

- [ ] **Step 3: Create ListRow component**

Create `src/presentation/components/shared/ListRow.tsx`:

```tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing } from '../../theme/tokens';

interface ListRowProps {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
}

export function ListRow({ title, subtitle, trailing, onPress, testID }: ListRowProps): React.JSX.Element {
  const { colors } = useAppTheme();

  const content = (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text
          variant="bodyLarge"
          style={[styles.title, { color: colors.onSurface }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle !== undefined && (
          <Text
            variant="bodySmall"
            style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
            testID={testID ? `${testID}-subtitle` : undefined}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </View>
  );

  if (onPress !== undefined) {
    return (
      <TouchableRipple onPress={onPress} testID={testID}>
        {content}
      </TouchableRipple>
    );
  }

  return <View testID={testID}>{content}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  left: { flex: 1, marginRight: spacing.base },
  title: { fontFamily: 'PlusJakartaSans_600SemiBold' },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest --testPathPatterns="ListRow.test" --no-coverage
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Flatten rows in TransactionListScreen**

Open `src/presentation/screens/transactions/TransactionListScreen.tsx`.

Add imports:
```tsx
import { Divider } from 'react-native-paper';
import { ListRow } from '../../components/shared/ListRow';
```

Replace the `renderItem` lambda (lines ~119–148) with a flat `ListRow` plus a `CurrencyText`+`IconButton` trailing node:
```tsx
renderItem={({ item }) => (
  <ListRow
    title={item.payee ?? 'Unknown'}
    subtitle={envelopeNames.get(item.envelopeId) ?? '—'}
    trailing={
      <View style={styles.rowTrailing}>
        <CurrencyText
          amountCents={item.amountCents}
          style={styles.amount}
        />
        <IconButton
          icon="delete-outline"
          iconColor={colors.error}
          size={20}
          onPress={() => handleDelete(item)}
          testID={`delete-tx-${item.id}`}
        />
      </View>
    }
    testID={`tx-row-${item.id}`}
  />
)}
```

Add `ItemSeparatorComponent` to the `SectionList` props (right after `renderItem`):
```tsx
ItemSeparatorComponent={() => (
  <Divider style={{ backgroundColor: colors.outlineVariant }} />
)}
```

Update `StyleSheet.create` — remove `row`, `rowLeft`, `payee`, `envelopeName`. Add new styles:
```tsx
rowTrailing: {
  flexDirection: 'row',
  alignItems: 'center',
},
amount: {
  fontSize: 14,
  fontFamily: 'PlusJakartaSans_700Bold',
  color: colors.error,   // NOTE: colors is not available here — move to inline style
},
```

Wait — `StyleSheet.create` can't use dynamic `colors`. Keep the static parts in StyleSheet and pass color inline:

In `StyleSheet.create`:
```tsx
rowTrailing: {
  flexDirection: 'row',
  alignItems: 'center',
},
amount: {
  fontSize: 14,
  fontFamily: 'PlusJakartaSans_700Bold',
},
```

In the JSX, pass `color: colors.error` inline:
```tsx
<CurrencyText
  amountCents={item.amountCents}
  style={[styles.amount, { color: colors.error }]}
/>
```

Remove now-unused import of `Surface` (if no longer used elsewhere).

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: same pass count.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/components/shared/ListRow.tsx \
        src/presentation/components/shared/__tests__/ListRow.test.tsx \
        src/presentation/screens/transactions/TransactionListScreen.tsx
git commit -m "feat(ui): extract ListRow + flatten transaction rows — remove per-row Surface elevation"
```

---

## Task 6: Sync Slice Consolidation

Merges `networkStore.ts` (isOnline) and `appStore.ts` sync fields (pendingSyncCount, syncStatus, lastSyncAt) into a single `syncStore.ts`.

**Files:**
- Create: `src/presentation/stores/syncStore.ts`
- Create: `src/presentation/stores/__tests__/syncStore.test.ts`
- Modify: `src/presentation/stores/appStore.ts` (remove sync fields)
- Modify: `src/presentation/stores/appStore.test.ts` (remove sync field tests)
- Modify: `src/presentation/components/shared/OfflineBanner.tsx`
- Modify: `src/presentation/screens/slipScanning/SlipCaptureScreen.tsx`
- Modify: `App.tsx`
- Delete: `src/presentation/stores/networkStore.ts`

- [ ] **Step 1: Write the failing test**

Create `src/presentation/stores/__tests__/syncStore.test.ts`:

```ts
import { useSyncStore } from '../syncStore';

describe('syncStore', () => {
  beforeEach(() => {
    useSyncStore.setState({
      isOnline: true,
      pendingSyncCount: 0,
      syncStatus: 'idle',
      lastSyncAt: null,
    });
  });

  it('setIsOnline updates isOnline', () => {
    useSyncStore.getState().setIsOnline(false);
    expect(useSyncStore.getState().isOnline).toBe(false);
  });

  it('setPendingSyncCount updates pendingSyncCount', () => {
    useSyncStore.getState().setPendingSyncCount(3);
    expect(useSyncStore.getState().pendingSyncCount).toBe(3);
  });

  it('setSyncStatus updates syncStatus', () => {
    useSyncStore.getState().setSyncStatus('syncing');
    expect(useSyncStore.getState().syncStatus).toBe('syncing');
  });

  it('setLastSyncAt updates lastSyncAt', () => {
    useSyncStore.getState().setLastSyncAt('2026-04-15T12:00:00Z');
    expect(useSyncStore.getState().lastSyncAt).toBe('2026-04-15T12:00:00Z');
  });

  it('reset restores initial values', () => {
    useSyncStore.setState({ isOnline: false, pendingSyncCount: 5, syncStatus: 'error' });
    useSyncStore.getState().reset();
    const s = useSyncStore.getState();
    expect(s.isOnline).toBe(true);
    expect(s.pendingSyncCount).toBe(0);
    expect(s.syncStatus).toBe('idle');
    expect(s.lastSyncAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest --testPathPatterns="syncStore.test" --no-coverage
```

Expected: FAIL — "syncStore" not found.

- [ ] **Step 3: Create syncStore**

Create `src/presentation/stores/syncStore.ts`:

```ts
import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

interface SyncState {
  isOnline: boolean;
  pendingSyncCount: number;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
}

interface SyncActions {
  setIsOnline: (online: boolean) => void;
  setPendingSyncCount: (count: number) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLastSyncAt: (isoDate: string) => void;
  /** Reset to initial values (call on sign-out). */
  reset: () => void;
}

const INITIAL_STATE: SyncState = {
  isOnline: true, // optimistic default — avoids offline flash on app open
  pendingSyncCount: 0,
  syncStatus: 'idle',
  lastSyncAt: null,
};

export const useSyncStore = create<SyncState & SyncActions>((set) => ({
  ...INITIAL_STATE,
  setIsOnline: (isOnline) => set({ isOnline }),
  setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
  reset: () => set(INITIAL_STATE),
}));

let _unsubscribe: (() => void) | null = null;

/**
 * Wire NetInfo events to syncStore.isOnline.
 * Call once at app start (App.tsx). Returns the unsubscribe function.
 */
export function subscribeNetworkChanges(): () => void {
  if (_unsubscribe) return _unsubscribe;
  _unsubscribe = NetInfo.addEventListener((state) => {
    const online = Boolean(state.isConnected && state.isInternetReachable);
    useSyncStore.getState().setIsOnline(online);
  });
  return _unsubscribe;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest --testPathPatterns="syncStore.test" --no-coverage
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Remove sync fields from appStore**

Open `src/presentation/stores/appStore.ts`.

Remove from `AppState` interface:
```ts
// DELETE these 3 lines:
syncStatus: SyncStatus;
lastSyncAt: string | null;
pendingSyncCount: number;
```

Remove from `AppActions` interface:
```ts
// DELETE these 3 lines:
setSyncStatus: (status: SyncStatus) => void;
setLastSyncAt: (isoDate: string) => void;
setPendingSyncCount: (count: number) => void;
```

Remove from `create(...)` initial state:
```ts
// DELETE:
syncStatus: 'idle',
lastSyncAt: null,
pendingSyncCount: 0,
```

Remove from `create(...)` action implementations:
```ts
// DELETE:
setSyncStatus: (syncStatus): void => set({ syncStatus }),
setLastSyncAt: (lastSyncAt): void => set({ lastSyncAt }),
setPendingSyncCount: (pendingSyncCount): void => set({ pendingSyncCount }),
```

Remove from `reset()`:
```ts
// BEFORE:
reset: (): void =>
  set({
    session: null,
    householdId: null,
    availableHouseholds: [],
    paydayDay: DEFAULT_PAYDAY_DAY,
    syncStatus: 'idle',
    pendingSyncCount: 0,
    onboardingCompleted: null,
    monthlyIncomeCents: null,
  }),

// AFTER:
reset: (): void =>
  set({
    session: null,
    householdId: null,
    availableHouseholds: [],
    paydayDay: DEFAULT_PAYDAY_DAY,
    onboardingCompleted: null,
    monthlyIncomeCents: null,
  }),
```

Remove the `SyncStatus` type export from `appStore.ts` (it's now exported from `syncStore.ts`). If any code imports `SyncStatus` from `appStore`, update those imports to come from `syncStore`.

- [ ] **Step 6: Update appStore tests**

Open `src/presentation/stores/appStore.test.ts`.

In the `reset()` test, remove `pendingSyncCount: 5` from the setState call and `expect(state.pendingSyncCount).toBe(0)` from the assertions:
```ts
// BEFORE (in the reset test):
useAppStore.setState({
  householdId: 'hh-001',
  availableHouseholds: [{ id: 'hh-001', name: 'Home', paydayDay: 25, userLevel: 1 }],
  pendingSyncCount: 5,
  onboardingCompleted: true,
});
useAppStore.getState().reset();
const state = useAppStore.getState();
expect(state.session).toBeNull();
expect(state.householdId).toBeNull();
expect(state.availableHouseholds).toHaveLength(0);
expect(state.pendingSyncCount).toBe(0);   // DELETE this line
expect(state.paydayDay).toBe(25);
expect(state.onboardingCompleted).toBeNull();

// AFTER: remove the setState pendingSyncCount: 5 line and the expect(...).toBe(0) line
```

In the "all update state" test, remove the calls to `setSyncStatus`, `setLastSyncAt`, `setPendingSyncCount` and their assertions — those are now tested in `syncStore.test.ts`.

- [ ] **Step 7: Update OfflineBanner**

Open `src/presentation/components/shared/OfflineBanner.tsx`.

Replace:
```tsx
// BEFORE:
import { useNetworkStore } from '../../stores/networkStore';
// ...
const isOnline = useNetworkStore((s) => s.isOnline);

// AFTER:
import { useSyncStore } from '../../stores/syncStore';
// ...
const isOnline = useSyncStore((s) => s.isOnline);
```

- [ ] **Step 8: Update SlipCaptureScreen**

Open `src/presentation/screens/slipScanning/SlipCaptureScreen.tsx`.

Replace:
```tsx
// BEFORE:
import { useNetworkStore } from '../../stores/networkStore';
// ...
const isOnline = useNetworkStore((s) => s.isOnline);

// AFTER:
import { useSyncStore } from '../../stores/syncStore';
// ...
const isOnline = useSyncStore((s) => s.isOnline);
```

Update the test at `src/presentation/screens/slipScanning/__tests__/SlipCaptureScreen.test.tsx`:
```tsx
// BEFORE:
jest.mock('../../../stores/networkStore', () => ({
  useNetworkStore: (sel: (s: { isOnline: boolean }) => unknown) => sel({ isOnline: mockIsOnline }),
}));

// AFTER:
jest.mock('../../../stores/syncStore', () => ({
  useSyncStore: (sel: (s: { isOnline: boolean }) => unknown) => sel({ isOnline: mockIsOnline }),
}));
```

- [ ] **Step 9: Update App.tsx**

Open `App.tsx`.

Replace the networkStore import with syncStore:
```tsx
// BEFORE:
import { subscribeNetworkStore } from './src/presentation/stores/networkStore';

// AFTER:
import { subscribeNetworkChanges, useSyncStore } from './src/presentation/stores/syncStore';
```

Replace the subscription call (line ~165):
```tsx
// BEFORE:
const unsubscribeNetwork = subscribeNetworkStore();

// AFTER:
const unsubscribeNetwork = subscribeNetworkChanges();
```

Add syncStore reset on sign-out (line ~215, right after the existing `useAppStore.getState().reset()` call):
```tsx
// BEFORE:
useAppStore.getState().reset();

// AFTER:
useAppStore.getState().reset();
useSyncStore.getState().reset();
```

- [ ] **Step 10: Delete networkStore**

```bash
rm src/presentation/stores/networkStore.ts
```

- [ ] **Step 11: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: same pass count, no regressions.

- [ ] **Step 12: Commit**

```bash
git add src/presentation/stores/syncStore.ts \
        src/presentation/stores/__tests__/syncStore.test.ts \
        src/presentation/stores/appStore.ts \
        src/presentation/stores/appStore.test.ts \
        src/presentation/components/shared/OfflineBanner.tsx \
        src/presentation/screens/slipScanning/SlipCaptureScreen.tsx \
        src/presentation/screens/slipScanning/__tests__/SlipCaptureScreen.test.tsx \
        App.tsx
git rm src/presentation/stores/networkStore.ts
git commit -m "refactor(stores): consolidate networkStore + appStore sync fields into syncStore"
```

---

## Task 7: Delete Empty DI Directory

**Files:**
- Delete: `src/infrastructure/di/.gitkeep`
- Delete: `src/infrastructure/di/` (directory)

- [ ] **Step 1: Confirm directory is still empty**

```bash
ls -la src/infrastructure/di/
```

Expected: only `.gitkeep` (or completely empty). If any `.ts` files exist, stop and investigate — do not delete.

- [ ] **Step 2: Remove the directory**

```bash
git rm src/infrastructure/di/.gitkeep
```

- [ ] **Step 3: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: same pass count.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete empty src/infrastructure/di directory"
```

---

## Self-Review

### Spec Coverage

| Roadmap requirement | Task |
|---------------------|------|
| `StatCard / KPIBlock` — Dashboard summary row | Task 2 (KPIRow) ✅ |
| `OnboardingStepLayout` — 7 onboarding steps' shared chrome | Task 4 (3 steps) ✅ |
| `ListRow` — transactions and settings list-item convergence | Task 5 ✅ |
| `PickerField` — envelope + date picker in AddTransactionScreen | Task 3 ✅ |
| `SectionHeader` — unify three ad-hoc implementations | Task 1 ✅ |
| Flatten transaction list rows — remove Surface elevation={1}, add divider | Task 5 ✅ |
| Consolidate networkStore + appStore.pendingSyncCount | Task 6 ✅ |
| Populate or delete empty `src/infrastructure/di/` | Task 7 ✅ |

**Gap:** The roadmap mentions "Budget banner, Debt payoff card" as additional KPIBlock call sites. These are not visible in the current code (no `DebtPayoffCard` or Budget banner with the same 3-column pattern exists). KPIRow is designed to accept them once they are built — the `items` array prop makes it trivially extensible.

**Gap:** OnboardingStepLayout covers 3 of 7 steps. `AllocateEnvelopesStep` has unique inner layout (ToAssign tracker, different font) — excluded intentionally. `WelcomeStep`, `MeterSetupStep`, `ScoreIntroStep`, `FinishStep` were not read — they may or may not fit. This covers the clear wins per the ~500 LOC target.

### Placeholder Scan

No TBD, TODO, or placeholder patterns found.

### Type Consistency

- `KPIItem` defined in Task 2, used in Task 2 only.
- `SyncStatus` moved from `appStore.ts` → `syncStore.ts`. Any import of `SyncStatus` from `appStore` must be updated to `syncStore` in Step 5 of Task 6.
- `ListRow.trailing` is `React.ReactNode` — consistent across all usages.
- `PickerField.value` is `string | undefined` — consistent between placeholder and value modes.
