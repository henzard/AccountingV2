/**
 * EnvelopeDetailSheet.test.tsx — C8 component test
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../../../../data/local/db', () => ({ db: {} }));

const mockResolveEnvelopeTransactions = jest.fn();
jest.mock('../../resolveEnvelopeTransactions', () => ({
  resolveEnvelopeTransactions: (...args: unknown[]) => mockResolveEnvelopeTransactions(...args),
}));

jest.mock('react-native-paper', () => {
  const React = jest.requireActual('react');
  return {
    Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('Text', { testID }, children),
    Button: ({
      children,
      onPress,
      testID,
      accessibilityLabel,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
      accessibilityLabel?: string;
    }) => React.createElement('Pressable', { onPress, testID, accessibilityLabel }, children),
    ActivityIndicator: ({ testID }: { testID?: string }) => React.createElement('View', { testID }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../../components/envelopes/AdjustSavedAmountDialog', () => ({
  AdjustSavedAmountDialog: ({ visible }: { visible: boolean }) => {
    const React = jest.requireActual('react');
    return visible ? React.createElement('View', { testID: 'adjust-saved-dialog-stub' }) : null;
  },
}));

import { EnvelopeDetailSheet } from '../EnvelopeDetailSheet';
import type { EnvelopeEntity } from '../../../../../domain/envelopes/EnvelopeEntity';

const SPEND_ENVELOPE: EnvelopeEntity = {
  id: 'env-1',
  householdId: 'hh-1',
  name: 'Groceries',
  allocatedCents: 200000,
  spentCents: 50000,
  envelopeType: 'spending',
  isSavingsLocked: false,
  isArchived: false,
  periodStart: '2026-09-01',
  targetAmountCents: null,
  targetDate: null,
  createdAt: '2026-09-01',
  updatedAt: '2026-09-01',
};

const PERSISTENT_ENVELOPE: EnvelopeEntity = {
  ...SPEND_ENVELOPE,
  id: 'ef-1',
  name: 'Emergency Fund',
  envelopeType: 'emergency_fund',
  allocatedCents: 100000,
  spentCents: 900000,
};

describe('EnvelopeDetailSheet', () => {
  const onDismiss = jest.fn();
  const onAddTransaction = jest.fn();
  const onOpenTransaction = jest.fn();
  const onEditEnvelope = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveEnvelopeTransactions.mockResolvedValue([]);
  });

  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(
      <EnvelopeDetailSheet
        visible={false}
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    expect(queryByTestId('envelope-detail-sheet')).toBeNull();
  });

  it('renders nothing when there is no envelope', () => {
    const { queryByTestId } = render(
      <EnvelopeDetailSheet
        visible
        envelope={null}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    expect(queryByTestId('envelope-detail-sheet')).toBeNull();
  });

  it('shows allocated/spent/remaining for a period-scoped envelope', async () => {
    const { findByTestId, getByText } = render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    await findByTestId('envelope-detail-sheet');
    expect(getByText('R2 000,00')).toBeTruthy(); // allocated
    expect(getByText('R500,00')).toBeTruthy(); // spent
    expect(getByText('R1 500,00')).toBeTruthy(); // remaining
  });

  it('shows saved balance and monthly contribution for a persistent envelope, not allocated - spent', async () => {
    const savedCentsByEnvelopeId = new Map([['ef-1', 350000]]);
    const { findByTestId, getByText, queryByText } = render(
      <EnvelopeDetailSheet
        visible
        envelope={PERSISTENT_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={savedCentsByEnvelopeId}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    await findByTestId('envelope-detail-sheet');
    expect(getByText('R3 500,00')).toBeTruthy(); // saved
    expect(getByText('R1 000,00')).toBeTruthy(); // monthly contribution
    expect(queryByText('R-8,000.00')).toBeNull(); // NOT allocated - spent
  });

  it('requests transactions with a limit of 20 for a persistent envelope, no limit for a period-scoped one', async () => {
    render(
      <EnvelopeDetailSheet
        visible
        envelope={PERSISTENT_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    await waitFor(() =>
      expect(mockResolveEnvelopeTransactions).toHaveBeenCalledWith({}, 'hh-1', 'ef-1', 20),
    );

    jest.clearAllMocks();
    mockResolveEnvelopeTransactions.mockResolvedValue([]);
    render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    await waitFor(() =>
      expect(mockResolveEnvelopeTransactions).toHaveBeenCalledWith({}, 'hh-1', 'env-1', undefined),
    );
  });

  it('shows "No spending here yet" when there are no transactions', async () => {
    const { findByTestId } = render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    expect(await findByTestId('envelope-detail-empty')).toBeTruthy();
  });

  it('renders transaction rows with payee, date, and amount, newest first as resolved', async () => {
    mockResolveEnvelopeTransactions.mockResolvedValue([
      {
        id: 'tx-2',
        householdId: 'hh-1',
        envelopeId: 'env-1',
        amountCents: 15000,
        payee: 'Woolworths',
        description: null,
        transactionDate: '2026-09-10',
        isBusinessExpense: false,
        spendingTriggerNote: null,
        createdAt: '2026-09-10',
        updatedAt: '2026-09-10',
      },
      {
        id: 'tx-1',
        householdId: 'hh-1',
        envelopeId: 'env-1',
        amountCents: 8000,
        payee: null,
        description: 'Corner shop',
        transactionDate: '2026-09-05',
        isBusinessExpense: false,
        spendingTriggerNote: null,
        createdAt: '2026-09-05',
        updatedAt: '2026-09-05',
      },
    ]);
    const { findByTestId, getByText } = render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    expect(await findByTestId('envelope-detail-tx-tx-2')).toBeTruthy();
    expect(await findByTestId('envelope-detail-tx-tx-1')).toBeTruthy();
    expect(getByText('Woolworths')).toBeTruthy();
    expect(getByText('Corner shop')).toBeTruthy();
    expect(getByText('10 Sep')).toBeTruthy();
    expect(getByText('5 Sep')).toBeTruthy();
    expect(getByText('R150,00')).toBeTruthy();
    expect(getByText('R80,00')).toBeTruthy();
  });

  it('pressing the backdrop calls onDismiss', async () => {
    const { findByTestId } = render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    fireEvent.press(await findByTestId('envelope-detail-backdrop'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('pressing "Add transaction" calls onAddTransaction with the envelope id', async () => {
    const { findByTestId } = render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    fireEvent.press(await findByTestId('envelope-detail-add-transaction'));
    expect(onAddTransaction).toHaveBeenCalledWith('env-1');
  });

  it('pressing "Edit envelope" calls onEditEnvelope with the envelope id', async () => {
    const { findByTestId } = render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    fireEvent.press(await findByTestId('envelope-detail-edit'));
    expect(onEditEnvelope).toHaveBeenCalledWith('env-1');
  });

  it('is a real modal: accessibilityViewIsModal and onRequestClose call onDismiss (Android back)', async () => {
    const { findByTestId } = render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    const modal = await findByTestId('envelope-detail-sheet-overlay');
    expect(modal.props.accessibilityViewIsModal).toBe(true);
    modal.props.onRequestClose();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows a drag handle', async () => {
    const { findByTestId } = render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    expect(await findByTestId('envelope-detail-handle')).toBeTruthy();
  });

  it('tapping a transaction row calls onOpenTransaction with that transaction id', async () => {
    mockResolveEnvelopeTransactions.mockResolvedValue([
      {
        id: 'tx-1',
        householdId: 'hh-1',
        envelopeId: 'env-1',
        amountCents: 8000,
        payee: 'Corner shop',
        description: null,
        transactionDate: '2026-09-05',
        isBusinessExpense: false,
        spendingTriggerNote: null,
        createdAt: '2026-09-05',
        updatedAt: '2026-09-05',
      },
    ]);
    const { findByTestId } = render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    fireEvent.press(await findByTestId('envelope-detail-tx-tx-1'));
    expect(onOpenTransaction).toHaveBeenCalledWith('tx-1');
  });

  it('shows an error state with Retry when loading transactions fails, instead of reading as empty', async () => {
    mockResolveEnvelopeTransactions.mockRejectedValueOnce(new Error('DB read failed'));
    const { findByTestId, queryByTestId } = render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        onDismiss={onDismiss}
        currentPeriodStart="2026-09-01"
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    expect(await findByTestId('envelope-detail-error')).toBeTruthy();
    expect(queryByTestId('envelope-detail-empty')).toBeNull();

    mockResolveEnvelopeTransactions.mockResolvedValueOnce([]);
    fireEvent.press(await findByTestId('envelope-detail-retry'));
    expect(await findByTestId('envelope-detail-empty')).toBeTruthy();
  });

  it('shows "Adjust saved amount" for a persistent envelope but not for a period-scoped one', async () => {
    const { findByTestId } = render(
      <EnvelopeDetailSheet
        visible
        envelope={PERSISTENT_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        currentPeriodStart="2026-09-01"
        onDismiss={onDismiss}
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    expect(await findByTestId('envelope-detail-adjust-saved')).toBeTruthy();

    const { queryByTestId: queryByTestIdSpend } = render(
      <EnvelopeDetailSheet
        visible
        envelope={SPEND_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        currentPeriodStart="2026-09-01"
        onDismiss={onDismiss}
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
      />,
    );
    expect(queryByTestIdSpend('envelope-detail-adjust-saved')).toBeNull();
  });

  it('pressing "Adjust saved amount" opens the dialog, and a completed adjustment notifies the parent', async () => {
    const onSavedAmountAdjusted = jest.fn();
    const { findByTestId, getByTestId } = render(
      <EnvelopeDetailSheet
        visible
        envelope={PERSISTENT_ENVELOPE}
        householdId="hh-1"
        savedCentsByEnvelopeId={new Map()}
        currentPeriodStart="2026-09-01"
        onDismiss={onDismiss}
        onAddTransaction={onAddTransaction}
        onOpenTransaction={onOpenTransaction}
        onEditEnvelope={onEditEnvelope}
        onSavedAmountAdjusted={onSavedAmountAdjusted}
      />,
    );
    fireEvent.press(await findByTestId('envelope-detail-adjust-saved'));
    expect(getByTestId('adjust-saved-dialog-stub')).toBeTruthy();
  });
});
