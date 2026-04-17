# AI Coaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a "What Would Dave Say?" coaching nudge in AddTransactionScreen when a user enters an amount that would put an envelope over budget, providing a Dave Ramsey-style motivational message before they confirm.

**Architecture:** A pure rule-based `SpendingCoach` domain class (no API call) checks if the transaction would cause an overspend and returns a coaching message. A `CoachingBottomSheet` modal appears before submission, letting the user proceed or cancel. This is intentionally simple — no OpenAI calls for v1. The domain class is designed to be swappable with an AI backend later.

**Tech Stack:** React Native, react-native-paper (BottomSheet/Modal), TypeScript, Jest.

---

## File Structure

| File                                                             | Action | Purpose                                                            |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `src/domain/coaching/SpendingCoach.ts`                           | Create | Rule-based coaching: detects overspend, returns Dave-style message |
| `src/domain/coaching/__tests__/SpendingCoach.test.ts`            | Create | Unit tests                                                         |
| `src/presentation/components/shared/CoachingModal.tsx`           | Create | Modal with coaching message + proceed/cancel buttons               |
| `src/presentation/screens/transactions/AddTransactionScreen.tsx` | Modify | Trigger coaching check before save                                 |

---

## Task 1: SpendingCoach domain class (TDD)

**Files:**

- Create: `src/domain/coaching/SpendingCoach.ts`
- Create: `src/domain/coaching/__tests__/SpendingCoach.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/domain/coaching/__tests__/SpendingCoach.test.ts`:

```typescript
import { SpendingCoach } from '../SpendingCoach';

describe('SpendingCoach', () => {
  const coach = new SpendingCoach();

  it('returns null when transaction keeps envelope on budget', () => {
    const result = coach.evaluate({
      amountCents: 5000,
      allocatedCents: 50000,
      spentCents: 40000,
    });
    // 40000 + 5000 = 45000 ≤ 50000 → no warning
    expect(result).toBeNull();
  });

  it('returns a coaching message when transaction would overspend', () => {
    const result = coach.evaluate({
      amountCents: 20000,
      allocatedCents: 50000,
      spentCents: 40000,
    });
    // 40000 + 20000 = 60000 > 50000 → warning
    expect(result).not.toBeNull();
    expect(result!.message).toBeTruthy();
    expect(result!.overspendCents).toBe(10000);
  });

  it('returns a message when envelope is already over budget', () => {
    const result = coach.evaluate({
      amountCents: 1000,
      allocatedCents: 50000,
      spentCents: 51000,
    });
    expect(result).not.toBeNull();
    expect(result!.overspendCents).toBe(2000);
  });

  it('overspendCents is 0 when exactly at limit', () => {
    const result = coach.evaluate({
      amountCents: 10000,
      allocatedCents: 50000,
      spentCents: 40000,
    });
    expect(result).toBeNull();
  });

  it('returns different messages to avoid repetition', () => {
    // Run many times and confirm not all messages are identical
    const messages = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const r = coach.evaluate({ amountCents: 20000, allocatedCents: 50000, spentCents: 40000 });
      if (r) messages.add(r.message);
    }
    // At least 2 distinct messages in 20 calls (coach has multiple messages)
    expect(messages.size).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
npx jest src/domain/coaching/__tests__/SpendingCoach.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement SpendingCoach**

Create `src/domain/coaching/SpendingCoach.ts`:

```typescript
import { formatCurrency } from '../../presentation/utils/currency';

export interface CoachingResult {
  message: string;
  overspendCents: number;
}

export interface CoachingInput {
  amountCents: number;
  allocatedCents: number;
  spentCents: number;
}

// Dave Ramsey-style coaching messages for overspending.
// Rotated randomly to avoid feeling repetitive.
const MESSAGES = [
  "You don't need it if you can't afford it. The envelope is empty for a reason.",
  'Every rand over budget is a rand stolen from your future self.',
  'Gazelle intensity means saying no to today so you can say yes to tomorrow.',
  'This spend will put you over budget. Is it an emergency? If not, wait.',
  "The envelope has spoken. Stick to the plan — it's working.",
  'Living like no one else now means you can live like no one else later.',
  'Your budget is a promise to yourself. Keep it.',
  'Short-term sacrifice. Long-term freedom. Skip this one.',
];

