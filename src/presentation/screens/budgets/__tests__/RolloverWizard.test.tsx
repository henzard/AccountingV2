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
import { rolloverEnvelopeId } from '../../../../domain/budgets/StartNewPeriodUseCase';

// ─── db mock (chain: select().from().where()) ────────────────────────────────
const mockFrom = jest.fn();
const mockWhere = jest.fn();
// VAL2-10's debt-snapshot query targets `debtsTable` specifically — routed
// to its own mock chain (keyed by table identity, since both queries share
// the same `db.select()`) so it can return debt-shaped rows independently
// of whatever envelope-shaped `rows` the rest of the suite has configured.
const mockDebtsWhere = jest.fn().mockResolvedValue([]);
jest.mock('../../../../data/local/db', () => ({
  db: {
    select: () => ({
      from: (...args: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { debts: debtsTableReal } = require('../../../../data/local/schema');
        if (args[0] === debtsTableReal) return { where: mockDebtsWhere };
        return mockFrom(...args);
      },
    }),
  },
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
jest.mock('../../../../domain/budgets/StartNewPeriodUseCase', () => {
  // Keeps the real `isRolloverSource`/`rolloverEnvelopeId` exports (only the
  // `StartNewPeriodUseCase` class itself is faked) so the wizard's source
  // selection and target-id computation stay wired to the SAME shared
  // functions the use case uses — proving they can't silently drift apart.
  const actual = jest.requireActual('../../../../domain/budgets/StartNewPeriodUseCase');
  return {
    ...actual,
    StartNewPeriodUseCase: (...args: unknown[]) => MockStartNewPeriodUseCase(...args),
  };
});

// ─── PersistentContributions mock (savings section seam) ──────────────────────
// Only the two functions the wizard calls are faked; everything else (ids,
// predicates) stays real, so the section cannot drift from the ledger rules.
const mockLoadPersistentContributionState = jest.fn();
const mockConfirmMonthlyContribution = jest.fn();
jest.mock('../../../../domain/budgets/PersistentContributions', () => {
  const actual = jest.requireActual('../../../../domain/budgets/PersistentContributions');
  return {
    ...actual,
    loadPersistentContributionState: (...args: unknown[]) =>
      mockLoadPersistentContributionState(...args),
    confirmMonthlyContribution: (...args: unknown[]) => mockConfirmMonthlyContribution(...args),
  };
});

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
  // forwardRef because the wizard attaches a ref to every allocation input
  // for its returnKeyType "next" chain — a plain function component would
  // make React log a "Function components cannot be given refs" error.
  const TextInput = RN.forwardRef(
    (
      {
        testID,
        accessibilityLabel,
        value,
        onChangeText,
        returnKeyType,
        onSubmitEditing,
      }: {
        testID?: string;
        accessibilityLabel?: string;
        value?: string;
        onChangeText?: (v: string) => void;
        returnKeyType?: string;
        onSubmitEditing?: () => void;
      },
      ref: unknown,
    ) =>
      RN.createElement('TextInput', {
        ref,
        testID,
        accessibilityLabel,
        value,
        onChangeText,
        returnKeyType,
        onSubmitEditing,
      }),
  );
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

// ─── score-history / level-advancement mocks (VAL-14/DOM-13) ─────────────────
// Mocked at the module boundary (rather than faking their db chains) since
// each already has its own dedicated unit tests — RecordPeriodScoreUseCase's
// idempotency/failure-isolation and buildHabitScoreInput's parity live in
// `src/domain/scoring/__tests__/`, not here. These default to harmless
// success values so the existing commit-flow tests above are unaffected;
// individual tests below override them to exercise the new wiring.
const mockResolvePeriodHabitScoreInput = jest.fn();
jest.mock('../../../../domain/scoring/resolvePeriodHabitScoreInput', () => ({
  resolvePeriodHabitScoreInput: (...args: unknown[]) => mockResolvePeriodHabitScoreInput(...args),
}));

const mockRecordExecute = jest.fn();
jest.mock('../../../../domain/scoring/RecordPeriodScoreUseCase', () => ({
  RecordPeriodScoreUseCase: jest.fn().mockImplementation(() => ({ execute: mockRecordExecute })),
}));

const mockGetPeriodScoresAscending = jest.fn();
jest.mock('../../../../domain/scoring/getPeriodScoresAscending', () => ({
  getPeriodScoresAscending: (...args: unknown[]) => mockGetPeriodScoresAscending(...args),
}));

const mockCheck = jest.fn();
jest.mock('../../../hooks/useLevelAdvancement', () => ({
  useLevelAdvancement: () => ({ check: mockCheck }),
}));

// ─── logger mock (RULES2 forbids console.* in app code; RolloverWizard
// reports its best-effort score/level failures via the app logger, same as
// `bestEffortAudit`) ───────────────────────────────────────────────────────
jest.mock('../../../../infrastructure/logging/Logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { RolloverWizard } from '../RolloverWizard';
import { useAppStore } from '../../../stores/appStore';
import { logger } from '../../../../infrastructure/logging/Logger';

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
    // Payday on the 1st, matching the '2026-06-01'/'2026-07-01' period keys
    // this file uses: the wizard now asks `BudgetPeriodEngine` for the
    // CLOSING period's own end date (REG-14), so the fixture's payday day and
    // its period keys have to describe the same calendar.
    useAppStore.setState({ userLevel: 1, paydayDay: 1 });
    mockResolvePeriodHabitScoreInput.mockResolvedValue({
      loggingDaysCount: 0,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 0,
      totalEnvelopes: 0,
      meterReadingsLoggedThisPeriod: false,
      babyStepIsActive: false,
    });
    mockRecordExecute.mockResolvedValue({ success: true, data: { id: 'score-1', created: true } });
    mockGetPeriodScoresAscending.mockResolvedValue([]);
    mockCheck.mockImplementation(() => undefined);
    mockLoadPersistentContributionState.mockResolvedValue([]);
    mockConfirmMonthlyContribution.mockResolvedValue({ success: true, data: { confirmed: true } });
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

  it('shows a "Moved ... into your savings funds" line when the commit funded persistent envelopes', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      data: { count: 2, contributionCount: 1, contributedCents: 50000 },
    });
    const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-commit');
    fireEvent.press(getByTestId('rollover-commit'));

    const contributedLine = await findByTestId('rollover-contributed-cents');
    expect(contributedLine.props.children).toContain('R500');
  });

  it('does not show the contributed-cents line when nothing was contributed', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      data: { count: 2, contributionCount: 0, contributedCents: 0 },
    });
    const { findByTestId, getByTestId, queryByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-commit');
    fireEvent.press(getByTestId('rollover-commit'));

    await findByTestId('rollover-success');
    expect(queryByTestId('rollover-contributed-cents')).toBeNull();
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
    const [updatedTargetId, updatedHouseholdId, fields] = mockUpdate.mock.calls[0];
    expect(updatedHouseholdId).toBe(HOUSEHOLD);
    expect(fields).toEqual({ allocated_cents: 75000 });
    // The wizard must target the SAME row id `StartNewPeriodUseCase` copied
    // the source envelope into — computed via the one shared
    // `rolloverEnvelopeId` formula, not a second hand-rolled copy of it.
    expect(updatedTargetId).toBe(rolloverEnvelopeId(HOUSEHOLD, TO_PERIOD, 'env-1'));
    // Only the edited envelope (env-1) triggers an update — env-2 stayed at its default.
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ allocated_cents: 20000 }),
      expect.anything(),
    );
  });

  // ── Money parsing (H2/M1/L8, 2026-07-05 exhaustive audit) ──────────────
  // Allocation edits used to go through a local `toCents`
  // (`parseFloat(str.replace(',', '.'))`, returning 0 on non-finite input),
  // which silently zeroed an emptied field and mis-parsed grouped/comma
  // input. It now uses the locale-safe `parseMoneyInput` and blocks
  // advancing past the 'adjust' step while any allocation is invalid.
  it('accepts a thousands-separated allocation edit and commits the correct cents', async () => {
    const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');

    fireEvent.changeText(getByTestId('rollover-alloc-input-env-1'), '1,500');

    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-commit');
    fireEvent.press(getByTestId('rollover-commit'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
    const [, , fields] = mockUpdate.mock.calls[0];
    expect(fields).toEqual({ allocated_cents: 150000 });
  });

  it('accepts a comma-decimal allocation edit and commits the correct cents', async () => {
    const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');

    fireEvent.changeText(getByTestId('rollover-alloc-input-env-1'), '750,50');

    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-commit');
    fireEvent.press(getByTestId('rollover-commit'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
    const [, , fields] = mockUpdate.mock.calls[0];
    expect(fields).toEqual({ allocated_cents: 75050 });
  });

  it('rejects an emptied allocation field instead of silently zeroing it, and blocks advancing past adjust', async () => {
    const { findByTestId, getByTestId, queryByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');

    fireEvent.changeText(getByTestId('rollover-alloc-input-env-1'), '');

    await waitFor(() => {
      expect(queryByTestId('rollover-alloc-error-env-1')).toBeTruthy();
    });

    // The mocked Button nils out onPress while `disabled` is true (see the
    // react-native-paper mock above), so this proves the Next button is
    // actually disabled while the allocation is invalid.
    expect(getByTestId('rollover-next').props.onPress).toBeUndefined();

    // ...and — the authoritative gate — `handleNext` itself refuses to leave
    // 'adjust' while any allocation is invalid, so pressing Next (e.g. via
    // an assistive-tech action that bypasses the visual disabled state)
    // still cannot silently zero this envelope's allocation on commit.
    fireEvent.press(getByTestId('rollover-next'));
    expect(queryByTestId('rollover-step-adjust')).toBeTruthy();
    expect(queryByTestId('rollover-step-commit')).toBeNull();
  });

  it('rejects a malformed-grouping allocation edit with an inline error and blocks advancing', async () => {
    const { findByTestId, getByTestId, queryByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');

    fireEvent.changeText(getByTestId('rollover-alloc-input-env-1'), '1,00,000');

    await waitFor(() => {
      expect(queryByTestId('rollover-alloc-error-env-1')).toBeTruthy();
    });

    expect(getByTestId('rollover-next').props.onPress).toBeUndefined();
    fireEvent.press(getByTestId('rollover-next'));
    expect(queryByTestId('rollover-step-commit')).toBeNull();
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

  it('disables the dismiss (close) button while a commit is in flight, and re-enables on completion', async () => {
    let resolveExecute: ((value: { success: true; data: { count: number } }) => void) | undefined;
    mockExecute.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExecute = resolve;
        }),
    );

    const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
    await findByTestId('rollover-step-review');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-adjust');
    fireEvent.press(getByTestId('rollover-next'));
    await findByTestId('rollover-step-commit');

    const dismissBefore = getByTestId('rollover-dismiss');
    expect(dismissBefore.props.accessibilityState?.disabled ?? dismissBefore.props.disabled).toBe(
      false,
    );

    fireEvent.press(getByTestId('rollover-commit'));

    await waitFor(() => {
      const dismiss = getByTestId('rollover-dismiss');
      expect(dismiss.props.accessibilityState?.disabled ?? dismiss.props.disabled).toBeTruthy();
    });

    // Pressing dismiss while committing must not call onDone.
    fireEvent.press(getByTestId('rollover-dismiss'));
    expect(baseProps.onDone).not.toHaveBeenCalled();

    resolveExecute?.({ success: true, data: { count: 2 } });

    await findByTestId('rollover-success');
    const dismissAfter = getByTestId('rollover-dismiss');
    expect(dismissAfter.props.accessibilityState?.disabled ?? dismissAfter.props.disabled).toBe(
      false,
    );
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

  // ── Score history + level advancement (VAL-14/DOM-13) ────────────────────
  describe('score history and level advancement', () => {
    it('shows "Last period\'s score" in the review step when history exists', async () => {
      mockGetPeriodScoresAscending.mockResolvedValue([
        { periodStart: '2026-04-01', score: 40 },
        { periodStart: '2026-05-01', score: 72 },
      ]);

      const { findByTestId } = render(<RolloverWizard {...baseProps} />);
      const line = await findByTestId('rollover-previous-score');
      expect(line.props.children).toBe("Last period's score: 72");
    });

    it('does not show "Last period\'s score" when no history exists yet', async () => {
      mockGetPeriodScoresAscending.mockResolvedValue([]);

      const { findByTestId, queryByTestId } = render(<RolloverWizard {...baseProps} />);
      await findByTestId('rollover-step-review');
      expect(queryByTestId('rollover-previous-score')).toBeNull();
    });

    it("records the closing period's score after a successful commit", async () => {
      const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
      await findByTestId('rollover-step-review');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-adjust');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-commit');
      fireEvent.press(getByTestId('rollover-commit'));

      await findByTestId('rollover-success');

      await waitFor(() => {
        expect(mockRecordExecute).toHaveBeenCalledTimes(1);
      });
      const [input] = mockRecordExecute.mock.calls[0];
      // The CLOSING period is `fromPeriodStart` and its OWN end — never the
      // just-started `toPeriodStart` period, which has no data yet.
      expect(input.householdId).toBe(HOUSEHOLD);
      expect(input.periodStart).toBe(FROM_PERIOD);
      expect(input.periodEnd).toBe('2026-06-30');
      expect(typeof input.score.score).toBe('number');
    });

    it("VAL2-10: snapshots the household's current debt-payoff plan alongside the score", async () => {
      mockDebtsWhere.mockResolvedValueOnce([
        {
          id: 'd1',
          householdId: HOUSEHOLD,
          creditorName: 'Credit Card',
          debtType: 'credit_card',
          outstandingBalanceCents: 10000,
          initialBalanceCents: 10000,
          totalPaidCents: 0,
          minimumPaymentCents: 5000,
          interestRatePercent: 0,
          sortOrder: 0,
          isPaidOff: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          deletedAt: null,
        },
      ]);

      const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
      await findByTestId('rollover-step-review');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-adjust');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-commit');
      fireEvent.press(getByTestId('rollover-commit'));

      await findByTestId('rollover-success');
      await waitFor(() => {
        expect(mockRecordExecute).toHaveBeenCalledTimes(1);
      });
      const [input] = mockRecordExecute.mock.calls[0];
      expect(input.debtSnapshot.totalDebtCents).toBe(10000);
      expect(typeof input.debtSnapshot.debtFreeDateISO).toBe('string');
    });

    it('VAL2-10: a debt-query failure never blocks score recording or the rollover itself', async () => {
      mockDebtsWhere.mockRejectedValueOnce(new Error('db locked'));

      const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
      await findByTestId('rollover-step-review');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-adjust');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-commit');
      fireEvent.press(getByTestId('rollover-commit'));

      // Still reaches success, and the score is still recorded — just
      // without a debtSnapshot this time.
      await findByTestId('rollover-success');
      await waitFor(() => {
        expect(mockRecordExecute).toHaveBeenCalledTimes(1);
      });
      const [input] = mockRecordExecute.mock.calls[0];
      expect(input.debtSnapshot).toBeUndefined();
    });

    // REG-14: the closing period's end used to be computed as
    // `toPeriodStart − 1 day`. A household that last rolled over in June and
    // opens the wizard in September therefore scored JUNE over a 92-day
    // window — `resolvePeriodHabitScoreInput` divides logging days by the
    // period length, so June's habit score collapsed to roughly a third of
    // what it had earned. June must be scored over June; the two skipped
    // periods get no score row at all, since no reviewed budget exists for
    // them.
    it('scores only the closing period when several periods were skipped', async () => {
      const { findByTestId, getByTestId } = render(
        <RolloverWizard {...baseProps} toPeriodStart="2026-09-01" periodLabel="September 2026" />,
      );
      await findByTestId('rollover-step-review');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-adjust');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-commit');
      fireEvent.press(getByTestId('rollover-commit'));

      await findByTestId('rollover-success');
      await waitFor(() => {
        expect(mockRecordExecute).toHaveBeenCalledTimes(1);
      });
      const [input] = mockRecordExecute.mock.calls[0];
      expect(input.periodStart).toBe(FROM_PERIOD);
      expect(input.periodEnd).toBe('2026-06-30');
      // …and exactly ONE score row: July and August are never scored.
      expect(mockRecordExecute).toHaveBeenCalledTimes(1);
    });

    it('shows a "Level up" line in the success block when the level check advances the level', async () => {
      mockCheck.mockImplementation(() => {
        useAppStore.getState().setUserLevel(2);
      });

      const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
      await findByTestId('rollover-step-review');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-adjust');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-commit');
      fireEvent.press(getByTestId('rollover-commit'));

      const levelUpLine = await findByTestId('rollover-level-up');
      expect(levelUpLine.props.children).toBe('Level up — Lv2 Practitioner');
    });

    it('does not show a "Level up" line when the level does not advance', async () => {
      // mockCheck (from beforeEach) is a no-op — userLevel stays 1.
      const { findByTestId, getByTestId, queryByTestId } = render(
        <RolloverWizard {...baseProps} />,
      );
      await findByTestId('rollover-step-review');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-adjust');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-commit');
      fireEvent.press(getByTestId('rollover-commit'));

      await findByTestId('rollover-success');
      expect(queryByTestId('rollover-level-up')).toBeNull();
    });

    it('a score-recording failure never blocks the rollover success block', async () => {
      mockRecordExecute.mockRejectedValue(new Error('disk full'));

      const { findByTestId, getByTestId } = render(<RolloverWizard {...baseProps} />);
      await findByTestId('rollover-step-review');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-adjust');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-commit');
      fireEvent.press(getByTestId('rollover-commit'));

      const success = await findByTestId('rollover-success');
      expect(success).toBeTruthy();
      expect(getByTestId('rollover-dismiss').props.disabled).toBeFalsy();

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          'RolloverWizard: failed to record period score/level',
          expect.any(Error),
          expect.objectContaining({ householdId: HOUSEHOLD, periodStart: FROM_PERIOD }),
        );
      });
    });
  });
  // ── Savings contributions section (REG-4 / UX2-9) ─────────────────────────
  // A LEGACY persistent envelope's old `allocatedCents` was its SAVED
  // balance, so the ledger backfill moves it out of the column and leaves it
  // at 0 ("monthly amount not known yet"). The wizard is where the user is
  // asked what that monthly amount actually is, BEFORE the rollover funds it.
  describe('savings contributions', () => {
    const LEGACY_FUND = {
      id: 'env-emf',
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      monthlyCents: 0,
      needsMonthlyConfirmation: true,
    };
    const KNOWN_FUND = {
      id: 'env-car',
      name: 'Car Service',
      envelopeType: 'sinking_fund',
      monthlyCents: 50000,
      needsMonthlyConfirmation: false,
    };

    async function openAdjust(): Promise<ReturnType<typeof render>> {
      const view = render(<RolloverWizard {...baseProps} />);
      await view.findByTestId('rollover-step-review');
      fireEvent.press(view.getByTestId('rollover-next'));
      await view.findByTestId('rollover-step-adjust');
      return view;
    }

    it('lists persistent envelopes, pre-filling a legacy one empty with the helper text', async () => {
      mockLoadPersistentContributionState.mockResolvedValue([LEGACY_FUND, KNOWN_FUND]);
      const { getByTestId, queryByTestId } = await openAdjust();

      getByTestId('rollover-savings-section');
      expect(getByTestId('rollover-savings-input-env-emf').props.value).toBe('');
      expect(getByTestId('rollover-savings-helper-env-emf').props.children).toBe(
        'How much do you put in each month?',
      );
      // A fund whose monthly amount is already known is pre-filled and not asked about.
      expect(getByTestId('rollover-savings-input-env-car').props.value).toBe('500.00');
      expect(queryByTestId('rollover-savings-helper-env-car')).toBeNull();
    });

    it('shows the spent-last-month hint beside each period allocation', async () => {
      const { getByTestId } = await openAdjust();
      expect(getByTestId('rollover-alloc-spent-env-1').props.children).toBe(
        'spent R600,00 last month',
      );
    });

    it('sums income, allocations and savings into the sticky summary as the user types', async () => {
      mockLoadPersistentContributionState.mockResolvedValue([KNOWN_FUND]);
      setupDb(
        [
          ...makeRows(),
          {
            id: 'env-pay',
            name: 'Salary',
            allocatedCents: 100000,
            envelopeType: 'income',
            isArchived: false,
          },
        ],
        new Map([
          ['env-1', 60000],
          ['env-2', 10000],
          ['env-pay', 0],
        ]),
      );
      const { getByTestId } = await openAdjust();

      // Income R1 000; allocated R500 + R200 + R500 savings = R1 200; to assign -R200.
      expect(getByTestId('rollover-adjust-summary').props.children.props.children).toBe(
        'Income R1 000,00 · Allocated R1 200,00 · To assign -R200,00',
      );

      // Typing recomputes it immediately — the point of the step.
      fireEvent.changeText(getByTestId('rollover-savings-input-env-car'), '100');
      expect(getByTestId('rollover-adjust-summary').props.children.props.children).toBe(
        'Income R1 000,00 · Allocated R800,00 · To assign R200,00',
      );
    });

    it('confirms a typed monthly amount BEFORE the rollover runs, so that period is funded with it', async () => {
      mockLoadPersistentContributionState.mockResolvedValue([LEGACY_FUND]);
      const order: string[] = [];
      mockConfirmMonthlyContribution.mockImplementation(() => {
        order.push('confirm');
        return Promise.resolve({ success: true, data: { confirmed: true } });
      });
      mockExecute.mockImplementation(() => {
        order.push('rollover');
        return Promise.resolve({
          success: true,
          data: { count: 2, contributionCount: 1, contributedCents: 75000 },
        });
      });

      const { getByTestId, findByTestId } = await openAdjust();
      fireEvent.changeText(getByTestId('rollover-savings-input-env-emf'), '750');
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-commit');
      fireEvent.press(getByTestId('rollover-commit'));

      await findByTestId('rollover-success');
      expect(order).toEqual(['confirm', 'rollover']);
      const [, input] = mockConfirmMonthlyContribution.mock.calls[0];
      expect(input).toEqual({
        householdId: HOUSEHOLD,
        envelopeId: 'env-emf',
        monthlyCents: 75000,
        periodStart: TO_PERIOD,
        currentMonthlyCents: 0,
      });
    });

    it('leaves an unanswered legacy fund alone rather than confirming it at zero', async () => {
      mockLoadPersistentContributionState.mockResolvedValue([LEGACY_FUND]);
      const { getByTestId, findByTestId } = await openAdjust();
      fireEvent.press(getByTestId('rollover-next'));
      await findByTestId('rollover-step-commit');
      fireEvent.press(getByTestId('rollover-commit'));

      await findByTestId('rollover-success');
      expect(mockConfirmMonthlyContribution).not.toHaveBeenCalled();
    });

    it('blocks advancing past adjust while a savings amount is unparseable', async () => {
      mockLoadPersistentContributionState.mockResolvedValue([KNOWN_FUND]);
      const { getByTestId, findByTestId, queryByTestId } = await openAdjust();
      fireEvent.changeText(getByTestId('rollover-savings-input-env-car'), 'abc');

      expect(await findByTestId('rollover-savings-error-env-car')).toBeTruthy();
      fireEvent.press(getByTestId('rollover-next'));
      expect(queryByTestId('rollover-step-commit')).toBeNull();
    });
  });
});
