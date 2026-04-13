/**
 * e2e/journeys/addEnvelope.e2e.ts
 *
 * Detox E2E — Add Envelope Journey
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

describe.skip('Add Envelope journey (Detox — BLOCKED: not installed)', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('should open AddEditEnvelope screen via FAB', async () => {
    await expect(element(by.id('fab'))).toBeVisible();
    await element(by.id('fab')).tap();
    await expect(element(by.text('Add Envelope'))).toBeVisible();
  });

  it('should save a new income envelope and return to Dashboard', async () => {
    await element(by.id('envelope-name')).typeText('Salary');
    await element(by.text('Income')).tap();
    await element(by.id('envelope-amount')).typeText('15000');
    await element(by.id('envelope-save')).tap();
    await expect(element(by.id('fab'))).toBeVisible();
  });
});
