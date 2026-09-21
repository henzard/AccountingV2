/**
 * SlipQueueScreen.focusRefresh.test.tsx — A-1
 *
 * The queue used to load once and never refresh. After confirming a slip and
 * navigating back, its row still looked unconfirmed, so tapping it reopened
 * it EDITABLE — and re-saving hit ConfirmSlipUseCase's idempotency guard,
 * which returns success with `transactionIds: []`: the user is told the edit
 * saved when nothing was written.
 *
 * Kept in its own file (rather than added to SlipQueueScreen.test.tsx) so the
 * focus callback can be driven explicitly per test.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockNavigate = jest.fn();

// Captures the callback the screen hands to useFocusEffect so a test can
// simulate RE-focusing the screen (coming back from SlipConfirm).
let mockFocusCallback: (() => void | (() => void)) | null = null;

jest.mock('@react-navigation/native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockFocusCallback = cb;
      R.useEffect(() => cb(), [cb]);
    },
  };
});

jest.mock('../../../../data/local/db', () => ({ db: {} }));

const mockGetConfirmedSlipIds = jest.fn().mockResolvedValue(new Set<string>());
jest.mock('../../../../domain/slipScanning/SlipTransactionStatusQuery', () => ({
  getConfirmedSlipIds: (...args: unknown[]) => mockGetConfirmedSlipIds(...args),
}));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({
    children,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('Text', { testID, ...p }, children);
  const Chip = ({
    children,
    testID,
    textStyle: _textStyle,
    ...p
  }: {
    children?: React.ReactNode;
    testID?: string;
    textStyle?: object;
    [k: string]: unknown;
  }) => React.createElement('View', { testID, ...p }, React.createElement('Text', {}, children));
  const FAB = ({ testID, onPress }: { testID?: string; onPress?: () => void }) =>
    React.createElement('Pressable', { testID, onPress });
  return { Text, Chip, FAB };
});

const completedRawResponse = JSON.stringify({
  merchant: 'PnP',
  slip_date: '2026-04-13',
  total_cents: 15000,
  items: [
    {
      description: 'Bread',
      amount_cents: 5000,
      quantity: 1,
      suggested_envelope_id: 'e1',
      confidence: 0.9,
    },
  ],
});

const completedItem = {
  id: 'sq-1',
  householdId: 'hh-1',
  createdBy: 'user-1',
  imageUris: ['file:///f1.jpg'],
  status: 'completed',
  merchant: 'PnP',
  slipDate: '2026-04-13',
  totalCents: 15000,
  errorMessage: null,
  rawResponseJson: completedRawResponse,
  imagesDeletedAt: null,
  openaiCostCents: 1,
  createdAt: '2026-04-13T10:00:00Z',
  updatedAt: '2026-04-13T10:00:00Z',
};

let mockSlipData: any[] = [completedItem];

jest.mock('../../../hooks/useSlipHistory', () => ({
  useSlipHistory: () => mockSlipData,
}));

import { SlipQueueScreen } from '../SlipQueueScreen';

async function refocus(): Promise<void> {
  // The screen registers its focus callback on mount; calling it is exactly
  // what react-navigation does when the screen is focused again.
  const cb = mockFocusCallback;
  if (!cb) throw new Error('SlipQueueScreen did not register a useFocusEffect callback');
  await act(async () => {
    cb();
  });
}

describe('SlipQueueScreen — refresh on focus (A-1)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockFocusCallback = null;
    mockSlipData = [completedItem];
    mockGetConfirmedSlipIds.mockReset().mockResolvedValue(new Set<string>());
  });

  it('refetches page 0 from the repository when the screen is focused again', async () => {
    const repo = { listByHousehold: jest.fn().mockResolvedValue([completedItem]) };

    render(<SlipQueueScreen repo={repo as any} householdId="hh-1" />);
    await act(async () => {});
    // The mount load goes through useSlipHistory, not a direct repo read.
    expect(repo.listByHousehold).not.toHaveBeenCalled();

    await refocus();

    expect(repo.listByHousehold).toHaveBeenCalledWith('hh-1', 20, 0);
  });

  it('recomputes confirmedSlipIds on focus so a just-confirmed slip reopens READ-ONLY', async () => {
    // Confirming a slip writes transactions and never touches the slip_queue
    // row, so the refetched row is identical — only the confirmed lookup
    // changes its answer.
    mockGetConfirmedSlipIds
      .mockResolvedValueOnce(new Set<string>())
      .mockResolvedValue(new Set(['sq-1']));
    const repo = { listByHousehold: jest.fn().mockResolvedValue([completedItem]) };
    const { getByTestId, getAllByText } = render(
      <SlipQueueScreen repo={repo as any} householdId="hh-1" />,
    );
    await act(async () => {});
    expect(getAllByText('Needs review').length).toBeGreaterThan(0);

    await refocus();

    expect(getAllByText('Saved').length).toBeGreaterThan(0);
    fireEvent.press(getByTestId('slip-item-sq-1'));
    expect(mockNavigate).toHaveBeenCalledWith(
      'SlipConfirm',
      expect.objectContaining({ slipId: 'sq-1', readOnly: true }),
    );
  });

  it('shows rows that changed since the last load', async () => {
    const cancelled = { ...completedItem, status: 'cancelled', updatedAt: '2026-04-15T10:00:00Z' };
    const repo = { listByHousehold: jest.fn().mockResolvedValue([cancelled]) };
    const { getAllByText } = render(<SlipQueueScreen repo={repo as any} householdId="hh-1" />);
    await act(async () => {});

    await refocus();

    expect(getAllByText('Cancelled').length).toBeGreaterThan(0);
  });

  it('discards a slow refresh that resolves after a newer one', async () => {
    const stale = {
      ...completedItem,
      merchant: 'STALE',
      updatedAt: '2026-04-15T10:00:00Z',
    };
    const fresh = {
      ...completedItem,
      merchant: 'FRESH',
      updatedAt: '2026-04-16T10:00:00Z',
    };

    let releaseStale: (rows: unknown[]) => void = () => {};
    const stalePromise = new Promise<unknown[]>((resolve) => {
      releaseStale = resolve;
    });
    const repo = {
      listByHousehold: jest.fn().mockReturnValueOnce(stalePromise).mockResolvedValue([fresh]),
    };

    const { queryAllByText } = render(<SlipQueueScreen repo={repo as any} householdId="hh-1" />);
    await act(async () => {});

    // First (slow) focus, then a second focus that completes first.
    const cb = mockFocusCallback;
    if (!cb) throw new Error('SlipQueueScreen did not register a useFocusEffect callback');
    act(() => {
      cb();
    });
    await refocus();
    expect(queryAllByText('FRESH').length).toBeGreaterThan(0);

    // Now the older request finally lands — it must not overwrite the newer rows.
    await act(async () => {
      releaseStale([stale]);
      await stalePromise;
    });

    expect(queryAllByText('STALE')).toHaveLength(0);
    expect(queryAllByText('FRESH').length).toBeGreaterThan(0);
  });
});
