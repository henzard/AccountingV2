/**
 * DashboardScreen.rolloverWizard.test.tsx
 *
 * Verifies DashboardScreen opens the new RolloverWizard (not the old, deleted
 * PeriodRolloverModal) once a new budget period is detected and not yet
 * acknowledged — i.e. `isNewPeriodWithin(...)` is true and the
 * `period_ack_<periodStart>` AsyncStorage key is unset.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react-native';

// ─── Navigation mock: actually invoke the focus-effect callback ──────────────
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    // Runs the focus-effect callback once on mount, mirroring a real focus event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useEffect(() => cb(), []);
  },
}));

jest.mock('../../../../data/local/db', () => ({ db: {} }));

jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: jest.fn().mockReturnValue({ envelopes: [], loading: false, reload: jest.fn() }),
}));
jest.mock('../../../hooks/useBabySteps', () => ({
  useBabySteps: jest.fn().mockReturnValue({ statuses: [] }),
}));
jest.mock('../../../../domain/shared/resolveBabyStepIsActive', () => ({
  resolveBabyStepIsActive: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../../domain/scoring/resolveLoggingDays', () => ({
  resolveLoggingDays: jest.fn().mockResolvedValue(0),
}));

// New period detected, and not yet acknowledged (getItem resolves null).
jest.mock('../../../../domain/shared/BudgetPeriodEngine', () => {
  class BudgetPeriodEngine {
    getCurrentPeriod() {
      return {
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2026-07-31T00:00:00.000Z'),
        label: 'Jul',
      };
    }
    getPeriodForDate() {
      return {
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-30T00:00:00.000Z'),
        label: 'Jun',
      };
    }
    isNewPeriodWithin() {
      return true;
    }
  }
  return { BudgetPeriodEngine };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null), // not acknowledged — wizard should open
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string | null; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    Button: ({ onPress, children }: { onPress?: () => void; children?: React.ReactNode }) =>
      React.createElement('Pressable', { onPress }, children),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
  };
});
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-linear-gradient', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    LinearGradient: ({ children, style }: { children?: React.ReactNode; style?: unknown }) =>
      React.createElement('View', { style }, children),
  };
});
jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Circle: () => React.createElement('View'),
  };
});

// Stub the wizard itself — this test only asserts DashboardScreen WIRES to it
// (not its internals, which are covered by RolloverWizard.test.tsx).
jest.mock('../../budgets/RolloverWizard', () => ({
  RolloverWizard: ({ visible }: { visible: boolean }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return visible ? React.createElement('View', { testID: 'rollover-wizard-stub' }) : null;
  },
}));

const mockNavigate = jest.fn();
import { DashboardScreen } from '../DashboardScreen';

describe('DashboardScreen — rollover wizard wiring', () => {
  it('opens the RolloverWizard (not the old modal) when a new, unacknowledged period is detected', async () => {
    const { findByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(await findByTestId('rollover-wizard-stub')).toBeTruthy();
  });

  it('the deleted PeriodRolloverModal module no longer exists', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../PeriodRolloverModal.tsx'))).toBe(false);
  });
});
