/**
 * AddEditEnvelopeScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ─── confirm() mock (ConfirmDialogHost) ────────────────────────────────────────
const mockConfirm = jest.fn();
jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

// ─── DateField mock ─────────────────────────────────────────────────────────────
jest.mock('../../../components/shared/DateField', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    DateField: ({
      value,
      onChange,
      testID,
    }: {
      value?: string | null;
      onChange?: (v: string) => void;
      testID?: string;
    }) => React.createElement('TextInput', { testID, value: value ?? '', onChangeText: onChange }),
  };
});

const mockArchiveExecute = jest.fn();

jest.mock('../../../../data/local/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() =>
            Promise.resolve([
              {
                id: 'env-1',
                householdId: 'hh-1',
                name: 'Groceries',
                allocatedCents: 500000,
                envelopeType: 'spending',
                periodStart: '2026-06-01',
                targetAmountCents: null,
                targetDate: null,
              },
            ]),
          ),
        })),
      })),
    })),
  },
}));
// spentCents is derived from the ledger (getEnvelopeSpentCents), not a stored column.
jest.mock('../../../../data/local/balances/EnvelopeBalanceQuery', () => ({
  getEnvelopeSpentCents: jest.fn().mockResolvedValue(new Map([['env-1', 0]])),
}));
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));
const mockCreateExecute = jest.fn();
jest.mock('../../../../domain/envelopes/CreateEnvelopeUseCase', () => ({
  CreateEnvelopeUseCase: jest.fn().mockImplementation(() => ({ execute: mockCreateExecute })),
}));
jest.mock('../../../../domain/envelopes/UpdateEnvelopeUseCase', () => ({
  UpdateEnvelopeUseCase: jest.fn().mockImplementation(() => ({ execute: jest.fn() })),
}));
jest.mock('../../../../domain/envelopes/ArchiveEnvelopeUseCase', () => ({
  ArchiveEnvelopeUseCase: jest.fn().mockImplementation(() => ({
    execute: mockArchiveExecute,
  })),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((sel: (s: { enqueue: () => void }) => unknown) =>
    sel({ enqueue: jest.fn() }),
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
  }) =>
    React.createElement('TextInput', {
      testID: testID ?? label,
      value,
      onChangeText,
      accessibilityLabel: label,
    });
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
    }: {
      children?: React.ReactNode;
      testID?: string;
      onPress?: () => void;
    }) =>
      React.createElement(
        'Pressable',
        { testID, onPress },
        React.createElement('Text', null, children),
      ),
    SegmentedButtons: () => React.createElement('View', null),
    Snackbar: ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
      visible ? React.createElement('Text', { testID: 'snackbar' }, children) : null,
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockSetOptions = jest.fn();
import { AddEditEnvelopeScreen } from '../AddEditEnvelopeScreen';

// Grabbed after the mock module has been loaded (see jest.mock above) — this
// picks up the already-registered mock constructor rather than referencing an
// external variable from inside the factory (which risks capturing it before
// assignment when import hoisting triggers the factory early).
const { CreateEnvelopeUseCase: MockCreateEnvelopeUseCase } = jest.requireMock(
  '../../../../domain/envelopes/CreateEnvelopeUseCase',
) as { CreateEnvelopeUseCase: jest.Mock };

describe('AddEditEnvelopeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateExecute.mockResolvedValue({ success: true });
    mockConfirm.mockResolvedValue(true);
  });

  it('renders without crashing (create mode)', () => {
    const { UNSAFE_root } = render(
      <AddEditEnvelopeScreen
        route={{ params: {} } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows error when archive fails', async () => {
    mockArchiveExecute.mockResolvedValueOnce({ success: false });
    mockConfirm.mockResolvedValue(true);

    const { findByTestId, getByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: { envelopeId: 'env-1' } } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );

    const archiveButton = await findByTestId('archive-envelope-button');
    fireEvent.press(archiveButton);

    await waitFor(() => {
      expect(getByTestId('snackbar')).toBeTruthy();
    });
  });

  it('accepts a thousands-separated budget amount and calls the use case', async () => {
    const { getByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: {} } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );

    fireEvent.changeText(getByTestId('envelope-name'), 'Groceries');
    fireEvent.changeText(getByTestId('envelope-amount'), '1,234.56');
    fireEvent.press(getByTestId('envelope-save'));

    await waitFor(() => {
      expect(mockCreateExecute).toHaveBeenCalled();
    });
    expect(MockCreateEnvelopeUseCase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ allocatedCents: 123456 }),
    );
  });

  it('accepts a comma-decimal budget amount and saves with the correct cents', async () => {
    const { getByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: {} } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );

    fireEvent.changeText(getByTestId('envelope-name'), 'Groceries');
    fireEvent.changeText(getByTestId('envelope-amount'), '1,50');
    fireEvent.press(getByTestId('envelope-save'));

    await waitFor(() => {
      expect(mockCreateExecute).toHaveBeenCalled();
    });

    expect(MockCreateEnvelopeUseCase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ allocatedCents: 150 }),
    );
  });

  it('treats a whitespace-only target amount as "no target" (skips parsing) and saves', async () => {
    const { getByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: { preselectedType: 'sinking_fund' } } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );

    fireEvent.changeText(getByTestId('envelope-name'), 'Holiday');
    fireEvent.changeText(getByTestId('envelope-amount'), '100');
    // A whitespace-only target must NOT hit parseMoneyInput's ERR_EMPTY —
    // it should be treated exactly like an empty target (no target set).
    fireEvent.changeText(getByTestId('target-amount-input'), '   ');
    fireEvent.press(getByTestId('envelope-save'));

    await waitFor(() => {
      expect(mockCreateExecute).toHaveBeenCalled();
    });

    expect(MockCreateEnvelopeUseCase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ envelopeType: 'sinking_fund', targetAmountCents: null }),
    );
  });

  // UX-10: editing locks the type as read-only (the SegmentedButtons only
  // lists 4 of the 7 EnvelopeTypes, so previously one tap while editing a
  // sinking_fund/emergency_fund/baby_step envelope silently converted it).
  it('shows the type as read-only text when editing an existing envelope', async () => {
    const { findByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: { envelopeId: 'env-1' } } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );

    const readOnlyType = await findByTestId('envelope-type-readonly');
    expect(readOnlyType).toBeTruthy();
  });

  it('does not show read-only type text in create mode', () => {
    const { queryByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: {} } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );
    expect(queryByTestId('envelope-type-readonly')).toBeNull();
  });

  it('does not archive when the confirm dialog is dismissed', async () => {
    mockConfirm.mockResolvedValue(false);
    const { findByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: { envelopeId: 'env-1' } } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );

    const archiveButton = await findByTestId('archive-envelope-button');
    fireEvent.press(archiveButton);

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockArchiveExecute).not.toHaveBeenCalled();
  });

  it('uses "Monthly contribution (R)" as the amount label for a persistent-scope type', () => {
    const { getByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: { preselectedType: 'sinking_fund' } } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );
    expect(getByTestId('envelope-amount').props.accessibilityLabel).toBe(
      'Monthly contribution (R)',
    );
  });

  it('uses "Monthly budget (R)" as the amount label for a period-scoped type', () => {
    const { getByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: {} } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );
    expect(getByTestId('envelope-amount').props.accessibilityLabel).toBe('Monthly budget (R)');
  });
});
