/**
 * MeterDashboardScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useFocusEffect: (cb: () => (() => void) | void) => {
      R.useEffect(() => cb(), []);
    },
  };
});
jest.mock('../../../../data/local/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    })),
  },
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));
jest.mock('drizzle-orm', () => ({ and: jest.fn(), eq: jest.fn(), desc: jest.fn() }));
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
jest.mock('../components/MeterReadingCard', () => ({
  MeterReadingCard: () => null,
}));

const mockNavigate = jest.fn();
import { MeterDashboardScreen } from '../MeterDashboardScreen';

describe('MeterDashboardScreen', () => {
  it('renders without crashing', async () => {
    const { UNSAFE_root } = render(
      <MeterDashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    await waitFor(() => expect(UNSAFE_root).toBeTruthy());
  });

  it('renders METER READINGS header after data loads', async () => {
    const { getByText } = render(
      <MeterDashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    await waitFor(() => {
      expect(getByText('METER READINGS')).toBeTruthy();
    });
  });
});
