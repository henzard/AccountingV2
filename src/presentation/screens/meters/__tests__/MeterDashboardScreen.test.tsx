/**
 * MeterDashboardScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));
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
  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <MeterDashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });
});
