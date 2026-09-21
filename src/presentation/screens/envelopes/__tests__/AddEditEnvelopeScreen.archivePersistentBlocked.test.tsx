/**
 * AddEditEnvelopeScreen.archivePersistentBlocked.test.tsx — F2
 *
 * A PERSISTENT envelope's ('savings' | 'sinking_fund' | 'emergency_fund' |
 * 'baby_step') SAVED balance is a derived figure from the contribution
 * ledger (`getPersistentEnvelopeSavedCents`), separate from `allocatedCents`
 * and NOT touched by archiving — the money stays in the ledger. But every
 * screen that shows it (BudgetScreen/SinkingFundsScreen/DashboardScreen)
 * reads it through `useEnvelopes`, which filters `is_archived = 0` — so an
 * archived fund's saved balance would stop appearing ANYWHERE in the
 * household's picture even though it still exists. That is worse than a
 * copy problem, so archiving a persistent envelope with a non-zero saved
 * balance must be BLOCKED (directing the household to "Adjust saved
 * amount" first) instead of merely re-worded.
 *
 * A separate file from the existing AddEditEnvelopeScreen.test.tsx (never
 * overwritten) so its own static `jest.mock`s can supply this scenario's
 * envelope type and non-zero saved balance.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockConfirm = jest.fn();
jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

jest.mock('../../../components/shared/DateField', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    DateField: ({ testID }: { testID?: string }) => React.createElement('TextInput', { testID }),
  };
});

jest.mock('../../../components/envelopes/AdjustSavedAmountDialog', () => ({
  AdjustSavedAmountDialog: () => null,
}));

const mockArchiveExecute = jest.fn();

jest.mock('../../../../data/local/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() =>
            Promise.resolve([
              {
                id: 'env-2',
                householdId: 'hh-1',
                name: 'Emergency Fund',
                allocatedCents: 100000,
                envelopeType: 'emergency_fund',
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
jest.mock('../../../../data/local/balances/EnvelopeBalanceQuery', () => ({
  getEnvelopeSpentCents: jest.fn().mockResolvedValue(new Map([['env-2', 0]])),
  getPersistentEnvelopeSavedCents: jest.fn().mockResolvedValue(new Map([['env-2', 350000]])), // R3,500 saved
}));
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));
jest.mock('../../../../domain/envelopes/CreateEnvelopeUseCase', () => ({
  CreateEnvelopeUseCase: jest.fn().mockImplementation(() => ({ execute: jest.fn() })),
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
import { formatCurrency } from '../../../utils/currency';

describe('AddEditEnvelopeScreen — F2 archive confirm (persistent envelope, non-zero saved balance)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockArchiveExecute.mockResolvedValue({ success: true });
  });

  it('blocks the archive with a message naming the saved amount and pointing at "Adjust saved amount", and never runs the archive use case', async () => {
    const { findByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: { envelopeId: 'env-2' } } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );

    const archiveButton = await findByTestId('archive-envelope-button');
    fireEvent.press(archiveButton);

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    const call = mockConfirm.mock.calls[0][0] as { title: string; message: string };
    // Not the normal "Archive envelope?" confirm — a different, blocking dialog.
    expect(call.title).not.toBe('Archive envelope?');
    expect(call.message).toContain(formatCurrency(350000));
    expect(call.message.toLowerCase()).toContain('adjust saved amount');

    // Confirm was shown exactly once (the block), and the archive use case
    // never ran — the household cannot get past this dialog into archiving.
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockArchiveExecute).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('does not archive when the saved balance cannot be read at archive time (unknown is not zero)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const balances = require('../../../../data/local/balances/EnvelopeBalanceQuery');
    const { findByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: { envelopeId: 'env-2' } } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );
    const archiveButton = await findByTestId('archive-envelope-button');
    balances.getPersistentEnvelopeSavedCents.mockRejectedValueOnce(new Error('db locked'));

    fireEvent.press(archiveButton);

    await waitFor(() =>
      expect(balances.getPersistentEnvelopeSavedCents.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockArchiveExecute).not.toHaveBeenCalled();
  });
});
