/**
 * RateHistoryScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../hooks/useMeterReadings', () => ({
  useMeterReadings: jest.fn().mockReturnValue({ readings: [], loading: false, reload: jest.fn() }),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string }) => unknown) =>
    sel({ householdId: 'hh-1' }),
  ),
}));
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
  };
});

import { RateHistoryScreen } from '../RateHistoryScreen';

describe('RateHistoryScreen', () => {
  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows empty state when no readings exist', () => {
    const { getByText } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    expect(getByText('No readings yet')).toBeTruthy();
  });

  it('displays the meter type in sub-header', () => {
    const { getByText } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    expect(getByText(/Electricity/)).toBeTruthy();
  });

  it('shows guidance text in empty state', () => {
    const { getByText } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'water' } } as never}
        navigation={{} as never}
      />,
    );
    expect(getByText(/Go back and log your first reading/)).toBeTruthy();
  });
});
