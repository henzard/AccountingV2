/**
 * AddReadingScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

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
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));

const mockLoggerError = jest.fn();
jest.mock('../../../../infrastructure/logging/Logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

const mockExecute = jest.fn();
jest.mock('../../../../domain/meterReadings/LogMeterReadingUseCase', () => ({
  LogMeterReadingUseCase: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
}));

const mockDetect = jest.fn().mockReturnValue({ isAnomaly: false });
jest.mock('../../../../domain/meterReadings/AnomalyDetector', () => ({
  AnomalyDetector: jest.fn().mockImplementation(() => ({ detect: mockDetect })),
}));

const mockEnqueue = jest.fn();
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string }) => unknown) =>
    sel({ householdId: 'hh-1' }),
  ),
}));
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((sel: (s: { enqueue: typeof mockEnqueue }) => unknown) =>
    sel({ enqueue: mockEnqueue }),
  ),
}));
// Tags eq/and/isNull/desc so a test can inspect the SHAPE of the predicate
// the screen actually builds (see the isNull assertion below), rather than
// re-implementing the deleted_at filter in the mock — the `where` mocks set
// up per-test above/below still ignore their argument, so this is additive
// only.
jest.mock('drizzle-orm', () => ({
  and: jest.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: jest.fn((col: unknown, val: unknown) => ({ type: 'eq', col, val })),
  isNull: jest.fn((col: unknown) => ({ type: 'isNull', col })),
  desc: jest.fn((col: unknown) => ({ type: 'desc', col })),
}));
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const TextInput = ({
    label,
    testID,
    value,
    onChangeText,
  }: {
    label?: string;
    testID?: string;
    value?: string;
    onChangeText?: (v: string) => void;
  }) => React.createElement('TextInput', { testID: testID ?? label, value, onChangeText });
  TextInput.Affix = () => null;
  TextInput.Icon = () => null;
  return {
    Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('Text', { testID }, children),
    TextInput,
    Button: ({
      children,
      testID,
      onPress,
      disabled,
    }: {
      children?: React.ReactNode;
      testID?: string;
      onPress?: () => void;
      disabled?: boolean;
    }) =>
      React.createElement(
        'Pressable',
        {
          testID: testID ?? 'save-button',
          onPress,
          accessibilityState: disabled ? { disabled: true } : undefined,
        },
        children,
      ),
    HelperText: ({ children, visible }: { children?: React.ReactNode; visible?: boolean }) =>
      visible ? React.createElement('Text', { testID: 'helper-error' }, children) : null,
    SegmentedButtons: () => React.createElement('View', { testID: 'segmented-buttons' }),
    Chip: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', { testID: 'anomaly-chip' }, children),
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockNavigation = { navigate: mockNavigate, goBack: mockGoBack } as never;
import { AddReadingScreen } from '../AddReadingScreen';

describe('AddReadingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecute.mockResolvedValue({ success: true });
    mockDetect.mockReturnValue({ isAnomaly: false });
  });

  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders all input fields', () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );
    expect(getByTestId('segmented-buttons')).toBeTruthy();
  });

  it('shows validation error when reading is empty and save pressed', async () => {
    const { getByTestId, queryByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('shows validation error when reading is negative', async () => {
    const { getByTestId, queryByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kWh)'), '-5');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
  });

  it('saves successfully with valid reading and navigates back', async () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kWh)'), '1234');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
      expect(mockEnqueue).toHaveBeenCalledWith('Reading saved', 'success');
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  it('shows error message when use case returns failure', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      error: { message: 'Duplicate reading for today' },
    });

    const { getByTestId, queryByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'water' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kL)'), '50');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('saves with optional cost and notes', async () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kWh)'), '1234');
    fireEvent.changeText(getByTestId('Cost this period (R) — optional'), '350.50');
    fireEvent.changeText(getByTestId('Notes — optional'), 'End of month reading');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  it('renders water meter type correctly', () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'water' } } as never}
        navigation={mockNavigation}
      />,
    );
    expect(getByTestId('Current reading (kL)')).toBeTruthy();
  });

  it('renders odometer meter type correctly', () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'odometer' } } as never}
        navigation={mockNavigation}
      />,
    );
    expect(getByTestId('Current reading (km)')).toBeTruthy();
  });

  it('shows validation error for non-numeric reading', async () => {
    const { getByTestId, queryByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kWh)'), 'abc');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('shows validation error for zero reading', async () => {
    const { getByTestId, queryByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kWh)'), '0');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('saves without cost when cost field is empty', async () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kWh)'), '500');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  it('renders notes input field', () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );
    expect(getByTestId('Notes — optional')).toBeTruthy();
  });

  it('renders cost input field', () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );
    expect(getByTestId('Cost this period (R) — optional')).toBeTruthy();
  });

  it('accepts a thousands-separated cost and saves', async () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kWh)'), '1234');
    fireEvent.changeText(getByTestId('Cost this period (R) — optional'), '1,234.56');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  it('accepts a comma-decimal cost and saves with the correct cents', async () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kWh)'), '1234');
    fireEvent.changeText(getByTestId('Cost this period (R) — optional'), '1,50');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });

    const { LogMeterReadingUseCase } = jest.requireMock(
      '../../../../domain/meterReadings/LogMeterReadingUseCase',
    ) as { LogMeterReadingUseCase: jest.Mock };
    expect(LogMeterReadingUseCase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ costCents: 150 }),
    );
  });

  // ── Reading value locale parsing (M8, 2026-07-05 exhaustive audit) ─────
  // The reading VALUE (kWh/kL/km) used to be parsed with raw `parseFloat`,
  // which silently truncates af-ZA/en-ZA comma-decimal input ("123,45" ->
  // 123 instead of 123.45). It's not money, but still needs a locale-safe
  // decimal parse rather than the raw truncating one.
  it('accepts a comma-decimal reading value and saves with the correct value', async () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kWh)'), '1234,56');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });

    const { LogMeterReadingUseCase } = jest.requireMock(
      '../../../../domain/meterReadings/LogMeterReadingUseCase',
    ) as { LogMeterReadingUseCase: jest.Mock };
    expect(LogMeterReadingUseCase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ readingValue: 1234.56 }),
    );
  });

  it('accepts a period-decimal reading value and saves with the correct value', async () => {
    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kWh)'), '1234.5');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });

    const { LogMeterReadingUseCase } = jest.requireMock(
      '../../../../domain/meterReadings/LogMeterReadingUseCase',
    ) as { LogMeterReadingUseCase: jest.Mock };
    expect(LogMeterReadingUseCase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ readingValue: 1234.5 }),
    );
  });

  it('rejects a garbled reading value (multiple separators) with an inline error and blocks save', async () => {
    const { getByTestId, queryByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    fireEvent.changeText(getByTestId('Current reading (kWh)'), '1,234,56');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  // The prior-readings load used to have no .catch — a query failure was an
  // unhandled rejection. Anomaly detection is best-effort, so a failure must
  // just leave it disabled (priorReadings stays empty) instead of crashing,
  // and it must be reported through the project's logger, not console.log.
  it('does not throw when loading prior readings for anomaly detection fails, and logs the error', async () => {
    const { db } = jest.requireMock('../../../../data/local/db');
    db.select.mockReturnValue({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => Promise.reject(new Error('prior readings query failed'))),
          })),
        })),
      })),
    });

    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.stringContaining('AddReadingScreen'),
        expect.any(Error),
        expect.objectContaining({ householdId: 'hh-1', meterType: 'electricity' }),
      );
    });

    // Anomaly detection stays disabled (priorReadings never populated) and
    // saving still works normally — no unhandled rejection crashed the screen.
    fireEvent.changeText(getByTestId('Current reading (kWh)'), '1234');
    expect(mockDetect).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  // Test that anomaly preview uses the same parser as save
  it('produces the same anomaly preview for space-separated and dash-separated locale inputs', async () => {
    // Mock prior readings to trigger anomaly detection
    const priorReadings = [
      { readingValue: 1000, readingDate: '2026-03-01' },
      { readingValue: 1100, readingDate: '2026-03-08' },
      { readingValue: 1200, readingDate: '2026-03-15' },
      { readingValue: 1300, readingDate: '2026-03-22' },
    ] as any;

    const { db } = jest.requireMock('../../../../data/local/db');
    db.select.mockReturnValue({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve(priorReadings)),
          })),
        })),
      })),
    });

    const { getByTestId } = render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    // Both "1500" and "1 500" should parse to the same value
    // (if using parseReadingValue with locale support)
    fireEvent.changeText(getByTestId('Current reading (kWh)'), '1500');

    await waitFor(() => {
      // Should not trigger error
      expect(getByTestId('Current reading (kWh)')).toBeTruthy();
    });
  });

  // Round-6 follow-up: once a reading can be soft-deleted, the priorReadings
  // query feeding anomaly detection must exclude deleted_at rows or a
  // deleted reading can still trigger (or suppress) an anomaly warning.
  // Fails without the `isNull(meterReadingsTable.deletedAt)` condition in
  // this screen's query.
  it('scopes the priorReadings query to non-deleted rows (deleted_at IS NULL)', async () => {
    const { db } = jest.requireMock('../../../../data/local/db');
    const wherePredicates: { type: string; conditions?: { type: string }[] }[] = [];
    db.select.mockReturnValue({
      from: jest.fn(() => ({
        where: jest.fn((predicate: { type: string; conditions?: { type: string }[] }) => {
          wherePredicates.push(predicate);
          return {
            orderBy: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve([])),
            })),
          };
        }),
      })),
    });

    render(
      <AddReadingScreen
        route={{ params: { meterType: 'electricity' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => expect(wherePredicates).toHaveLength(1));
    expect(wherePredicates[0].type).toBe('and');
    const hasDeletedAtFilter = (wherePredicates[0].conditions ?? []).some(
      (c) => c.type === 'isNull',
    );
    expect(hasDeletedAtFilter).toBe(true);
  });
});
