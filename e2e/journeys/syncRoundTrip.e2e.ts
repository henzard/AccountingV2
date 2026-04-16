/**
 * e2e/journeys/syncRoundTrip.e2e.ts
 *
 * Detox E2E — Sync Round-Trip Journey
 *
 * Tests Add Transaction FAB navigation.
 *
 * NOTE: Offline-banner tests are excluded from this suite because
 * `device.setURLBlacklist` only blocks OkHttp requests and does NOT drive
 * `NetInfo.isConnected` to false. To test the OfflineBanner reliably, the
 * debug build needs a `__FORCE_OFFLINE__` debug flag that bypasses NetInfo
 * and directly sets `useSyncStore.isOnline = false`. That is a follow-up task.
 */

import { device, element, by, expect as detoxExpect } from 'detox';

describe('Sync round-trip journey', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: false });
  });

  it('shows Add Transaction screen from the FAB', async () => {
    await detoxExpect(element(by.id('add-transaction-fab'))).toBeVisible();
    await element(by.id('add-transaction-fab')).tap();
    await detoxExpect(element(by.text('Record Transaction'))).toBeVisible();
    await device.pressBack();
  });
});
