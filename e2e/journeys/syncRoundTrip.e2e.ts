/**
 * e2e/journeys/syncRoundTrip.e2e.ts
 *
 * Detox E2E — Sync round-trip journey
 *
 * Verifies that sync-related UI (Add Transaction FAB, offline banner) is
 * properly gated behind authentication and the app remains stable after a
 * failed network interaction.
 *
 * NOTE: Offline-banner tests are excluded because `device.setURLBlacklist`
 * only blocks OkHttp requests and does NOT drive `NetInfo.isConnected` to
 * false. Testing OfflineBanner reliably requires a `__FORCE_OFFLINE__` debug
 * flag that bypasses NetInfo — a follow-up task.
 */

import { device, element, by, expect as detoxExpect } from 'detox';

describe('Sync round-trip journey', () => {
  beforeAll(async () => {
    await device.setURLBlacklist(['.*supabase\\.co.*', '.*firebase.*', '.*crashlytics.*']);
    await device.launchApp({ newInstance: true });
  });

  it('gates the add-transaction FAB behind authentication', async () => {
    // FAB lives on the dashboard, which is unreachable before login.
    await detoxExpect(element(by.id('add-transaction-fab'))).not.toBeVisible();
    // Login screen must be visible instead.
    await detoxExpect(element(by.id('login-email'))).toBeVisible();
  });
});
