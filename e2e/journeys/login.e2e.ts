/**
 * e2e/journeys/login.e2e.ts
 *
 * Detox E2E — Login Journey
 */

import { device, element, by, expect as detoxExpect, waitFor } from 'detox';

describe('Login journey', () => {
  beforeAll(async () => {
    // Disable sync before launch so Detox does not wait for Supabase/Firebase
    // OkHttp connections to drain (auth session, realtime WebSocket).
    await device.disableSynchronization();
    await device.launchApp({ newInstance: true });
  });

  it('shows the login screen on first launch', async () => {
    await detoxExpect(element(by.id('login-email'))).toBeVisible();
    await detoxExpect(element(by.id('login-password'))).toBeVisible();
  });

  it('navigates to SignUp when the sign-up link is pressed', async () => {
    await element(by.id('login-signup-link')).tap();
    await detoxExpect(element(by.id('signup-email'))).toBeVisible();
    await device.pressBack();
  });

  it('shows error snackbar on invalid credentials', async () => {
    await element(by.id('login-email')).typeText('bad@example.com');
    await element(by.id('login-password')).typeText('wrongpassword');
    await element(by.id('login-submit')).tap();
    await waitFor(element(by.id('snackbar')))
      .toBeVisible()
      .withTimeout(15000);
  });
});
