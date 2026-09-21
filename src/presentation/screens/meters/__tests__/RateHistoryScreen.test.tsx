/**
 * RateHistoryScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));

const mockDeleteExecute = jest.fn().mockResolvedValue({ success: true });
jest.mock('../../../../domain/meterReadings/DeleteMeterReadingUseCase', () => ({
  DeleteMeterReadingUseCase: jest.fn().mockImplementation(() => ({
    execute: (...args: unknown[]) => mockDeleteExecute(...args),
  })),
}));

const mockConfirm = jest.fn().mockResolvedValue(true);
jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

const mockEnqueue = jest.fn();
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((sel: (s: { enqueue: () => void }) => unknown) =>
    sel({ enqueue: (...args: unknown[]) => mockEnqueue(...args) }),
  ),
}));

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
    IconButton: ({
      onPress,
      testID,
      accessibilityLabel,
    }: {
      onPress?: () => void;
      testID?: string;
      accessibilityLabel?: string;
    }) => React.createElement('Pressable', { onPress, testID, accessibilityLabel }),
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
    mockConfirm.mockResolvedValue(true);
    mockDeleteExecute.mockResolvedValue({ success: true });
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

  // A hook error used to be silently swallowed into "No readings yet" — it
  // must now render a distinct error view instead of the empty state.
  it('shows a distinct error view (not "No readings yet") when the hook has an error', () => {
    mockUseMeterReadings.mockReturnValue({
      readings: [],
      loading: false,
      reload: jest.fn(),
      error: new Error('DB error'),
    });
    const { getByText, queryByText, getByTestId } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    expect(getByTestId('rate-history-error-state')).toBeTruthy();
    expect(getByText('DB error')).toBeTruthy();
    expect(queryByText('No readings yet')).toBeNull();
  });

  it('retries by calling reload when the retry button is pressed after an error', () => {
    const mockReload = jest.fn();
    mockUseMeterReadings.mockReturnValue({
      readings: [],
      loading: false,
      reload: mockReload,
      error: new Error('DB error'),
    });
    const { getByTestId } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );

    fireEvent.press(getByTestId('rate-history-retry-button'));

    expect(mockReload).toHaveBeenCalled();
  });

  it('shows a delete confirmation naming the date, value and unit when the delete button is pressed', () => {
    mockUseMeterReadings.mockReturnValue({
      readings: [makeReading('r1', 1800, '2026-06-15', 30000)],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    fireEvent.press(getByTestId('delete-reading-r1'));
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete reading?',
        message: expect.stringContaining('1'),
        confirmLabel: 'Delete',
        destructive: true,
      }),
    );
    const message = mockConfirm.mock.calls[0][0].message as string;
    expect(message).toContain('15 Jun 2026');
    expect(message).toContain('1');
    expect(message).toContain('800');
    expect(message).toContain('kWh');
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    mockConfirm.mockResolvedValue(false);
    mockUseMeterReadings.mockReturnValue({
      readings: [makeReading('r1', 1800, '2026-06-15', 30000)],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    fireEvent.press(getByTestId('delete-reading-r1'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockDeleteExecute).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalledWith('Reading deleted', 'success');
  });

  it('deletes the reading, shows a success toast, and reloads the list after a confirmed delete', async () => {
    const mockReload = jest.fn();
    mockUseMeterReadings.mockReturnValue({
      readings: [makeReading('r1', 1800, '2026-06-15', 30000)],
      loading: false,
      reload: mockReload,
    });
    const { getByTestId } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    fireEvent.press(getByTestId('delete-reading-r1'));

    await waitFor(() => {
      expect(mockDeleteExecute).toHaveBeenCalled();
      expect(mockEnqueue).toHaveBeenCalledWith('Reading deleted', 'success');
      expect(mockReload).toHaveBeenCalled();
    });
  });

  it('shows an error toast and does not reload when the delete use case fails', async () => {
    mockDeleteExecute.mockResolvedValue({
      success: false,
      error: { code: 'METER_READING_NOT_FOUND', message: 'gone' },
    });
    const mockReload = jest.fn();
    mockUseMeterReadings.mockReturnValue({
      readings: [makeReading('r1', 1800, '2026-06-15', 30000)],
      loading: false,
      reload: mockReload,
    });
    const { getByTestId } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    fireEvent.press(getByTestId('delete-reading-r1'));

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith('Failed to delete reading', 'error');
    });
    expect(mockReload).not.toHaveBeenCalled();
  });

  // F3: deleting a middle reading must not leave the remaining readings'
  // consumption/rate frozen against the removed row — once the list reloads
  // without it, consumption must recompute against the true remaining
  // neighbour (index+1 in the desc-sorted `readings` array), not the deleted
  // one.
  it('recomputes consumption against the new neighbour after a middle reading is deleted', async () => {
    // Desc order: r3 (middle, about to be deleted) sits between r2 and r1.
    // Before delete, r2's consumption is against r3 (1200 - 1800 would be
    // negative/invalid, but for this test r3 is below r2 chronologically —
    // r2 is newest). After r3 is deleted and the list reloads, r2's
    // consumption must be computed against r1 instead: 1200 - 1000 = 200.
    const readingsBeforeDelete = [
      makeReading('r2', 1200, '2026-06-15', 20000),
      makeReading('r3', 1050, '2026-05-15', 10000),
      makeReading('r1', 1000, '2026-04-15', 0),
    ];
    const readingsAfterDelete = [
      makeReading('r2', 1200, '2026-06-15', 20000),
      makeReading('r1', 1000, '2026-04-15', 0),
    ];
    const mockReload = jest.fn().mockImplementation(() => {
      mockUseMeterReadings.mockReturnValue({
        readings: readingsAfterDelete,
        loading: false,
        reload: mockReload,
      });
    });
    mockUseMeterReadings.mockReturnValue({
      readings: readingsBeforeDelete,
      loading: false,
      reload: mockReload,
    });

    const { getByTestId, getByText, rerender } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    // Before delete: r2's consumption is against r3 (150.0 kWh).
    expect(getByText('150.0 kWh')).toBeTruthy();

    fireEvent.press(getByTestId('delete-reading-r3'));
    await waitFor(() => expect(mockDeleteExecute).toHaveBeenCalled());
    await waitFor(() => expect(mockReload).toHaveBeenCalled());

    rerender(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );

    // After r3 is deleted and the list reloads, r2's consumption must
    // recompute against its new true neighbour, r1: 200.0 kWh, not the
    // stale 150.0 kWh computed against the now-deleted r3.
    expect(getByText('200.0 kWh')).toBeTruthy();
  });
});
