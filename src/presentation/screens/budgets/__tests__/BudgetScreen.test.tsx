/**
 * BudgetScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('../../../../data/local/db', () => ({ db: {} }));

const mockFindLatestPeriodWithEnvelopes = jest.fn().mockResolvedValue(null);
jest.mock('../../dashboard/findLatestPeriodWithEnvelopes', () => ({
  findLatestPeriodWithEnvelopes: (...args: unknown[]) => mockFindLatestPeriodWithEnvelopes(...args),
}));

// The wizard itself is covered by RolloverWizard.test.tsx — this file only
// asserts BudgetScreen wires "Start this month's budget" to it.
jest.mock('../RolloverWizard', () => ({
  RolloverWizard: ({ visible }: { visible: boolean }) => {
    const React = jest.requireActual('react');
    return visible ? React.createElement('View', { testID: 'rollover-wizard-stub' }) : null;
  },
}));

const mockUseEnvelopes = jest.fn().mockReturnValue({
  envelopes: [],
  loading: false,
  reload: jest.fn(),
});
jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: (...args: unknown[]) => mockUseEnvelopes(...args),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('Text', { testID }, children),
    Divider: () => React.createElement('View', null),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    FAB: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement('Pressable', { onPress, testID: testID ?? 'fab' }),
    Button: ({ onPress, children }: { onPress?: () => void; children?: React.ReactNode }) =>
      React.createElement('Pressable', { onPress }, children),
    IconButton: ({
      onPress,
      disabled,
      testID,
    }: {
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      React.createElement('Pressable', {
        onPress: disabled ? undefined : onPress,
        disabled,
        testID,
      }),
    TouchableRipple: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => React.createElement('Pressable', { onPress, testID }, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('../../../hooks/usePersistentEnvelopeSavings', () => ({
  usePersistentEnvelopeSavings: () => ({
    savedCentsByEnvelopeId: new Map(),
    loading: false,
    error: null,
    reload: jest.fn(),
  }),
}));

jest.mock('../../dashboard/components/EnvelopeDetailSheet', () => ({
  EnvelopeDetailSheet: ({ visible }: { visible: boolean }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return visible ? React.createElement('View', { testID: 'envelope-detail-sheet-stub' }) : null;
  },
}));

jest.mock('../components/BudgetBalanceBanner', () => ({
  BudgetBalanceBanner: () => null,
}));
jest.mock('../components/MonthlyIncomeCard', () => ({
  MonthlyIncomeCard: ({ incomeCents, hasIncome }: { incomeCents: number; hasIncome: boolean }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', {
      testID: 'monthly-income-card',
      'data-income': incomeCents,
      'data-has-income': hasIncome,
    });
  },
}));
jest.mock('../components/DuplicateEmfBanner', () => ({
  DuplicateEmfBanner: () => null,
}));
jest.mock('../../../components/envelopes/EnvelopeCard', () => ({
  EnvelopeCard: ({ envelope, onPress }: { envelope: { name: string }; onPress?: () => void }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('Pressable', { testID: `envelope-card-${envelope.name}`, onPress });
  },
}));
jest.mock('../../../components/shared/EmptyState', () => ({
  EmptyState: ({
    testID,
    ctaLabel,
    onCta,
  }: {
    testID?: string;
    ctaLabel?: string;
    onCta?: () => void;
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement(
      'View',
      { testID },
      ctaLabel && onCta
        ? React.createElement('Pressable', { testID: 'empty-state-cta', onPress: onCta }, ctaLabel)
        : null,
    );
  },
}));
jest.mock('../../../components/shared/SectionHeader', () => ({
  SectionHeader: ({ title }: { title: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('Text', { testID: `section-${title}` }, title);
  },
}));

import { BudgetScreen } from '../BudgetScreen';

const makeEnvelope = (id: string, name: string, type: string) => ({
  id,
  name,
  householdId: 'hh-1',
  envelopeType: type,
  allocatedCents: 50000,
  spentCents: 20000,
  sortOrder: 0,
  isSynced: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});

describe('BudgetScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseEnvelopes.mockReturnValue({ envelopes: [], loading: false, reload: jest.fn() });
    mockFindLatestPeriodWithEnvelopes.mockResolvedValue(null);
  });

  it('renders without crashing', () => {
    const { UNSAFE_root } = render(<BudgetScreen />);
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows loading indicator when loading with no envelopes', () => {
    mockUseEnvelopes.mockReturnValue({ envelopes: [], loading: true, reload: jest.fn() });
    const { queryByTestId, UNSAFE_root } = render(<BudgetScreen />);
    expect(queryByTestId('budget-empty-state')).toBeNull();
    expect(UNSAFE_root.findAllByType('ActivityIndicator').length).toBeGreaterThan(0);
  });

  it('shows empty state when no envelopes exist and not loading', () => {
    const { getByTestId } = render(<BudgetScreen />);
    expect(getByTestId('budget-empty-state')).toBeTruthy();
  });

  it('renders SectionList with envelope cards when populated', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [
        makeEnvelope('e1', 'Salary', 'income'),
        makeEnvelope('e2', 'Groceries', 'spending'),
      ],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(<BudgetScreen />);
    expect(getByTestId('envelope-card-Salary')).toBeTruthy();
    expect(getByTestId('envelope-card-Groceries')).toBeTruthy();
    expect(getByTestId('section-Income')).toBeTruthy();
    expect(getByTestId('section-Expenses')).toBeTruthy();
  });

  it('always renders the monthly income card, even with no envelopes', () => {
    const { getByTestId } = render(<BudgetScreen />);
    const card = getByTestId('monthly-income-card');
    expect(card).toBeTruthy();
    expect(card.props['data-has-income']).toBe(false);
    expect(card.props['data-income']).toBe(0);
  });

  it('sums all income envelopes into the monthly income card total', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [
        makeEnvelope('e1', 'Salary', 'income'),
        makeEnvelope('e2', 'Side gig', 'income'),
        makeEnvelope('e3', 'Groceries', 'spending'),
      ],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(<BudgetScreen />);
    const card = getByTestId('monthly-income-card');
    expect(card.props['data-has-income']).toBe(true);
    // 50000 + 50000 income envelopes
    expect(card.props['data-income']).toBe(100000);
  });

  // UX2-8: a load failure must read as a load failure, not "no envelopes" —
  // it gets its own Retry CTA instead of silently reusing the empty copy.
  it('shows a Retry CTA (not the plain empty-state copy) when the hook has an error', () => {
    const reload = jest.fn();
    mockUseEnvelopes.mockReturnValue({
      envelopes: [],
      loading: false,
      reload,
      error: 'DB failure',
    });
    const { getByTestId } = render(<BudgetScreen />);
    expect(getByTestId('budget-empty-state')).toBeTruthy();
    fireEvent.press(getByTestId('empty-state-cta'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // UX-2: normal envelopes were only addable from the empty state's
  // "+ New envelope" button — once any envelope existed there was no way to
  // add another. A FAB on the populated screen fixes that.
  it('shows an add-envelope FAB when envelopes exist and navigates to AddEditEnvelope', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [makeEnvelope('e1', 'Groceries', 'spending')],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(<BudgetScreen />);
    fireEvent.press(getByTestId('add-envelope-fab'));
    expect(mockNavigate).toHaveBeenCalledWith('AddEditEnvelope', {});
  });

  it('does not show the add-envelope FAB when there are no envelopes', () => {
    const { queryByTestId } = render(<BudgetScreen />);
    expect(queryByTestId('add-envelope-fab')).toBeNull();
  });

  // UX-2: Expenses rows previously had no onPress at all (only Income rows
  // did) — tapping an expense envelope now navigates to AddEditEnvelope too.
  // UX2-18: tapping an expense row now opens the same EnvelopeDetailSheet
  // used on the dashboard (with Edit inside it), instead of jumping straight
  // to the edit form.
  it('pressing an expense envelope card opens the EnvelopeDetailSheet, not AddEditEnvelope directly', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [makeEnvelope('e2', 'Groceries', 'spending')],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(<BudgetScreen />);
    fireEvent.press(getByTestId('envelope-card-Groceries'));
    expect(getByTestId('envelope-detail-sheet-stub')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // UX-1/DOM-2/VAL-2: "Start this month's budget" opens the rollover wizard
  // from whichever earlier period actually has envelopes, when one exists.
  it('"Start this month\'s budget" opens the rollover wizard when an earlier period has envelopes', async () => {
    mockFindLatestPeriodWithEnvelopes.mockResolvedValue('2026-08-01');
    const { getByTestId, findByTestId } = render(<BudgetScreen />);
    fireEvent.press(getByTestId('empty-state-cta'));
    expect(await findByTestId('rollover-wizard-stub')).toBeTruthy();
  });

  // When no earlier period ever had envelopes (brand-new household), there
  // is nothing to review/copy forward — go straight to creating one instead.
  it('"Start this month\'s budget" navigates to AddEditEnvelope when no earlier period has envelopes', async () => {
    mockFindLatestPeriodWithEnvelopes.mockResolvedValue(null);
    const { getByTestId } = render(<BudgetScreen />);
    fireEvent.press(getByTestId('empty-state-cta'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('AddEditEnvelope', {}));
  });

  // VAL2-4: the screen used to be pinned to the current period even though
  // `useEnvelopes` already accepts any period.
  describe('period switcher', () => {
    it('"Next" is disabled on the current period', () => {
      const { getByTestId } = render(<BudgetScreen />);
      expect(getByTestId('budget-period-next').props.disabled).toBe(true);
    });

    it('going back a period shows the "Viewing <range>" read-only banner, hides the FAB, and re-enables Next', () => {
      mockUseEnvelopes.mockReturnValue({
        envelopes: [makeEnvelope('e1', 'Groceries', 'spending')],
        loading: false,
        reload: jest.fn(),
      });
      const { getByTestId, queryByTestId } = render(<BudgetScreen />);
      fireEvent.press(getByTestId('budget-period-prev'));
      expect(getByTestId('budget-past-period-banner')).toBeTruthy();
      expect(queryByTestId('add-envelope-fab')).toBeNull();
      expect(getByTestId('budget-period-next').props.disabled).toBeFalsy();
    });

    it('a past period’s expense row is not tappable (read-only)', () => {
      mockUseEnvelopes.mockReturnValue({
        envelopes: [makeEnvelope('e1', 'Groceries', 'spending')],
        loading: false,
        reload: jest.fn(),
      });
      const { getByTestId, queryByTestId } = render(<BudgetScreen />);
      fireEvent.press(getByTestId('budget-period-prev'));
      fireEvent.press(getByTestId('envelope-card-Groceries'));
      expect(queryByTestId('envelope-detail-sheet-stub')).toBeNull();
    });

    it('going forward from a past period returns to the current period (no banner, FAB back)', () => {
      mockUseEnvelopes.mockReturnValue({
        envelopes: [makeEnvelope('e1', 'Groceries', 'spending')],
        loading: false,
        reload: jest.fn(),
      });
      const { getByTestId, queryByTestId } = render(<BudgetScreen />);
      fireEvent.press(getByTestId('budget-period-prev'));
      fireEvent.press(getByTestId('budget-period-next'));
      expect(queryByTestId('budget-past-period-banner')).toBeNull();
      expect(getByTestId('add-envelope-fab')).toBeTruthy();
    });
  });
});
