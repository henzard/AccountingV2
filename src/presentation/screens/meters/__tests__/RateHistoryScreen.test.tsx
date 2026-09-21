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

  // MTR-3: the hook is fetched with the raw array — 24 rows on screen plus
  // one boundary row that's used to compute the 24th row's consumption but
  // never rendered.
  it('requests one extra row beyond the render window from the hook', () => {
    mockUseMeterReadings.mockReturnValue({ readings: [], loading: false, reload: jest.fn() });
    render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    expect(mockUseMeterReadings).toHaveBeenCalledWith('hh-1', 'electricity', 25);
  });

  // MTR-3: with a full 25-row fetch, the 24th (last VISIBLE) row must NOT be
  // mislabelled "First reading" — it has a real previous reading (the 25th,
  // unrendered, boundary row) to compute consumption against.
  it('does not mislabel the last visible row "First reading" when a 25th boundary row exists, and does not render the boundary row itself', () => {
    const readings = Array.from({ length: 25 }, (_, i) =>
      makeReading(`r${i}`, 1000 + (24 - i) * 10, `2026-01-${String(25 - i).padStart(2, '0')}`, 0),
    );
    // readings[0] is newest (2026-01-25, value 1240), readings[24] is oldest
    // (2026-01-01, value 1000) — desc order, as the real hook returns.
    mockUseMeterReadings.mockReturnValue({ readings, loading: false, reload: jest.fn() });
    const { queryAllByText, queryByText } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );

    // No row is labelled "First reading" — the 24th visible row (readings[23])
    // has a real previous reading (readings[24], the unrendered boundary row).
    expect(queryByText('First reading')).toBeNull();
    // The boundary row's own value must never be rendered.
    expect(queryAllByText(/1000/).length).toBe(0);
  });

  // MTR-3: when there truly is no reading older than the fetch window (fewer
  // than 25 total), the oldest visible row IS genuinely first.
  it('still labels the oldest row "First reading" when there is genuinely no older reading', () => {
    mockUseMeterReadings.mockReturnValue({
      readings: [
        makeReading('r2', 1200, '2026-06-15', 20000),
        makeReading('r1', 1000, '2026-05-15', 0),
      ],
      loading: false,
      reload: jest.fn(),
    });
    const { getByText } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    expect(getByText('First reading')).toBeTruthy();
  });

  // MTR-2: a replaced/new meter's reading legitimately drops below the
  // previous one, which UnitRateCalculator rejects as non-positive
  // consumption. That pair must not be mislabelled "First reading" (there
  // IS a previous reading for it) and must not crash or show a negative
  // figure — while the row that IS genuinely the first ever reading (r1,
  // with no previous at all) still correctly says "First reading".
  it('shows a replaced-meter message (not "First reading" or a negative figure) for the pair straddling a meter replacement', () => {
    mockUseMeterReadings.mockReturnValue({
      readings: [
        makeReading('r3', 45, '2026-03-01', 0), // normal continuation on the new meter
        makeReading('r2', 20, '2026-02-01', 0), // new meter, dropped below r1
        makeReading('r1', 5000, '2026-01-01', 30000), // genuinely the first-ever reading
      ],
      loading: false,
      reload: jest.fn(),
    });
    const { getByText, queryAllByText, queryByText } = render(
      <RateHistoryScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={{} as never}
      />,
    );
    // r3 vs r2: normal positive consumption on the new meter.
    expect(getByText('25.0 kWh')).toBeTruthy();
    // r2 vs r1: non-positive consumption across the replacement — replaced
    // message, not "First reading", and never a negative figure.
    expect(getByText(/Meter replaced/)).toBeTruthy();
    // r1 has no previous at all — it genuinely is the first reading, and
    // only it gets that label.
    expect(queryAllByText('First reading')).toHaveLength(1);
    expect(queryByText(/^-/)).toBeNull();
  });
});
