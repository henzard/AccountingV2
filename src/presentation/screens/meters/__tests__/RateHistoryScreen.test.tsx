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

const mockUseMeterReadings = jest.fn().mockReturnValue({
  readings: [],
  loading: false,
  reload: jest.fn(),
});
jest.mock('../../../hooks/useMeterReadings', () => ({
  useMeterReadings: (...args: unknown[]) => mockUseMeterReadings(...args),
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
    Text: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('Text', p, children),
    Surface: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('View', p, children),
    ActivityIndicator: ({ animating }: { animating?: boolean }) =>
      animating !== false ? React.createElement('View', { testID: 'loading' }) : null,
  };
});

import { RateHistoryScreen } from '../RateHistoryScreen';

const makeReading = (id: string, value: number, date: string, costCents = 0) => ({
  id,
  householdId: 'hh-1',
  meterType: 'electricity' as const,
  readingValue: value,
  readingDate: date,
  costCents,
  notes: null,
  createdBy: 'user-1',
  isSynced: true,
  createdAt: date,
  updatedAt: date,
});

describe('RateHistoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMeterReadings.mockReturnValue({ readings: [], loading: false, reload: jest.fn() });
  });

  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows loading indicator when hook is loading', () => {
    mockUseMeterReadings.mockReturnValue({ readings: [], loading: true, reload: jest.fn() });
    const { getByTestId } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    expect(getByTestId('loading')).toBeTruthy();
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

  it('renders reading rows when populated', () => {
    mockUseMeterReadings.mockReturnValue({
      readings: [
        makeReading('r2', 1200, '2026-06-15', 35000),
        makeReading('r1', 1000, '2026-05-15', 30000),
      ],
      loading: false,
      reload: jest.fn(),
    });
    const { getAllByText } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    expect(getAllByText(/1.?200/).length).toBeGreaterThan(0);
    expect(getAllByText(/1.?000/).length).toBeGreaterThan(0);
  });

  // Hook error is not surfaced — useMeterReadings returns readings: [] on error,
  // so empty state is shown. No explicit error UI exists.
  it('shows empty state when hook has error (no explicit error UI)', () => {
    mockUseMeterReadings.mockReturnValue({
      readings: [],
      loading: false,
      reload: jest.fn(),
      error: new Error('DB error'),
    });
    const { getByText } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    expect(getByText('No readings yet')).toBeTruthy();
  });
});
