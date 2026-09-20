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

// VAL2-7: optional envelope-side transaction created before the debt
// payment, and rolled back with this if the debt payment fails after.
const mockCreateTxExecute = jest.fn();
jest.mock('../../../../domain/transactions/CreateTransactionUseCase', () => ({
  CreateTransactionUseCase: jest.fn().mockImplementation((...args: unknown[]) => ({
    execute: mockCreateTxExecute,
    __input: args[2],
  })),
}));
const mockDeleteTxExecute = jest.fn().mockResolvedValue({ success: true });
jest.mock('../../../../domain/transactions/DeleteTransactionUseCase', () => ({
  DeleteTransactionUseCase: jest.fn().mockImplementation((...args: unknown[]) => ({
    execute: mockDeleteTxExecute,
    __tx: args[2],
  })),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));
const mockEnqueue = jest.fn();
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((sel: (s: { enqueue: typeof mockEnqueue }) => unknown) =>
    sel({ enqueue: mockEnqueue }),
  ),
}));
jest.mock('drizzle-orm', () => ({
  eq: jest.fn(),
  and: jest.fn(),
  ne: jest.fn(),
}));

// VAL2-7: LogPaymentScreen now also loads the envelope list (for the
// optional "Also take it from an envelope" picker) — mocked exactly like
// AddTransactionScreen's equivalent tests so it never touches the real
// `sql` tagged template (drizzle-orm is fully mocked above) or a real db.
jest.mock('../../../../data/local/balances/EnvelopeBalanceQuery', () => ({
  getEnvelopeSpentCents: jest.fn().mockResolvedValue(new Map()),
  envelopeScopeCondition: jest.fn(() => 'scope-condition'),
}));

jest.mock('../../slipScanning/components/EnvelopePickerSheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    EnvelopePickerSheet: ({
      visible,
      envelopes,
      onSelect,
      onClose,
    }: {
      visible?: boolean;
      envelopes: Array<{ id: string; name: string }>;
      onSelect: (env: { id: string; name: string }) => void;
      onClose: () => void;
    }) =>
      visible
        ? React.createElement(
            'View',
            { testID: 'envelope-picker-sheet' },
            envelopes.map((env) =>
              React.createElement(
                'Pressable',
                {
                  key: env.id,
                  testID: `envelope-option-${env.id}`,
                  onPress: () => {
                    onSelect(env);
                    onClose();
                  },
                },
                env.name,
              ),
            ),
          )
        : null,
  };
});
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
    TouchableRipple: ({
      children,
      onPress,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
      [k: string]: unknown;
    }) => React.createElement('Pressable', { onPress, testID, ...p }, children),
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

const ENVELOPE_ROW = {
  id: 'env-1',
  name: 'Groceries',
  allocatedCents: 100000,
  envelopeType: 'spending',
};

