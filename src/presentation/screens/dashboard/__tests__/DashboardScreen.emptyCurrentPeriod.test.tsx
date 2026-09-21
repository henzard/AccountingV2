/**
 * DashboardScreen.emptyCurrentPeriod.test.tsx
 *
 * THE REAL HOUSEHOLD SHAPE: 18 months of budgeted history, and a CURRENT
 * period with no envelopes of its own yet (opened the app after payday,
 * before rolling over). The only rows the current period returns are the
 * PERSISTENT funds, which carry across periods regardless.
 *
 * That made `envelopes.length > 0` true, which sent the dashboard down the
 * "you haven't set up this month's spending yet / + New envelope" branch —
 * with no way back into the rollover wizard once it had been dismissed, and
 * no figures at all on screen for a household with a year and a half of
 * history.
 *
 * It must instead offer "Start this period from last period's budget" as the
 * primary action, and show last period's headline numbers — Spent vs
 * allocated, and Received SEPARATELY, since the income envelope's
 * transactions are money IN, never spending.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));

jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaView: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      RN.createElement('View', p, children),
  };
});

jest.mock('../resolveEnvelopeTransactions', () => ({
  resolveEnvelopeTransactions: jest.fn().mockResolvedValue([]),
}));

const PREVIOUS_PERIOD_START = '2026-08-20';

// The current period returns ONLY the persistent fund — period-scoped
// envelopes for it do not exist yet.
const currentEnvelopes = [
  {
    id: 'saving-1',
    householdId: 'hh-1',
    name: 'Saving',
    envelopeType: 'savings',
    allocatedCents: 50_000,
    spentCents: 0,
    isArchived: false,
    periodStart: '2025-02-20',
    createdAt: '2025-02-20',
    updatedAt: '2025-02-20',
  },
];

// Last budgeted period: spending + the income envelope carrying the salary
// deposits the import recorded against it.
const previousEnvelopes = [
  {
    id: 'food-aug',
    householdId: 'hh-1',
    name: 'Food',
    envelopeType: 'spending',
    allocatedCents: 800_00,
    spentCents: 750_00,
    isArchived: false,
    periodStart: PREVIOUS_PERIOD_START,
    createdAt: PREVIOUS_PERIOD_START,
    updatedAt: PREVIOUS_PERIOD_START,
  },
  {
    id: 'nedbank-aug',
    householdId: 'hh-1',
    name: 'Nedbank',
    envelopeType: 'income',
    allocatedCents: 3_500_00,
    spentCents: 3_480_00,
    isArchived: false,
    periodStart: PREVIOUS_PERIOD_START,
    createdAt: PREVIOUS_PERIOD_START,
    updatedAt: PREVIOUS_PERIOD_START,
  },
];

jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: (_householdId: string, periodStart: string) => ({
    envelopes: periodStart === '2026-08-20' ? previousEnvelopes : currentEnvelopes,
    loading: false,
    refreshing: false,
    error: null,
    reload: jest.fn(),
  }),
}));

jest.mock('../../../hooks/useBabySteps', () => ({
  useBabySteps: jest.fn().mockReturnValue({ statuses: [] }),
}));
jest.mock('../../../hooks/useDebts', () => ({
  useDebts: jest.fn().mockReturnValue({ debts: [] }),
}));

jest.mock('../../../hooks/usePersistentEnvelopeSavings', () => ({
  usePersistentEnvelopeSavings: () => ({
    savedCentsByEnvelopeId: new Map([['saving-1', 900_00]]),
    loading: false,
    error: null,
    reload: jest.fn(),
  }),
}));

jest.mock('../../../../domain/shared/resolveBabyStepIsActive', () => ({
  resolveBabyStepIsActive: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../../domain/scoring/resolveLoggingDays', () => ({
  resolveLoggingDays: jest.fn().mockResolvedValue(0),
}));
jest.mock('../resolveMeterReadingsLogged', () => ({
  resolveMeterReadingsLogged: jest.fn().mockResolvedValue(false),
}));

// August is the newest period that actually has envelopes.
jest.mock('../findLatestPeriodWithEnvelopes', () => ({
  findLatestPeriodWithEnvelopes: jest.fn().mockResolvedValue('2026-08-20'),
  hasPeriodScopedEnvelopeAfter: jest.fn().mockResolvedValue(false),
}));

// Already acknowledged, so the wizard does NOT auto-open — exactly the state
// in which a visible way back in matters.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('true'),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string | null; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 20 }),
  ),
}));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Dialog = ({
    children,
    visible,
    testID,
  }: {
    children?: React.ReactNode;
    visible?: boolean;
    testID?: string;
  }) => (visible ? React.createElement('View', { testID }, children) : null);
  Dialog.Title = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('Text', null, children);
  Dialog.Content = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', null, children);
  Dialog.Actions = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', null, children);
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    Button: ({ onPress, children }: { onPress?: () => void; children?: React.ReactNode }) =>
      React.createElement('Pressable', { onPress }, children),
    FAB: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement('Pressable', { onPress, testID: testID ?? 'fab' }),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Portal: ({ children }: { children?: React.ReactNode }) => children,
    Dialog,
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

import { DashboardScreen } from '../DashboardScreen';
import { formatCurrency } from '../../../utils/currency';

function renderScreen(): ReturnType<typeof render> {
  return render(
    <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
  );
}

describe('DashboardScreen — current period has no envelopes, 18 months of history behind it', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('offers "Start this period from last period\'s budget" as the primary action', async () => {
    const { findByTestId } = renderScreen();
    expect(await findByTestId('start-new-period-button')).toBeTruthy();
  });

  it('opens the rollover wizard from that button rather than the new-envelope form', async () => {
    const { findByTestId } = renderScreen();
    const cta = await findByTestId('start-new-period-button');
    expect(String(cta.props.accessibilityLabel).toLowerCase()).toContain('last period');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('keeps "+ New envelope" available, demoted', async () => {
    const { findByTestId } = renderScreen();
    expect(await findByTestId('new-envelope-button')).toBeTruthy();
  });

  it("shows last period's spent vs allocated instead of a screen with no figures", async () => {
    const { findByTestId } = renderScreen();
    const spent = await findByTestId('dashboard-previous-period-summary-spent');
    expect(spent.props.children).toBe(`${formatCurrency(750_00)} of ${formatCurrency(800_00)}`);
  });

  it('names the period those figures belong to', async () => {
    const { findByText } = renderScreen();
    expect(await findByText('August 2026 · last period')).toBeTruthy();
  });

  it('shows what came IN separately, and never inside the spent figure', async () => {
    const { findByTestId } = renderScreen();
    const received = await findByTestId('dashboard-previous-period-summary-received');
    expect(received.props.children).toBe(formatCurrency(3_480_00));

    const spent = await findByTestId('dashboard-previous-period-summary-spent');
    expect(String(spent.props.children)).not.toContain(formatCurrency(3_480_00));
  });

  it('does not treat a fund-only current period as a brand-new household', async () => {
    const { findByTestId, queryByText } = renderScreen();
    await findByTestId('start-new-period-button');
    expect(queryByText('Add your first envelope to get started')).toBeNull();
  });
});
