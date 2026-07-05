/**
 * LogPaymentScreen.test.tsx — C8 screen test
 *
 * H1/H7 (2026-07-05 exhaustive audit): the payment amount used to be parsed
 * with `Math.round(parseFloat(amountRands) * 100)`, silently mis-parsing
 * grouped/comma-decimal input (e.g. "1,500" -> R1.00 instead of R1,500) and
 * writing a wrong amount to the debt ledger with no error shown. It now uses
 * the locale-safe `parseMoneyInput`, mirroring AddDebtScreen.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const DEBT_ROW = {
  id: 'debt-1',
  creditorName: 'Visa',
  debtType: 'credit_card',
  outstandingBalanceCents: 500000,
  interestRatePercent: 20,
  minimumPaymentCents: 150000,
};

jest.mock('../../../../data/local/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([])),
      })),
    })),
  },
}));
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));

const mockExecute = jest.fn();
jest.mock('../../../../domain/debtSnowball/LogDebtPaymentUseCase', () => ({
  LogDebtPaymentUseCase: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string }) => unknown) =>
    sel({ householdId: 'hh-1' }),
  ),
}));
const mockEnqueue = jest.fn();
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((sel: (s: { enqueue: typeof mockEnqueue }) => unknown) =>
    sel({ enqueue: mockEnqueue }),
  ),
}));
jest.mock('drizzle-orm', () => ({ eq: jest.fn() }));
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
        React.createElement('Text', null, children),
      ),
    HelperText: ({ children, visible }: { children?: React.ReactNode; visible?: boolean }) =>
      visible ? React.createElement('Text', { testID: 'helper-error' }, children) : null,
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
import { LogPaymentScreen } from '../LogPaymentScreen';

// Grabbed after the mock module has been loaded — this picks up the
// already-registered mock constructor rather than referencing an external
// variable from inside the (hoisted) factory.
const { LogDebtPaymentUseCase: MockLogDebtPaymentUseCase } = jest.requireMock(
  '../../../../domain/debtSnowball/LogDebtPaymentUseCase',
) as { LogDebtPaymentUseCase: jest.Mock };

async function renderWithDebt(row: object = DEBT_ROW): Promise<ReturnType<typeof render>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { db } = require('../../../../data/local/db');
  db.select.mockReturnValue({
    from: jest.fn(() => ({
      where: jest.fn(() => Promise.resolve([row])),
    })),
  });
  const view = render(
    <LogPaymentScreen
      route={{ params: { debtId: 'debt-1' } } as never}
      navigation={{ navigate: mockNavigate, goBack: mockGoBack } as never}
    />,
  );
  // Let the debt-load effect's promise resolve before the test drives input.
  await waitFor(() => {
    expect(view.getByTestId('Payment amount (R)').props.value).toBe(
      ((row as { minimumPaymentCents: number }).minimumPaymentCents / 100).toFixed(2),
    );
  });
  return view;
}

describe('LogPaymentScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecute.mockResolvedValue({ success: true });
  });

  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <LogPaymentScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={{ navigate: mockNavigate, goBack: mockGoBack } as never}
      />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders payment input', () => {
    const { getByTestId } = render(
      <LogPaymentScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={{ navigate: mockNavigate, goBack: mockGoBack } as never}
      />,
    );
    expect(getByTestId('Payment amount (R)')).toBeTruthy();
  });

  it('renders Record Payment button', () => {
    const { getByText } = render(
      <LogPaymentScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={{ navigate: mockNavigate, goBack: mockGoBack } as never}
      />,
    );
    expect(getByText('Record Payment')).toBeTruthy();
  });

  // ── Money parsing (H1/H7) ──────────────────────────────────────────────
  it('accepts a thousands-separated payment amount and saves with the correct cents', async () => {
    const view = await renderWithDebt();

    fireEvent.changeText(view.getByTestId('Payment amount (R)'), '1,500');

    await act(async () => {
      fireEvent.press(view.getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });
    expect(MockLogDebtPaymentUseCase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ paymentAmountCents: 150000 }),
    );
  });

  it('accepts a comma-decimal payment amount and saves with the correct cents', async () => {
    const view = await renderWithDebt();

    fireEvent.changeText(view.getByTestId('Payment amount (R)'), '10,50');

    await act(async () => {
      fireEvent.press(view.getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });
    expect(MockLogDebtPaymentUseCase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ paymentAmountCents: 1050 }),
    );
  });

  it('rejects an ambiguous grouped amount, shows an inline error and does not call the use case', async () => {
    const view = await renderWithDebt();

    fireEvent.changeText(view.getByTestId('Payment amount (R)'), '1,234.56.78');

    await act(async () => {
      fireEvent.press(view.getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(view.queryByTestId('helper-error')).toBeTruthy();
    });
    expect(MockLogDebtPaymentUseCase).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects empty input with an inline error and does not call the use case', async () => {
    const view = await renderWithDebt();

    fireEvent.changeText(view.getByTestId('Payment amount (R)'), '');

    await act(async () => {
      fireEvent.press(view.getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(view.queryByTestId('helper-error')).toBeTruthy();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
