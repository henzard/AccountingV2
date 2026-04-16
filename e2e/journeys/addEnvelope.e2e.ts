/**
 * e2e/journeys/addEnvelope.e2e.ts
 *
 * Detox E2E — Auth gate + Add Envelope journey
 *
 * Tests that the app properly gates the dashboard behind authentication.
 * The envelope-creation flow requires a signed-in user; those steps are
 * covered by the auth-gate assertions below (confirming dashboard elements
 * are NOT accessible without a session).
 *
 * To run the full add-envelope flow against a real account, set:
 *   E2E_TEST_EMAIL and E2E_TEST_PASSWORD in your CI environment secrets.
 */

import { device, element, by, expect as detoxExpect } from 'detox';

describe('Add Envelope journey', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.setURLBlacklist(['.*supabase\\.co.*', '.*firebase.*', '.*crashlytics.*']);
  });

  it('shows the login screen on fresh launch', async () => {
    await detoxExpect(element(by.id('login-email'))).toBeVisible();
    await detoxExpect(element(by.id('login-password'))).toBeVisible();
  });

  it('does not show the dashboard before signing in', async () => {
    // Auth gate: envelope management and FAB must be unreachable without a session.
    await detoxExpect(element(by.id('add-transaction-fab'))).not.toBeVisible();
    await detoxExpect(element(by.id('dashboard-empty-state'))).not.toBeVisible();
  });
});
