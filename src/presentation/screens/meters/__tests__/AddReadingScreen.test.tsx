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
jest.mock('drizzle-orm', () => ({ and: jest.fn(), eq: jest.fn(), desc: jest.fn() }));
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
});
