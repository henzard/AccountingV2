/**
 * e2e/journeys/authenticatedJourney.e2e.ts
 *
 * Detox E2E — Tier-4 authenticated journey
 *
 * Sign up → create household → complete onboarding → create an additional
 * envelope → add a transaction → verify it appears.
 *
 * Unlike the other journeys in this folder (login/addEnvelope/syncRoundTrip),
 * which only assert that the dashboard/auth gate holds *before* signing in,
 * this journey drives a real account all the way through the app against a
 * live Supabase backend. It is intentionally the only journey that does NOT
 * blacklist Supabase traffic — it needs signUp, the household/envelope/
 * transaction writes, and the local-first sync layer to actually go through.
 *
 * Backend: the CI/CD e2e job (see ci.yml's `e2e-android` and cd.yml's
 * `e2e-gate`) boots a fresh local Supabase stack and points
 * EXPO_PUBLIC_SUPABASE_URL at it (via 10.0.2.2, the Android emulator's alias
 * for the runner's host loopback) — never at production. Locally, run
 * `supabase start` and rebuild the debug APK with EXPO_PUBLIC_SUPABASE_URL
 * pointed at your own local stack (see supabase status -o env) before
 * running `detox test --configuration android.emu.debug`.
 *
 * Local Supabase has `enable_confirmations = false` (supabase/config.toml),
 * so `signUp` returns a session immediately instead of requiring an email
 * click — the app's SignUpScreen auth listener then navigates straight past
 * the transitional screens into the household-creation gate.
 *
 * KNOWN GAP (documented per task-6 brief): this file has been written to
 * match the real screens' testIDs/selectors and is type/lint-clean, but has
 * NOT been executed end-to-end in this environment — running Detox requires
 * an Android emulator and a built APK, neither of which is available here.
 * The first real CI run of ci.yml's e2e-android job (or a local run with an
 * emulator) is the first actual execution of this journey.
 */

import { device, element, by, expect as detoxExpect, waitFor } from 'detox';

// Unique per process run so repeated executions against the same Supabase
// stack (e.g. re-running locally without resetting the DB) never collide on
// the same auth.users row or household name.
const RUN_ID = Date.now();
const TEST_EMAIL = `e2e-auth-${RUN_ID}@example.test`;
const TEST_PASSWORD = 'E2E-test-passw0rd!';
const HOUSEHOLD_NAME = `E2E Household ${RUN_ID}`;
const MONTHLY_INCOME = '12000';
const SINKING_FUND_NAME = `E2E Fund ${RUN_ID}`;
const SINKING_FUND_AMOUNT = '500';
const TRANSACTION_PAYEE = `E2E Payee ${RUN_ID}`;
const TRANSACTION_AMOUNT = '25.00';

// A default expense category envelope created by onboarding's
// ExpenseCategoriesStep (the four preselected defaults are Groceries,
// Transport, Rent, Utilities) — used as the transaction's target envelope.
const DEFAULT_ENVELOPE_NAME = 'Groceries';

const LONG_TIMEOUT = 20000;
const MEDIUM_TIMEOUT = 10000;

