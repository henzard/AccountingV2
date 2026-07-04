/**
 * SyncHealthScreen.test.tsx — Task 5
 *
 * Covers: renders sync health (last synced, pending count), "Sync now" calls
 * the scheduler, the pull-blocked banner + its Retry calling
 * `engine.clearPullBlock`, and the DLQ list's per-item Retry/Discard calling
 * the engine's `retryDeadLettered`/`discardDeadLettered`.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type { DeadLetteredOp, PullHealth } from '../../../../data/sync/SyncEngine';

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

  it('Discard calls engine.discardDeadLettered and refreshes the list on success', async () => {
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
    expect(mockEngine.discardDeadLettered).toHaveBeenCalledWith('op-1');

    // `findByTestId` polls (retrying on the not-found throw) until the empty
    // state appears post-discard -- more robust here than asserting the
    // row's ABSENCE, since `queryByTestId` returning non-null doesn't throw
    // and so gives `waitFor` nothing to retry on.
    await findByTestId('dlq-empty-state');
  });

  it('shows an error message when discard fails, without removing the row', async () => {
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
    mockEngine.discardDeadLettered.mockRejectedValueOnce(new Error('network down'));

    const { getByTestId } = render(<SyncHealthScreen />);
    fireEvent.press(getByTestId('dlq-discard-op-1'));

    await waitFor(() => expect(getByTestId('discard-error-message')).toBeTruthy());
    expect(getByTestId('discard-error-message').props.children).toContain('network down');
    expect(getByTestId('dlq-row-op-1')).toBeTruthy();
  });
});
