/**
 * RolloverWizard.test.tsx — C8 screen test
 *
 * Covers the 3-step rollover wizard that replaced the old (false-copy)
 * PeriodRolloverModal: review last period -> adjust allocations -> commit
 * (StartNewPeriodUseCase + allocation-edit UPDATE ops + period ack).
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ─── db mock (chain: select().from().where()) ────────────────────────────────
const mockFrom = jest.fn();
const mockWhere = jest.fn();
jest.mock('../../../../data/local/db', () => ({
  db: { select: () => ({ from: mockFrom }) },
}));

// ─── EnvelopeBalanceQuery mock ────────────────────────────────────────────────
const mockGetEnvelopeSpentCents = jest.fn();
jest.mock('../../../../data/local/balances/EnvelopeBalanceQuery', () => ({
  envelopeScopeCondition: jest.fn(() => 'scope-condition'),
  getEnvelopeSpentCents: (...args: unknown[]) => mockGetEnvelopeSpentCents(...args),
}));

// ─── StartNewPeriodUseCase mock ───────────────────────────────────────────────
const mockExecute = jest.fn();
const MockStartNewPeriodUseCase = jest.fn().mockImplementation(() => ({
  execute: mockExecute,
}));
jest.mock('../../../../domain/budgets/StartNewPeriodUseCase', () => ({
  StartNewPeriodUseCase: (...args: unknown[]) => MockStartNewPeriodUseCase(...args),
}));

// ─── syncWrite mock (createSyncedRepo write seam) ─────────────────────────────
const mockUpdate = jest.fn();
const mockCtx = {
  deviceId: 'test-device',
  actorUserId: null,
  clock: () => '2026-07-01T00:00:00.000Z',
};
jest.mock('../../../../domain/shared/syncWrite', () => ({
  resolveSyncedRepo: jest.fn(() => ({
    update: mockUpdate,
    insert: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  })),
  resolveSyncedRepoCtx: jest.fn(() => mockCtx),
}));

// ─── AsyncStorage mock ─────────────────────────────────────────────────────────
const mockSetItem = jest.fn().mockResolvedValue(undefined);
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: (...args: unknown[]) => mockSetItem(...args),
  getItem: jest.fn().mockResolvedValue(null),
}));

// ─── react-native-safe-area-context mock ──────────────────────────────────────
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({
    children,
    testID,
    ...props
  }: {
    children?: React.ReactNode;
    testID?: string;
    [k: string]: unknown;
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require('react');
    return RN.createElement('View', { testID, ...props }, children);
  },
}));

// ─── react-native-paper mock ───────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react');
  const TextInput = ({
    testID,
    accessibilityLabel,
    value,
    onChangeText,
  }: {
    testID?: string;
    accessibilityLabel?: string;
    value?: string;
    onChangeText?: (v: string) => void;
  }) => RN.createElement('TextInput', { testID, accessibilityLabel, value, onChangeText });
  TextInput.Affix = () => null;
  return {
    Text: ({
      children,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      testID?: string;
      [k: string]: unknown;
    }) => RN.createElement('Text', { testID, ...p }, children),
    Button: ({
      children,
      onPress,
      testID,
      disabled,
      accessibilityLabel,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) =>
      RN.createElement(
        'Pressable',
        { onPress: disabled ? undefined : onPress, testID, accessibilityLabel },
        RN.createElement('Text', null, children),
      ),
    TextInput,
    ActivityIndicator: () => RN.createElement('View', { testID: 'activity-indicator' }),
    Surface: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      RN.createElement('View', p, children),
  };
});

import { RolloverWizard } from '../RolloverWizard';

const HOUSEHOLD = 'hh-1';
const FROM_PERIOD = '2026-06-01';
const TO_PERIOD = '2026-07-01';
const PERIOD_LABEL = 'July 2026';

interface Row {
  id: string;
  name: string;
  allocatedCents: number;
  envelopeType: string;
  isArchived: boolean;
}

function makeRows(): Row[] {
  return [
    {
      id: 'env-1',
      name: 'Groceries',
      allocatedCents: 50000,
      envelopeType: 'spending',
      isArchived: false,
    },
    {
      id: 'env-2',
      name: 'Fuel',
      allocatedCents: 20000,
      envelopeType: 'spending',
      isArchived: false,
    },
  ];
}

function setupDb(rows: Row[], spentMap: Map<string, number>): void {
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue(rows);
  mockGetEnvelopeSpentCents.mockResolvedValue(spentMap);
}

const baseProps = {
  visible: true,
  householdId: HOUSEHOLD,
  fromPeriodStart: FROM_PERIOD,
  toPeriodStart: TO_PERIOD,
  periodLabel: PERIOD_LABEL,
  onDone: jest.fn(),
};

describe('RolloverWizard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetItem.mockResolvedValue(undefined);
    mockExecute.mockResolvedValue({ success: true, data: { count: 2 } });
    setupDb(
      makeRows(),
      new Map([
        ['env-1', 60000], // over budget
        ['env-2', 10000], // on budget
      ]),
    );
  });

  it('renders step 1 (review) after loading resolves', async () => {
    const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    expect(getByTestId('rollover-step-indicator').props.children).toContain('Step 1 of 3');
  });

  it('navigates review -> adjust -> commit and back', async () => {
    const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');

    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');
    expect(getByTestId('rollover-step-indicator').props.children).toContain('Step 2 of 3');

    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-commit');
    expect(getByTestId('rollover-step-indicator').props.children).toContain('Step 3 of 3');

    fireEvent.press(getByTestId('rollover-back'));
    await findByTestId('rollover-step-adjust');
  });

  it('commit calls StartNewPeriodUseCase with the correct from/to periods', async () => {
    const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-commit');

    fireEvent.press(getByTestId('rollover-commit'));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith({
        householdId: HOUSEHOLD,
        fromPeriodStart: FROM_PERIOD,
        toPeriodStart: TO_PERIOD,
      });
    });
  });

  it('an edited allocation produces a synced-repo update; an unedited one does not', async () => {
    const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');

    fireEvent.changeText(getByTestId('rollover-alloc-input-env-1'), '750.00');

    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-commit');
    fireEvent.press(getByTestId('rollover-commit'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
    const [, updatedHouseholdId, fields] = mockUpdate.mock.calls[0];
    expect(updatedHouseholdId).toBe(HOUSEHOLD);
    expect(fields).toEqual({ allocated_cents: 75000 });
    // Only the edited envelope (env-1) triggers an update — env-2 stayed at its default.
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ allocated_cents: 20000 }),
      expect.anything(),
    );
  });

  it('acknowledges the new period (writes the ack key) exactly once on commit', async () => {
    const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-commit');

    fireEvent.press(getByTestId('rollover-commit'));

    await waitFor(() => {
      expect(mockSetItem).toHaveBeenCalledWith(`period_ack_${TO_PERIOD}`, 'true');
    });
    expect(mockSetItem).toHaveBeenCalledTimes(1);
  });

  it('shows a success state after commit and calls onDone from it', async () => {
    const onDone = jest.fn();
    const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} onDone={onDone} />);
    await findByTestId('rollover-step-review');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-commit');
    fireEvent.press(getByTestId('rollover-commit'));

    await findByTestId('rollover-success');
    fireEvent.press(getByTestId('rollover-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('flags an overspent envelope with text/icon, not color alone', async () => {
    const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    expect(getByTestId('rollover-overspent-env-1')).toBeTruthy();
  });

  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(<RolloverWizard {...baseProps} visible={false} />);
    expect(queryByTestId('rollover-wizard')).toBeNull();
  });

  it('the false "have been reset" copy no longer exists anywhere in the wizard or dashboard source', () => {
    const files = [
      path.resolve(__dirname, '../RolloverWizard.tsx'),
      path.resolve(__dirname, '../../dashboard/DashboardScreen.tsx'),
    ];
    for (const file of files) {
      const contents = fs.readFileSync(file, 'utf8');
      expect(contents).not.toMatch(/have been reset/i);
    }
    // The old lying modal file must be gone entirely.
    expect(fs.existsSync(path.resolve(__dirname, '../../dashboard/PeriodRolloverModal.tsx'))).toBe(
      false,
    );
  });
});
