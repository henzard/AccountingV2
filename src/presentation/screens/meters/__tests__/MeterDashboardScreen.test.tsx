/**
 * MeterDashboardScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

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
// Tags eq/and/isNull/desc so a test can inspect the SHAPE of the predicate
// the screen actually builds (see the isNull assertion below), rather than
// re-implementing the deleted_at filter in the mock — the `where` mocks set
// up per-test below still ignore their argument, so this is additive only.
jest.mock('drizzle-orm', () => ({
  and: jest.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: jest.fn((col: unknown, val: unknown) => ({ type: 'eq', col, val })),
  isNull: jest.fn((col: unknown) => ({ type: 'isNull', col })),
  desc: jest.fn((col: unknown) => ({ type: 'desc', col })),
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

  // A load failure used to be an unhandled rejection with no visible error
  // state (load() was try/finally only) — this locks in the error view + retry.
  it('shows an error state with a retry action when loading fails, and retry reloads', async () => {
    const { db } = jest.requireMock('../../../../data/local/db');
    let callCount = 0;
    db.select.mockImplementation(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => {
              callCount += 1;
              // Only the very first query (first meter type, first load
              // attempt) fails — the for-loop in load() aborts on the first
              // rejection, so subsequent calls only happen on retry.
              return callCount === 1
                ? Promise.reject(new Error('DB unavailable'))
                : Promise.resolve([]);
            }),
          })),
        })),
      })),
    }));

    const { getByTestId, getByText, queryByTestId } = render(
      <MeterDashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );

    await waitFor(() => {
      expect(getByTestId('meter-dashboard-error-state')).toBeTruthy();
      expect(getByText('DB unavailable')).toBeTruthy();
    });

    fireEvent.press(getByTestId('meter-dashboard-retry-button'));

    await waitFor(() => {
      expect(queryByTestId('meter-dashboard-error-state')).toBeNull();
      expect(getByText('METER READINGS')).toBeTruthy();
    });
    // 1 call aborted the first load; retry ran all 3 meter type queries.
    expect(callCount).toBe(4);
  });

  // Round-6 follow-up: once a reading can be soft-deleted, the "latest two"
  // query here must exclude deleted_at rows or a deleted reading can still
  // show as the dashboard card's latest/previous reading. Fails without the
  // `isNull(meterReadingsTable.deletedAt)` condition in load()'s query.
  it('scopes the latest-two query to non-deleted rows (deleted_at IS NULL)', async () => {
    const { db } = jest.requireMock('../../../../data/local/db');
    const wherePredicates: unknown[] = [];
    db.select.mockImplementation(() => ({
      from: jest.fn(() => ({
        where: jest.fn((predicate: unknown) => {
          wherePredicates.push(predicate);
          return {
            orderBy: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve([])),
            })),
          };
        }),
      })),
    }));

    render(
      <MeterDashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );

    await waitFor(() => expect(wherePredicates).toHaveLength(3)); // one per meter type

    for (const predicate of wherePredicates as {
      type: string;
      conditions?: { type: string }[];
    }[]) {
      expect(predicate.type).toBe('and');
      const hasDeletedAtFilter = (predicate.conditions ?? []).some((c) => c.type === 'isNull');
      expect(hasDeletedAtFilter).toBe(true);
    }
  });
});
