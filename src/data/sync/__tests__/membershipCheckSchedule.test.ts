/**
 * membershipCheckSchedule — the device-local 24h window that bounds the
 * periodic membership check (see SyncScheduler.runMembershipCheckIfDue).
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('../../../infrastructure/logging/Logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MEMBERSHIP_CHECK_INTERVAL_MS,
  isMembershipCheckDue,
  recordMembershipCheck,
} from '../membershipCheckSchedule';

const HH = 'hh-1';
const KEY = `@membership_checked_at:${HH}`;
const NOW = Date.parse('2026-03-01T12:00:00.000Z');

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  getItem.mockResolvedValue(null);
  setItem.mockResolvedValue(undefined);
});

describe('isMembershipCheckDue', () => {
  it('is due when the household has never been checked', async () => {
    await expect(isMembershipCheckDue(HH, NOW)).resolves.toBe(true);
    expect(getItem).toHaveBeenCalledWith(KEY);
  });

  it('is not due inside the window', async () => {
    getItem.mockResolvedValue(String(NOW - MEMBERSHIP_CHECK_INTERVAL_MS + 1));
    await expect(isMembershipCheckDue(HH, NOW)).resolves.toBe(false);
  });

  it('is due exactly at the window boundary', async () => {
    getItem.mockResolvedValue(String(NOW - MEMBERSHIP_CHECK_INTERVAL_MS));
    await expect(isMembershipCheckDue(HH, NOW)).resolves.toBe(true);
  });

  it('is due when the stored value cannot be parsed', async () => {
    getItem.mockResolvedValue('not-a-number');
    await expect(isMembershipCheckDue(HH, NOW)).resolves.toBe(true);
  });

  it('is due when the stored timestamp is in the future (clock moved back)', async () => {
    getItem.mockResolvedValue(String(NOW + 60_000));
    await expect(isMembershipCheckDue(HH, NOW)).resolves.toBe(true);
  });

  it('is NOT due when storage cannot be read — the check must stay bounded', async () => {
    getItem.mockRejectedValue(new Error('storage unavailable'));
    await expect(isMembershipCheckDue(HH, NOW)).resolves.toBe(false);
  });
});

describe('recordMembershipCheck', () => {
  it('stores the timestamp under the household key', async () => {
    await recordMembershipCheck(HH, NOW);
    expect(setItem).toHaveBeenCalledWith(KEY, String(NOW));
  });

  it('swallows a storage failure (it only costs one extra check later)', async () => {
    setItem.mockRejectedValue(new Error('disk full'));
    await expect(recordMembershipCheck(HH, NOW)).resolves.toBeUndefined();
  });
});
