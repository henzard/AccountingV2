/**
 * e2e/journeys/addEnvelope.e2e.ts
 *
 * Detox E2E — Add Envelope Journey
 *
 * Prerequisite: user is signed in and on the Dashboard screen.
 */

import { device, element, by, expect as detoxExpect } from 'detox';

describe('Add Envelope journey', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: false });
  });

  it('opens AddEditEnvelope screen via empty-state button', async () => {
    await detoxExpect(element(by.id('dashboard-empty-state'))).toBeVisible();
    await element(by.text('+ New envelope')).tap();
    await detoxExpect(element(by.id('envelope-name'))).toBeVisible();
  });

  it('saves a new income envelope and returns to Dashboard', async () => {
    await element(by.id('envelope-name')).typeText('Salary');
    await element(by.text('Income')).tap();
    await element(by.id('envelope-amount')).typeText('15000');
    await element(by.id('envelope-save')).tap();
    await detoxExpect(element(by.id('add-transaction-fab'))).toBeVisible();
  });
});
