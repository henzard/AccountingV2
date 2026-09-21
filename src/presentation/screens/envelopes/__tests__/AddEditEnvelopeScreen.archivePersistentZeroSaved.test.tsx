/**
 * AddEditEnvelopeScreen.archivePersistentZeroSaved.test.tsx — F2
 *
 * A persistent envelope whose SAVED balance
 * (`getPersistentEnvelopeSavedCents`) is zero has nothing to lose from
 * every screen's totals by archiving, so it must NOT be blocked the way a
 * fund with money in it is (see
 * AddEditEnvelopeScreen.archivePersistentBlocked.test.tsx) — the normal
 * "Archive envelope?" confirm should run and, since its allocation is also
 * zero, use the original simple copy.
 *
 * A separate file from the existing AddEditEnvelopeScreen.test.tsx (never
 * overwritten) so its own static `jest.mock`s can supply this scenario's
 * envelope type with a zero saved balance.
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
                id: 'env-3',
                householdId: 'hh-1',
                name: 'New Sinking Fund',
                allocatedCents: 0,
                envelopeType: 'sinking_fund',
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
  getEnvelopeSpentCents: jest.fn().mockResolvedValue(new Map([['env-3', 0]])),
  getPersistentEnvelopeSavedCents: jest.fn().mockResolvedValue(new Map([['env-3', 0]])),
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

describe('AddEditEnvelopeScreen — F2 archive confirm (persistent envelope, zero saved balance)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockArchiveExecute.mockResolvedValue({ success: true });
  });

  it('does not block the archive, and shows the normal confirm dialog', async () => {
    const { findByTestId } = render(
      <AddEditEnvelopeScreen
        route={{ params: { envelopeId: 'env-3' } } as never}
        navigation={
          { navigate: mockNavigate, goBack: mockGoBack, setOptions: mockSetOptions } as never
        }
      />,
    );

    const archiveButton = await findByTestId('archive-envelope-button');
    fireEvent.press(archiveButton);

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    const call = mockConfirm.mock.calls[0][0] as { title: string; message: string };
    expect(call.title).toBe('Archive envelope?');
    expect(call.message).toBe(
      'Historical transactions will keep their envelope name. You can not undo this.',
    );

    await waitFor(() => expect(mockArchiveExecute).toHaveBeenCalled());
  });
});
