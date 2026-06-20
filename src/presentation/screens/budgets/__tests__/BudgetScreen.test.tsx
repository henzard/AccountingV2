/**
 * BudgetScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../../data/local/db', () => ({ db: {} }));

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
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    Divider: () => React.createElement('View', null),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
  };
});

jest.mock('../components/BudgetBalanceBanner', () => ({
  BudgetBalanceBanner: () => null,
}));
jest.mock('../components/DuplicateEmfBanner', () => ({
  DuplicateEmfBanner: () => null,
}));
jest.mock('../../../components/envelopes/EnvelopeCard', () => ({
  EnvelopeCard: ({ envelope }: { envelope: { name: string } }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', { testID: `envelope-card-${envelope.name}` });
  },
}));
jest.mock('../../../components/shared/EmptyState', () => ({
  EmptyState: ({ testID }: { testID?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', { testID });
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

  // Hook error is not surfaced — useEnvelopes returns envelopes: [] on error
  // which renders the empty state. No explicit error UI exists.
  it('renders empty state when hook has error (no explicit error UI)', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [],
      loading: false,
      reload: jest.fn(),
      error: new Error('DB failure'),
    });
    const { getByTestId } = render(<BudgetScreen />);
    expect(getByTestId('budget-empty-state')).toBeTruthy();
  });
});