export class SpendingCoach {
  evaluate(input: CoachingInput): CoachingResult | null {
    const projectedSpend = input.spentCents + input.amountCents;
    if (projectedSpend <= input.allocatedCents) return null;

    const overspendCents = projectedSpend - input.allocatedCents;
    const message = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
    return { message, overspendCents };
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest src/domain/coaching/__tests__/SpendingCoach.test.ts
```

Expected: 5 tests, all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/coaching/SpendingCoach.ts \
        src/domain/coaching/__tests__/SpendingCoach.test.ts
git commit -m "feat(domain): SpendingCoach — rule-based overspend detection + Dave-style messages"
```

---

## Task 2: CoachingModal component

**Files:**

- Create: `src/presentation/components/shared/CoachingModal.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react';
import { View, StyleSheet, Modal } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';
import { formatCurrency } from '../../utils/currency';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

interface CoachingModalProps {
  visible: boolean;
  message: string;
  overspendCents: number;
  onProceed: () => void;
  onCancel: () => void;
}

export function CoachingModal({
  visible,
  message,
  overspendCents,
  onProceed,
  onCancel,
}: CoachingModalProps): React.JSX.Element {
  const { colors } = useAppTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID="coaching-modal"
    >
      <View style={styles.overlay}>
        <Surface style={[styles.sheet, { backgroundColor: colors.surface }]} elevation={4}>
          {/* Dave icon row */}
          <Text style={[styles.icon]}>💬</Text>

          <Text variant="labelSmall" style={[styles.eyebrow, { color: colors.primary }]}>
            WHAT WOULD DAVE SAY?
          </Text>

          <Text variant="bodyLarge" style={[styles.message, { color: colors.onSurface }]}>
            {message}
          </Text>

          <Text
            variant="bodySmall"
            style={[styles.overspend, { color: colors.error }]}
            testID="coaching-overspend-amount"
          >
            This transaction puts you {formatCurrency(overspendCents)} over budget.
          </Text>

          <View style={styles.buttons}>
            <Button
              mode="outlined"
              onPress={onCancel}
              style={styles.cancelBtn}
              testID="coaching-cancel"
            >
              Change amount
            </Button>
            <Button
              mode="contained"
              onPress={onProceed}
              buttonColor={colors.error}
              style={styles.proceedBtn}
              testID="coaching-proceed"
            >
              Log it anyway
            </Button>
          </View>
        </Surface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  icon: {
    fontSize: 32,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  eyebrow: {
    letterSpacing: 1.4,
    textAlign: 'center',
    marginBottom: spacing.base,
  },
  message: {
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: spacing.base,
    lineHeight: 24,
  },
  overspend: {
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cancelBtn: { flex: 1 },
  proceedBtn: { flex: 1 },
});
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck 2>&1 | grep -i coaching
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/presentation/components/shared/CoachingModal.tsx
git commit -m "feat(ui): CoachingModal — Dave Ramsey overspend warning bottom sheet"
```

---

## Task 3: Integrate coaching into AddTransactionScreen

**Files:**

- Modify: `src/presentation/screens/transactions/AddTransactionScreen.tsx`

- [ ] **Step 1: Add imports and instantiate coach**

At the top of `AddTransactionScreen.tsx`, add:

```tsx
import { SpendingCoach } from '../../../domain/coaching/SpendingCoach';
import { CoachingModal } from '../../components/shared/CoachingModal';
import type { CoachingResult } from '../../../domain/coaching/SpendingCoach';

const coach = new SpendingCoach();
```

- [ ] **Step 2: Add coaching state**

Inside the component, after existing state declarations:

```tsx
const [coachingResult, setCoachingResult] = useState<CoachingResult | null>(null);
const [pendingSave, setPendingSave] = useState(false);
```

- [ ] **Step 3: Modify the save handler to check coaching first**

Find the existing save handler (e.g., `handleSave`). Replace it with:

```tsx
const handleSave = useCallback((): void => {
  if (!selectedEnvelope) return;
  const amountCents = toCents(amountStr);
  if (amountCents <= 0) return;

  // Coaching check: will this overspend the envelope?
  const result = coach.evaluate({
    amountCents,
    allocatedCents: selectedEnvelope.allocatedCents,
    spentCents: selectedEnvelope.spentCents,
  });

  if (result) {
    setCoachingResult(result);
    setPendingSave(true);
    return; // pause — wait for user decision in modal
  }

  void doSave(amountCents);
}, [selectedEnvelope, amountStr, doSave]);

const handleCoachingProceed = useCallback((): void => {
  setCoachingResult(null);
  setPendingSave(false);
  const amountCents = toCents(amountStr);
  void doSave(amountCents);
}, [amountStr, doSave]);

const handleCoachingCancel = useCallback((): void => {
  setCoachingResult(null);
  setPendingSave(false);
}, []);
```

Extract the actual save logic into a `doSave` helper:

```tsx
const doSave = useCallback(
  async (amountCents: number): Promise<void> => {
    // Move existing save logic here — CreateTransactionUseCase call, navigation.goBack(), etc.
    // This is the existing body of handleSave, extracted.
  },
  [
    /* existing dependencies */
  ],
);
```

- [ ] **Step 4: Add CoachingModal to JSX**

At the end of the JSX tree (before the closing View), add:

```tsx
{
  coachingResult && (
    <CoachingModal
      visible={!!coachingResult}
      message={coachingResult.message}
      overspendCents={coachingResult.overspendCents}
      onProceed={handleCoachingProceed}
      onCancel={handleCoachingCancel}
    />
  );
}
```

- [ ] **Step 5: Run typecheck + tests**

```bash
npm run typecheck && npx jest --testPathPattern="AddTransaction" 2>&1 | tail -10
```

Expected: clean typecheck, existing tests pass.

- [ ] **Step 6: Run full suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/screens/transactions/AddTransactionScreen.tsx
git commit -m "feat(ux): coaching gate in AddTransactionScreen — Dave nudge before overspend"
```
