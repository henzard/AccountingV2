/**
 * DashboardScreen.refundedEnvelope.test.tsx — REFUNDS on the envelope rows
 *
 * `spentCents` is a derived signed SUM over the transaction ledger, so an
 * envelope whose refunds exceed its purchases has a NEGATIVE spend. The row's
 * usage percentage is therefore negative, and it is interpolated straight
 * into a `width: '<n>%'` style — a negative width percentage is an invalid
 * React Native style.
 *
 * The bar is clamped to [0, 100]; the text/accessibility figure stays the
 * TRUE one, so the dashboard never lies about the number, it just cannot draw
 * an impossible bar.
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

const mockEnvelopes = [
  {
    // Net-refunded: R300,00 of refunds against R0 of purchases on a
    // R1 000,00 envelope → pct = -30.
    id: 'refunded-1',
    householdId: 'hh-1',
    name: 'Groceries',
    envelopeType: 'spending',
    allocatedCents: 100000,
    spentCents: -30000,
    periodStart: '2026-09-01',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
  },
  {
    // Ordinary half-spent envelope, as a control.
    id: 'normal-1',
    householdId: 'hh-1',
    name: 'Transport',
    envelopeType: 'spending',
    allocatedCents: 100000,
    spentCents: 50000,
    periodStart: '2026-09-01',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
  },
  {
    // Overspent, as the opposite-end control for the existing top clamp.
    id: 'over-1',
    householdId: 'hh-1',
    name: 'Eating out',
    envelopeType: 'spending',
    allocatedCents: 100000,
    spentCents: 180000,
    periodStart: '2026-09-01',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
  },
];

jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: () => ({ envelopes: mockEnvelopes, loading: false, reload: jest.fn() }),
}));
jest.mock('../../../hooks/useBabySteps', () => ({
  useBabySteps: () => ({ statuses: [] }),
}));
jest.mock('../../../hooks/usePersistentEnvelopeSavings', () => ({
  usePersistentEnvelopeSavings: () => ({
    savedCentsByEnvelopeId: new Map(),
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
jest.mock('../findLatestPeriodWithEnvelopes', () => ({
  findLatestPeriodWithEnvelopes: jest.fn().mockResolvedValue(null),
  hasPeriodScopedEnvelopeAfter: jest.fn().mockResolvedValue(false),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('true'),
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

import { StyleSheet } from 'react-native';
import { DashboardScreen } from '../DashboardScreen';

/** The resolved `width` of one envelope row's progress fill, e.g. "0%". */
function fillWidth(node: { props: { style?: unknown } }): unknown {
  return (StyleSheet.flatten(node.props.style as never) as { width?: unknown }).width;
}

function renderDashboard() {
  return render(
    <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
  );
}

describe('DashboardScreen — a net-refunded envelope row', () => {
  it('never draws a NEGATIVE bar width (an invalid RN style)', () => {
    const { getByTestId } = renderDashboard();
    const width = fillWidth(getByTestId('envelope-progress-fill-refunded-1'));

    expect(typeof width).toBe('string');
    expect(String(width).startsWith('-')).toBe(false);
    // -30% used floors at an empty bar.
    expect(width).toBe('0%');
  });

  it('still clamps an overspent envelope at a full bar', () => {
    const { getByTestId } = renderDashboard();
    expect(fillWidth(getByTestId('envelope-progress-fill-over-1'))).toBe('100%');
  });

  it('leaves an ordinary envelope’s bar proportional', () => {
    const { getByTestId } = renderDashboard();
    expect(fillWidth(getByTestId('envelope-progress-fill-normal-1'))).toBe('50%');
  });

  it('keeps the accessibility figure TRUTHFUL rather than clamping it to match the bar', () => {
    const { getByLabelText } = renderDashboard();
    // The bar reads 0%, but the row still reports the real -30% used and the
    // real remaining amount — the clamp is a drawing concern, not a lie.
    expect(getByLabelText(/Groceries,.*-30% used/)).toBeTruthy();
  });
});
