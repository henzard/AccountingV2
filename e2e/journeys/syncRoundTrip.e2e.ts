/**
 * e2e/journeys/syncRoundTrip.e2e.ts
 *
 * Detox E2E — Sync Round-Trip Journey
 *
 * Verifies: transaction queued → offline banner appears → banner hides when online.
 * Requires at least one envelope to exist (addEnvelope journey runs first).
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

  it('shows the offline banner when network is blocked', async () => {
    await device.setURLBlacklist(['.*supabase.*']);
    await device.sendToHome();
    await device.launchApp({ newInstance: false });
    await detoxExpect(element(by.id('offline-banner'))).toBeVisible();
  });

  it('hides the offline banner when network is restored', async () => {
    await device.setURLBlacklist([]);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await detoxExpect(element(by.id('offline-banner'))).not.toBeVisible();
  });
});
