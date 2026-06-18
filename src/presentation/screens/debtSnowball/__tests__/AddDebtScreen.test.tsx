/**
 * AddDebtScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));

const mockExecute = jest.fn();
jest.mock('../../../../domain/debtSnowball/CreateDebtUseCase', () => ({
  CreateDebtUseCase: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
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
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
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
    SegmentedButtons: () => React.createElement('View', { testID: 'debt-type-selector' }),
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockNavigation = { navigate: mockNavigate, goBack: mockGoBack } as never;
import { AddDebtScreen } from '../AddDebtScreen';

describe('AddDebtScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecute.mockResolvedValue({ success: true });
  });

  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <AddDebtScreen route={{} as never} navigation={mockNavigation} />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders debt type selector', () => {
    const { getByTestId } = render(
      <AddDebtScreen route={{} as never} navigation={mockNavigation} />,
    );
    expect(getByTestId('debt-type-selector')).toBeTruthy();
  });

  it('renders all input fields', () => {
    const { getByTestId } = render(
      <AddDebtScreen route={{} as never} navigation={mockNavigation} />,
    );
    expect(getByTestId('Creditor / Account name')).toBeTruthy();
    expect(getByTestId('Outstanding balance (R)')).toBeTruthy();
    expect(getByTestId('Interest rate (%)')).toBeTruthy();
    expect(getByTestId('Minimum monthly payment (R)')).toBeTruthy();
  });

  // ── Validation ───────────────────────────────────────────────────────────
  it('shows error when creditor name is empty', async () => {
    const { getByTestId, queryByTestId } = render(
      <AddDebtScreen route={{} as never} navigation={mockNavigation} />,
    );

    fireEvent.changeText(getByTestId('Outstanding balance (R)'), '5000');
    fireEvent.changeText(getByTestId('Interest rate (%)'), '20');
    fireEvent.changeText(getByTestId('Minimum monthly payment (R)'), '500');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('shows error when balance is invalid', async () => {
    const { getByTestId, queryByTestId } = render(
      <AddDebtScreen route={{} as never} navigation={mockNavigation} />,
    );

    fireEvent.changeText(getByTestId('Creditor / Account name'), 'Visa');
    fireEvent.changeText(getByTestId('Outstanding balance (R)'), 'abc');
    fireEvent.changeText(getByTestId('Interest rate (%)'), '20');
    fireEvent.changeText(getByTestId('Minimum monthly payment (R)'), '500');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
  });

  it('shows error when interest rate is negative', async () => {
    const { getByTestId, queryByTestId } = render(
      <AddDebtScreen route={{} as never} navigation={mockNavigation} />,
    );

    fireEvent.changeText(getByTestId('Creditor / Account name'), 'Visa');
    fireEvent.changeText(getByTestId('Outstanding balance (R)'), '5000');
    fireEvent.changeText(getByTestId('Interest rate (%)'), '-5');
    fireEvent.changeText(getByTestId('Minimum monthly payment (R)'), '500');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
  });

  it('shows error when minimum payment is zero', async () => {
    const { getByTestId, queryByTestId } = render(
      <AddDebtScreen route={{} as never} navigation={mockNavigation} />,
    );

    fireEvent.changeText(getByTestId('Creditor / Account name'), 'Visa');
    fireEvent.changeText(getByTestId('Outstanding balance (R)'), '5000');
    fireEvent.changeText(getByTestId('Interest rate (%)'), '20');
    fireEvent.changeText(getByTestId('Minimum monthly payment (R)'), '0');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
  });

  // ── Successful save ──────────────────────────────────────────────────────
  it('saves successfully and navigates back', async () => {
    const { getByTestId } = render(
      <AddDebtScreen route={{} as never} navigation={mockNavigation} />,
    );

    fireEvent.changeText(getByTestId('Creditor / Account name'), 'Visa');
    fireEvent.changeText(getByTestId('Outstanding balance (R)'), '5000');
    fireEvent.changeText(getByTestId('Interest rate (%)'), '20');
    fireEvent.changeText(getByTestId('Minimum monthly payment (R)'), '500');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
      expect(mockEnqueue).toHaveBeenCalledWith('Debt saved', 'success');
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────
  it('shows error when use case returns failure', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      error: { message: 'Duplicate creditor' },
    });

    const { getByTestId, queryByTestId } = render(
      <AddDebtScreen route={{} as never} navigation={mockNavigation} />,
    );

    fireEvent.changeText(getByTestId('Creditor / Account name'), 'Visa');
    fireEvent.changeText(getByTestId('Outstanding balance (R)'), '5000');
    fireEvent.changeText(getByTestId('Interest rate (%)'), '20');
    fireEvent.changeText(getByTestId('Minimum monthly payment (R)'), '500');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('shows error when use case throws exception', async () => {
    mockExecute.mockRejectedValue(new Error('Network failure'));

    const { getByTestId, queryByTestId } = render(
      <AddDebtScreen route={{} as never} navigation={mockNavigation} />,
    );

    fireEvent.changeText(getByTestId('Creditor / Account name'), 'Visa');
    fireEvent.changeText(getByTestId('Outstanding balance (R)'), '5000');
    fireEvent.changeText(getByTestId('Interest rate (%)'), '20');
    fireEvent.changeText(getByTestId('Minimum monthly payment (R)'), '500');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('accepts zero interest rate (interest-free)', async () => {
    const { getByTestId } = render(
      <AddDebtScreen route={{} as never} navigation={mockNavigation} />,
    );

    fireEvent.changeText(getByTestId('Creditor / Account name'), 'Store Account');
    fireEvent.changeText(getByTestId('Outstanding balance (R)'), '3000');
    fireEvent.changeText(getByTestId('Interest rate (%)'), '0');
    fireEvent.changeText(getByTestId('Minimum monthly payment (R)'), '300');

    await act(async () => {
      fireEvent.press(getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
      expect(mockGoBack).toHaveBeenCalled();
    });
  });
});
