/**
 * useHouseholdSettingsSync (REG-5) — keeps appStore's payday day (and
 * household name) in step with the LOCAL `households` row after every sync
 * round and on household switch.
 */
import { renderHook, waitFor, act } from '@testing-library/react-native';

const mockFrom = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();

jest.mock('../../../data/local/db', () => ({
  db: { select: () => ({ from: mockFrom }) },
}));

mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ limit: mockLimit });

import { useHouseholdSettingsSync } from '../useHouseholdSettingsSync';
import { useAppStore } from '../../stores/appStore';
import { useSyncStore } from '../../stores/syncStore';

const HOUSEHOLD = 'hh-1';

describe('useHouseholdSettingsSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
    useAppStore.getState().reset();
    useSyncStore.getState().reset();
  });

  it('adopts the local households row on mount', async () => {
    mockLimit.mockResolvedValue([{ name: 'Ours', paydayDay: 5 }]);
    useAppStore.getState().setHouseholdId(HOUSEHOLD);
    useAppStore
      .getState()
      .setAvailableHouseholds([{ id: HOUSEHOLD, name: 'Stale', paydayDay: 25, userLevel: 1 }]);

    renderHook(() => useHouseholdSettingsSync(HOUSEHOLD));

    await waitFor(() => expect(useAppStore.getState().paydayDay).toBe(5));
    expect(useAppStore.getState().availableHouseholds[0]).toMatchObject({
      name: 'Ours',
      paydayDay: 5,
    });
  });

  it("re-reads after a successful sync round, so a PARTNER's payday change lands", async () => {
    mockLimit.mockResolvedValue([{ name: 'Ours', paydayDay: 25 }]);
    useAppStore.getState().setHouseholdId(HOUSEHOLD);
    useAppStore
      .getState()
      .setAvailableHouseholds([{ id: HOUSEHOLD, name: 'Ours', paydayDay: 25, userLevel: 1 }]);

    renderHook(() => useHouseholdSettingsSync(HOUSEHOLD));
    await waitFor(() => expect(useAppStore.getState().paydayDay).toBe(25));

    // The partner's change has arrived in local SQLite via the puller.
    mockLimit.mockResolvedValue([{ name: 'Ours', paydayDay: 5 }]);
    await act(async () => {
      useSyncStore.getState().setLastSyncAt('2026-09-20T10:00:00.000Z');
    });

    await waitFor(() => expect(useAppStore.getState().paydayDay).toBe(5));
  });

  it('does not query at all without an active household', () => {
    renderHook(() => useHouseholdSettingsSync(null));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('leaves the store untouched when the household row is missing locally', async () => {
    mockLimit.mockResolvedValue([]);
    useAppStore.getState().setHouseholdId(HOUSEHOLD);
    useAppStore.getState().setPaydayDay(25);

    renderHook(() => useHouseholdSettingsSync(HOUSEHOLD));

    await waitFor(() => expect(mockLimit).toHaveBeenCalled());
    expect(useAppStore.getState().paydayDay).toBe(25);
  });
});
