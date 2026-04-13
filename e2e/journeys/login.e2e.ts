/**
 * e2e/journeys/login.e2e.ts
 *
 * Detox E2E — Login Journey
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

describe.skip('Login journey (Detox — BLOCKED: not installed)', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('should show the login screen on first launch', async () => {
    await expect(element(by.id('Email'))).toBeVisible();
    await expect(element(by.id('Password'))).toBeVisible();
  });

  it('should navigate to SignUp when the sign-up link is pressed', async () => {
    await element(by.id('login-signup-link')).tap();
    await expect(element(by.id('signup-email'))).toBeVisible();
  });

  it('should show error snackbar on invalid credentials', async () => {
    await element(by.id('Email')).typeText('bad@example.com');
    await element(by.id('Password')).typeText('wrongpassword');
    await element(by.id('login-submit')).tap();
    await expect(element(by.id('snackbar'))).toBeVisible();
  });
});