describe('Authenticated journey: sign up → onboard → envelope → transaction', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: {
        // Deliberately does NOT blacklist supabase — this journey needs real
        // auth + data-layer round trips. Firebase/GCM/Crashlytics are still
        // blocked: they open long-lived connections unrelated to this
        // journey that would otherwise stall Detox's UI synchronisation.
        detoxURLBlacklist: JSON.stringify([
          '.*firebase.*',
          '.*crashlytics.*',
          '.*googleapis\\.com.*',
          '.*google\\.com/.*',
        ]),
      },
    });
  });

  it('signs up a new account', async () => {
    await detoxExpect(element(by.id('login-email'))).toBeVisible();
    await element(by.id('login-signup-link')).tap();
    await detoxExpect(element(by.id('signup-email'))).toBeVisible();

    await element(by.id('signup-email')).typeText(TEST_EMAIL);
    await element(by.id('signup-password')).typeText(TEST_PASSWORD);
    await element(by.id('signup-confirm-password')).typeText(TEST_PASSWORD);
    await element(by.id('signup-submit')).tap();

    // Email confirmations are disabled on the local stack, so signUp returns
    // a session immediately and the auth listener routes past the
    // transitional "signup-success" screen straight to the household gate.
    await waitFor(element(by.id('household-name-input')))
      .toBeVisible()
      .withTimeout(LONG_TIMEOUT);
  });

  it('creates a household', async () => {
    await element(by.id('household-name-input')).typeText(HOUSEHOLD_NAME);
    // Payday defaults to day 25 in the input — already valid (1-28), no edit needed.
    await element(by.id('household-create-submit')).tap();

    // RootNavigator resolves the onboarding-complete flag asynchronously,
    // then routes into the onboarding wizard's Welcome step.
    await waitFor(element(by.text("Let's begin")))
      .toBeVisible()
      .withTimeout(LONG_TIMEOUT);
  });

  it('completes the onboarding wizard', async () => {
    // Welcome
    await element(by.text("Let's begin")).tap();

    // Income
    await waitFor(element(by.id('income-amount-input')))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);
    await element(by.id('income-amount-input')).typeText(MONTHLY_INCOME);
    await element(by.id('onboarding-cta')).tap();

    // Expense categories — accept the four preselected defaults (Groceries,
    // Transport, Rent, Utilities); no chip taps needed.
    await waitFor(element(by.id('onboarding-cta')))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);
    await element(by.id('onboarding-cta')).tap();

    // Allocate envelopes — the default equal split of income across the
    // selected categories already sums to the full income (to-assign = R0),
    // so no per-envelope edits are needed. This screen creates the four
    // envelopes via CreateEnvelopeUseCase.
    await waitFor(element(by.id('to-assign')))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);
    await element(by.text('Next')).tap();

    // Payday — prefilled with the household's payday day, already valid.
    await waitFor(element(by.id('onboarding-cta')))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);
    await element(by.id('onboarding-cta')).tap();

    // Meter setup — skip (leave all three switches off).
    await waitFor(element(by.text('Skip')))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);
    await element(by.text('Skip')).tap();

    // Habit score intro
    await waitFor(element(by.text('Continue')))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);
    await element(by.text('Continue')).tap();

    // Finish
    await waitFor(element(by.text('Go to Dashboard')))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);
    await element(by.text('Go to Dashboard')).tap();

    // Onboarding created 4 envelopes, so the dashboard renders the populated
    // list state (not dashboard-empty-state).
    await waitFor(element(by.id('dashboard-root')))
      .toBeVisible()
      .withTimeout(LONG_TIMEOUT);
  });

  it('creates an additional envelope (sinking fund)', async () => {
    await element(by.id('sinking-funds-entry')).tap();
    await waitFor(element(by.id('new-sinking-fund-fab')))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);
    await element(by.id('new-sinking-fund-fab')).tap();

    await detoxExpect(element(by.id('envelope-name'))).toBeVisible();
    await element(by.id('envelope-name')).typeText(SINKING_FUND_NAME);
    await element(by.id('envelope-amount')).typeText(SINKING_FUND_AMOUNT);
    await element(by.id('envelope-save')).tap();

    // Back on SinkingFundsScreen — the new fund's name confirms it was
    // created and persisted (SinkingFundCard renders envelope.name).
    await waitFor(element(by.text(SINKING_FUND_NAME)))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);

    await device.pressBack();
    await waitFor(element(by.id('dashboard-root')))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);
  });

  it('adds a transaction and verifies it appears in the transaction list', async () => {
    await element(by.id('add-transaction-fab')).tap();

    await waitFor(element(by.id('envelope-picker-trigger')))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);
    await element(by.id('envelope-picker-trigger')).tap();
    await element(by.text(DEFAULT_ENVELOPE_NAME)).tap();

    await element(by.id('amount-input')).typeText(TRANSACTION_AMOUNT);
    await element(by.id('payee-input')).typeText(TRANSACTION_PAYEE);
    await element(by.id('record-transaction-submit')).tap();

    // Saving navigates back to the dashboard.
    await waitFor(element(by.id('dashboard-root')))
      .toBeVisible()
      .withTimeout(MEDIUM_TIMEOUT);

    // Switch to the Budget tab (route "Transactions"), which lands on
    // TransactionListScreen — the row's title is the transaction's payee.
    await element(by.text('Budget')).tap();
    await waitFor(element(by.text(TRANSACTION_PAYEE)))
      .toBeVisible()
      .withTimeout(LONG_TIMEOUT);
  });
});