async function renderWithDebt(
  row: object = DEBT_ROW,
  envelopeRows: object[] = [],
): Promise<ReturnType<typeof render>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { db } = require('../../../../data/local/db');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { debts: debtsTable } = require('../../../../data/local/schema');
  // Differentiates the debt-row query from the envelope-list query by which
  // table `.from(...)` was called with (both real, unmocked schema column
  // objects — the same module instance the screen itself imports).
  db.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => Promise.resolve(table === debtsTable ? [row] : envelopeRows),
    }),
  }));
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
    mockExecute.mockResolvedValue({ success: true, data: { isPaidOff: false } });
    mockCreateTxExecute.mockResolvedValue({
      success: true,
      data: { id: 'tx-1', householdId: 'hh-1', envelopeId: 'env-1', amountCents: 0 },
    });
    mockDeleteTxExecute.mockResolvedValue({ success: true });
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

  // ── VAL2-7: optional "Also take it from an envelope" ──────────────────
  describe('optional envelope transaction', () => {
    it('does not show the envelope picker until the toggle is turned on', async () => {
      const view = await renderWithDebt(DEBT_ROW, [ENVELOPE_ROW]);
      expect(view.queryByTestId('log-payment-envelope-picker-trigger')).toBeNull();

      fireEvent(view.getByTestId('take-from-envelope-toggle'), 'valueChange', true);
      await waitFor(() => {
        expect(view.getByTestId('log-payment-envelope-picker-trigger')).toBeTruthy();
      });
    });

    it('logs only the debt payment when the toggle is left off', async () => {
      const view = await renderWithDebt(DEBT_ROW, [ENVELOPE_ROW]);
      await act(async () => {
        fireEvent.press(view.getByTestId('save-button'));
      });
      await waitFor(() => expect(mockExecute).toHaveBeenCalled());
      expect(mockCreateTxExecute).not.toHaveBeenCalled();
      expect(mockEnqueue).toHaveBeenCalledWith('Payment logged', 'success');
    });

    it('creates the envelope transaction FIRST, then the debt payment, when an envelope is chosen', async () => {
      const { CreateTransactionUseCase: MockCreateTransactionUseCase } = jest.requireMock(
        '../../../../domain/transactions/CreateTransactionUseCase',
      ) as { CreateTransactionUseCase: jest.Mock };

      const view = await renderWithDebt(DEBT_ROW, [ENVELOPE_ROW]);
      fireEvent(view.getByTestId('take-from-envelope-toggle'), 'valueChange', true);
      await waitFor(() => view.getByTestId('log-payment-envelope-picker-trigger'));
      fireEvent.press(view.getByTestId('log-payment-envelope-picker-trigger'));
      fireEvent.press(await view.findByTestId('envelope-option-env-1'));

      const callOrder: string[] = [];
      mockCreateTxExecute.mockImplementation(async () => {
        callOrder.push('create-transaction');
        return { success: true, data: { id: 'tx-1', householdId: 'hh-1', envelopeId: 'env-1' } };
      });
      mockExecute.mockImplementation(async () => {
        callOrder.push('log-debt-payment');
        return { success: true, data: { isPaidOff: false } };
      });

      await act(async () => {
        fireEvent.press(view.getByTestId('save-button'));
      });

      await waitFor(() => expect(mockExecute).toHaveBeenCalled());
      expect(callOrder).toEqual(['create-transaction', 'log-debt-payment']);
      expect(MockCreateTransactionUseCase).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          envelopeId: 'env-1',
          payee: DEBT_ROW.creditorName,
          description: 'Debt payment',
        }),
      );
      expect(mockDeleteTxExecute).not.toHaveBeenCalled();
    });

    it('does not log a debt payment when the envelope transaction fails', async () => {
      mockCreateTxExecute.mockResolvedValue({
        success: false,
        error: { code: 'ENVELOPE_ARCHIVED', message: 'That envelope is archived' },
      });
      const view = await renderWithDebt(DEBT_ROW, [ENVELOPE_ROW]);
      fireEvent(view.getByTestId('take-from-envelope-toggle'), 'valueChange', true);
      await waitFor(() => view.getByTestId('log-payment-envelope-picker-trigger'));
      fireEvent.press(view.getByTestId('log-payment-envelope-picker-trigger'));
      fireEvent.press(await view.findByTestId('envelope-option-env-1'));

      await act(async () => {
        fireEvent.press(view.getByTestId('save-button'));
      });

      await waitFor(() => {
        expect(view.queryByTestId('helper-error')).toBeTruthy();
      });
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('deletes the envelope transaction and shows the error when the debt payment fails afterwards', async () => {
      mockExecute.mockResolvedValue({
        success: false,
        error: { code: 'DEBT_NOT_FOUND', message: 'Debt no longer exists' },
      });
      const view = await renderWithDebt(DEBT_ROW, [ENVELOPE_ROW]);
      fireEvent(view.getByTestId('take-from-envelope-toggle'), 'valueChange', true);
      await waitFor(() => view.getByTestId('log-payment-envelope-picker-trigger'));
      fireEvent.press(view.getByTestId('log-payment-envelope-picker-trigger'));
      fireEvent.press(await view.findByTestId('envelope-option-env-1'));

      await act(async () => {
        fireEvent.press(view.getByTestId('save-button'));
      });

      await waitFor(() => {
        expect(mockDeleteTxExecute).toHaveBeenCalled();
      });
      expect(view.getByTestId('helper-error')).toBeTruthy();
    });

    it('shows a celebration toast instead of the generic one when the debt is paid off', async () => {
      mockExecute.mockResolvedValue({ success: true, data: { isPaidOff: true } });
      const view = await renderWithDebt(DEBT_ROW, [ENVELOPE_ROW]);

      await act(async () => {
        fireEvent.press(view.getByTestId('save-button'));
      });

      await waitFor(() => {
        expect(mockEnqueue).toHaveBeenCalledWith(
          `${DEBT_ROW.creditorName} is paid off! 🎉`,
          'success',
        );
      });
    });
  });
});
