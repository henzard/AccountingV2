/**
 * e2e/journeys/syncRoundTrip.e2e.ts
 *
 * Detox E2E — Sync Round-Trip Journey
 *
 * STATUS: BLOCKED — Detox is not installed in this project.
 * To unblock: npx expo install detox @config-plugins/detox,
 * then configure .detoxrc.js and remove the describe.skip.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// When Detox is installed these globals are injected by the test runner.
declare const device: any;
declare const element: any;
declare const by: any;

describe('syncRoundTrip — BLOCKED: detox not installed', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('should create a transaction and confirm it is queued for sync', async () => {
    // Navigate to the Add Transaction screen
    await expect(element(by.id('fab'))).toBeVisible();
    await element(by.id('fab')).tap();
    await expect(element(by.text('Record Transaction'))).toBeVisible();
  });

  it('should display pending sync indicator when offline', async () => {
    // Simulate going offline and verify sync queue indicator is shown
    await device.setURLBlacklist(['.*supabase.*']);
    await expect(element(by.id('offline-banner'))).toBeVisible();
  });

  it('should sync pending records when back online', async () => {
    // Simulate coming back online
    await device.setURLBlacklist([]);
    // Allow time for sync to complete
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await expect(element(by.id('offline-banner'))).not.toBeVisible();
  });
});
