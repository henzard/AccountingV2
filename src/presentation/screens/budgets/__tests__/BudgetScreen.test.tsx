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
jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: jest.fn().mockReturnValue({ envelopes: [], loading: false, reload: jest.fn() }),
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

// Mock child components that have their own heavy dependencies
jest.mock('../components/BudgetBalanceBanner', () => ({
  BudgetBalanceBanner: () => null,
}));
jest.mock('../components/DuplicateEmfBanner', () => ({
  DuplicateEmfBanner: () => null,
}));
jest.mock('../../../components/envelopes/EnvelopeCard', () => ({
  EnvelopeCard: () => null,
}));

import { BudgetScreen } from '../BudgetScreen';

describe('BudgetScreen', () => {
  it('renders without crashing', () => {
    const { UNSAFE_root } = render(<BudgetScreen />);
    expect(UNSAFE_root).toBeTruthy();
  });
});
