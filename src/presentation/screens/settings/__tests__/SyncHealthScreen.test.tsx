/**
 * SyncHealthScreen.test.tsx — Task 5
 *
 * Covers: renders sync health (last synced, pending count), "Sync now" calls
 * the scheduler, the pull-blocked banner + its Retry calling
 * `engine.clearPullBlock`, and the DLQ list's per-item Retry/Discard calling
 * the engine's `retryDeadLettered`/`discardDeadLettered` after confirmation.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type { DeadLetteredOp, PullHealth } from '../../../../data/sync/SyncEngine';

// ─── confirm() mock (ConfirmDialogHost) ───────────────────────────────────
const mockConfirm = jest.fn();
jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

const NOW = '2026-01-01T00:00:00.000Z';
const HH = 'hh-1';

// ─── appStore mock ────────────────────────────────────────────────────────────
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: { householdId: string }) => unknown) =>
    selector({ householdId: HH }),
  ),
}));

// ─── syncStore mock (mutable so each test can shape it) ───────────────────────
let mockSyncState = {
  isOnline: true,
  syncStatus: 'idle' as 'idle' | 'syncing' | 'error' | 'success',
  lastSyncAt: null as string | null,
  pendingSyncCount: 0,
  error: null as string | null,
  pullBlocked: false,
};
jest.mock('../../../stores/syncStore', () => ({
  useSyncStore: jest.fn((selector: (s: typeof mockSyncState) => unknown) =>
    selector(mockSyncState),
  ),
}));

// ─── syncEngineStore mock: engine/scheduler as jest.fn doubles ────────────────
const mockEngine = {
  getPullHealth: jest.fn((): PullHealth => ({ blocked: false })),
  listDeadLettered: jest.fn((): DeadLetteredOp[] => []),
  retryDeadLettered: jest.fn(),
  discardDeadLettered: jest.fn(async () => undefined),
  clearPullBlock: jest.fn(),
};
const mockScheduler = {
  requestSync: jest.fn(),
  isStarted: true,
};
jest.mock('../../../stores/syncEngineStore', () => ({
  useSyncEngineStore: jest.fn(
    (selector: (s: { engine: typeof mockEngine; scheduler: typeof mockScheduler }) => unknown) =>
      selector({ engine: mockEngine, scheduler: mockScheduler }),
  ),
}));

import { SyncHealthScreen } from '../SyncHealthScreen';

beforeEach(() => {
  jest.clearAllMocks();
  mockSyncState = {
    isOnline: true,
    syncStatus: 'idle',
    lastSyncAt: null,
    pendingSyncCount: 0,
    error: null,
    pullBlocked: false,
  };
  mockEngine.getPullHealth.mockReturnValue({ blocked: false });
  mockEngine.listDeadLettered.mockReturnValue([]);
  mockEngine.discardDeadLettered.mockResolvedValue(undefined);
  mockConfirm.mockResolvedValue(true);
});

describe('SyncHealthScreen', () => {
  it('renders last synced and pending count', () => {
    mockSyncState.lastSyncAt = NOW;
    mockSyncState.pendingSyncCount = 3;
    const { getByTestId } = render(<SyncHealthScreen />);
    expect(getByTestId('pending-count-label').props.children.join('')).toContain('3');
    expect(getByTestId('sync-status-label')).toBeTruthy();
  });

  it('"Sync now" calls scheduler.requestSync(householdId, { immediate: true })', () => {
    const { getByTestId } = render(<SyncHealthScreen />);
    fireEvent.press(getByTestId('sync-now-button'));
    expect(mockScheduler.requestSync).toHaveBeenCalledWith(HH, { immediate: true });
  });

  it('shows the empty state when there are no dead-lettered ops', () => {
    const { getByTestId, queryByTestId } = render(<SyncHealthScreen />);
    expect(getByTestId('dlq-empty-state')).toBeTruthy();
    expect(queryByTestId('pull-blocked-banner')).toBeNull();
  });

  it('shows the pull-blocked banner when getPullHealth().blocked is true, and Retry clears it', () => {
    mockEngine.getPullHealth.mockReturnValue({
      blocked: true,
      opIds: ['p1', 'p2'],
      error: 'schema drift',
      blockedAt: NOW,
    });
    const { getByTestId } = render(<SyncHealthScreen />);
    expect(getByTestId('pull-blocked-banner')).toBeTruthy();

    fireEvent.press(getByTestId('clear-pull-block-button'));
    expect(mockEngine.clearPullBlock).toHaveBeenCalledWith(HH);
    expect(mockScheduler.requestSync).toHaveBeenCalledWith(HH, { immediate: true });
  });

  it('renders the DLQ list and Retry calls engine.retryDeadLettered', () => {
    mockEngine.listDeadLettered.mockReturnValue([
      {
        opId: 'op-1',
        householdId: HH,
        table: 'debts',
        rowId: 'd1',
        opType: 'insert',
        deadLetteredAt: NOW,
        retryCount: 2,
      },
    ]);
    const { getByTestId } = render(<SyncHealthScreen />);
    expect(getByTestId('dlq-row-op-1')).toBeTruthy();

    fireEvent.press(getByTestId('dlq-retry-op-1'));
    expect(mockEngine.retryDeadLettered).toHaveBeenCalledWith('op-1');
    expect(mockScheduler.requestSync).toHaveBeenCalledWith(HH, { immediate: true });
  });

  it('Discard asks for confirmation before calling engine.discardDeadLettered', async () => {
    mockEngine.listDeadLettered.mockReturnValue([
      {
        opId: 'op-1',
        householdId: HH,
        table: 'debts',
        rowId: 'd1',
        opType: 'insert',
        deadLetteredAt: NOW,
        retryCount: 0,
      },
    ]);

    const { getByTestId } = render(<SyncHealthScreen />);
    fireEvent.press(getByTestId('dlq-discard-op-1'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Discard this change?',
        message: "This change will be lost on all your devices. This can't be undone.",
        confirmLabel: 'Discard',
        destructive: true,
      }),
    );
    expect(mockEngine.discardDeadLettered).toHaveBeenCalledWith('op-1');
  });

  it('does not call discardDeadLettered when the confirm dialog is dismissed', async () => {
    mockConfirm.mockResolvedValue(false);
    mockEngine.listDeadLettered.mockReturnValue([
      {
        opId: 'op-1',
        householdId: HH,
        table: 'debts',
        rowId: 'd1',
        opType: 'insert',
        deadLetteredAt: NOW,
        retryCount: 0,
      },
    ]);

    const { getByTestId } = render(<SyncHealthScreen />);
    fireEvent.press(getByTestId('dlq-discard-op-1'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockEngine.discardDeadLettered).not.toHaveBeenCalled();
  });

  it('Discard calls engine.discardDeadLettered and refreshes the list on success when confirmed', async () => {
    let dlqRows: DeadLetteredOp[] = [
      {
        opId: 'op-1',
        householdId: HH,
        table: 'debts',
        rowId: 'd1',
        opType: 'insert',
        deadLetteredAt: NOW,
        retryCount: 0,
      },
    ];
    mockEngine.listDeadLettered.mockImplementation(() => dlqRows);
    mockEngine.discardDeadLettered.mockImplementation(async () => {
      dlqRows = [];
    });

    const { getByTestId, findByTestId } = render(<SyncHealthScreen />);
    expect(getByTestId('dlq-row-op-1')).toBeTruthy();

    fireEvent.press(getByTestId('dlq-discard-op-1'));

    // `findByTestId` polls (retrying on the not-found throw) until the empty
    // state appears post-discard -- more robust here than asserting the
    // row's ABSENCE, since `queryByTestId` returning non-null doesn't throw
    // and so gives `waitFor` nothing to retry on.
    await findByTestId('dlq-empty-state');
  });

  it('shows a plain-language error message when discard fails, never the raw text, without removing the row', async () => {
    mockEngine.listDeadLettered.mockReturnValue([
      {
        opId: 'op-1',
        householdId: HH,
        table: 'debts',
        rowId: 'd1',
        opType: 'insert',
        deadLetteredAt: NOW,
        retryCount: 0,
      },
    ]);
    // D-2: a raw error (here containing internal detail a user should never
    // see) must be mapped before it reaches the screen.
    mockEngine.discardDeadLettered.mockRejectedValueOnce(new Error('network down'));

    const { getByTestId } = render(<SyncHealthScreen />);
    fireEvent.press(getByTestId('dlq-discard-op-1'));

    await waitFor(() => expect(getByTestId('discard-error-message')).toBeTruthy());
    expect(getByTestId('discard-error-message').props.children).toBe(
      "Can't reach the server. Check your connection and try again.",
    );
    expect(getByTestId('discard-error-message').props.children).not.toContain('network down');
    expect(getByTestId('dlq-row-op-1')).toBeTruthy();
  });

  it('shows one generic message when discard fails with an unrecognised error, never the raw text', async () => {
    mockEngine.listDeadLettered.mockReturnValue([
      {
        opId: 'op-1',
        householdId: HH,
        table: 'debts',
        rowId: 'd1',
        opType: 'insert',
        deadLetteredAt: NOW,
        retryCount: 0,
      },
    ]);
    mockEngine.discardDeadLettered.mockRejectedValueOnce(
      new Error('duplicate key value violates constraint xyz_pkey'),
    );

    const { getByTestId } = render(<SyncHealthScreen />);
    fireEvent.press(getByTestId('dlq-discard-op-1'));

    await waitFor(() => expect(getByTestId('discard-error-message')).toBeTruthy());
    expect(getByTestId('discard-error-message').props.children).toBe(
      "Something went wrong while syncing. We'll try again.",
    );
  });

  it('D-3: explains that retrying likely will not help and what Discard does, for every DLQ row (permanent-shaped or a code the surface does not expose)', () => {
    mockEngine.listDeadLettered.mockReturnValue([
      {
        opId: 'op-1',
        householdId: HH,
        table: 'debts',
        rowId: 'd1',
        opType: 'insert',
        deadLetteredAt: NOW,
        retryCount: 3,
      },
    ]);
    const { getByTestId } = render(<SyncHealthScreen />);
    const explanation = getByTestId('dlq-explanation-op-1').props.children;
    const text = Array.isArray(explanation) ? explanation.join('') : explanation;
    expect(text).toMatch(/won't help until the app is updated/i);
    expect(text).toMatch(/already been retried 3 times/i);
    expect(text).toMatch(/discard will replace this device's version with the household's/i);
    // Retry must still be offered — D-3 says explain, not remove it.
    expect(getByTestId('dlq-retry-op-1')).toBeTruthy();
  });

  it('D-4: the pull-blocked banner is marked `accessible` so assistive tech announces it as one unit', () => {
    mockEngine.getPullHealth.mockReturnValue({
      blocked: true,
      opIds: ['p1'],
      blockedAt: NOW,
    });
    const { getByTestId } = render(<SyncHealthScreen />);
    expect(getByTestId('pull-blocked-banner').props.accessible).toBe(true);
  });
});
