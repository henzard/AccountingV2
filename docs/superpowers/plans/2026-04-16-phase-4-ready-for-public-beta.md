# Phase 4 — Ready for Public Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real Detox E2E tests as a hard CI gate, fix the `android:allowBackup` security gap, harden CD with Firebase Test Lab + working Crashlytics upload, and promote the Play Store listing so external beta testers can install.

**Architecture:** Tasks 1–2 (security + Detox install) are prerequisites for Tasks 3–5 (journey files + CI gate) because the AVD runner needs the Detox package to exist. Tasks 6–8 (CD hardening + Play Store + privacy policy) are independent of the E2E work and can land in any order. Task 9 (bmad back-fill) is docs-only.

**Tech Stack:** Detox 20.x, `@config-plugins/detox`, `reactivecircus/android-emulator-runner@v2`, `google-github-actions/auth@v2`, `google-github-actions/setup-gcloud@v2`, Firebase Test Lab (Robo), r0adkll/upload-google-play.

---

## File Map

| File                                                                | Action | Purpose                                                                            |
| ------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `android/app/src/main/AndroidManifest.xml`                          | Modify | Fix `allowBackup="true"` → `"false"`                                               |
| `docs/security-decisions.md`                                        | Create | Document SQLite encryption residual risk                                           |
| `.detoxrc.js`                                                       | Modify | Add debug APK configuration + build script                                         |
| `app.config.ts`                                                     | Modify | Add `@config-plugins/detox` plugin                                                 |
| `src/presentation/screens/auth/LoginScreen.tsx`                     | Modify | Add `testID` to email + password inputs                                            |
| `src/presentation/screens/envelopes/AddEditEnvelopeScreen.tsx`      | Modify | Add `testID` to name, amount inputs + save button                                  |
| `e2e/journeys/login.e2e.ts`                                         | Modify | Remove BLOCKED status, fix testID references                                       |
| `e2e/journeys/addEnvelope.e2e.ts`                                   | Modify | Remove BLOCKED status, fix `by.id('fab')` → `add-transaction-fab`                  |
| `e2e/journeys/syncRoundTrip.e2e.ts`                                 | Modify | Remove BLOCKED status, fix `by.id('fab')` reference                                |
| `.github/workflows/ci.yml`                                          | Modify | Add AVD runner, change config to debug, remove `continue-on-error`                 |
| `.github/workflows/cd.yml`                                          | Modify | Remove Crashlytics `continue-on-error`, add Firebase Test Lab step, promote status |
| `docs/privacy-policy.md`                                            | Create | Privacy policy for store listing                                                   |
| `_bmad-output/planning-artifacts/epics-and-stories/phase4-epics.md` | Create | bmad back-fill                                                                     |

---

## Task 1: Fix android:allowBackup + document SQLite residual risk

**Files:**

- Modify: `android/app/src/main/AndroidManifest.xml:17`
- Create: `docs/security-decisions.md`

Context: `app.config.ts` declares `allowBackup: false` but the source `AndroidManifest.xml` has `android:allowBackup="true"` hardcoded. Because the source manifest is checked in, it wins over the Expo config. Built outputs show `allowBackup="true"`, meaning user data in SQLite is included in Android backups by default.

- [ ] **Step 1: Edit the manifest**

In `android/app/src/main/AndroidManifest.xml` line 17, change:

```xml
android:allowBackup="true"
```

to:

```xml
android:allowBackup="false"
```

The full `<application>` opening tag becomes:

```xml
<application android:name=".MainApplication" android:label="@string/app_name" android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round" android:allowBackup="false" android:theme="@style/AppTheme" android:supportsRtl="true" android:enableOnBackInvokedCallback="false" android:fullBackupContent="@xml/secure_store_backup_rules" android:dataExtractionRules="@xml/secure_store_data_extraction_rules">
```

- [ ] **Step 2: Create the security decisions doc**

Create `docs/security-decisions.md`:

```markdown
# Security Decisions

## SQLite Encryption

**Decision (2026-04-16):** SQLite is not encrypted at rest via SQLCipher. We accept residual risk.

**Rationale:**

- `android:allowBackup="false"` prevents the database from appearing in Android cloud backups.
- `android:fullBackupContent="@xml/secure_store_backup_rules"` and `android:dataExtractionRules="@xml/secure_store_data_extraction_rules"` restrict what ADB/D2D backup can capture.
- Sensitive credentials (Supabase tokens) are stored in `expo-secure-store` (Keystore-backed), not SQLite.
- SQLite contains envelope names, amounts, and transaction records — financial metadata but not payment-card or credential data.
- Installing SQLCipher (`op-sqlite` fork) would require a bare-workflow native module, a significant migration of the Drizzle schema, and a key-derivation strategy (key pinning in Keystore). This is deferred to a dedicated security sprint.

**Residual risk:** A rooted device or physical access to an unlocked device could read the database file. Acceptable for internal beta; re-evaluate before general availability.

**Owner:** Henza Kruger — revisit when MAU > 100 or first enterprise inquiry.
```

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml docs/security-decisions.md
git commit -m "fix(security): set allowBackup=false in source manifest; document SQLite residual risk"
```

Expected: commit succeeds, no test failures triggered.

---

## Task 2: Install Detox + configure build script

**Files:**

- Modify: `package.json` (via npm install)
- Modify: `.detoxrc.js`
- Modify: `app.config.ts`

Context: `detox` and `@config-plugins/detox` are not installed. `.detoxrc.js` only defines a release-APK config with no build script. The CI job will need a debug config so it can build without a keystore.

- [ ] **Step 1: Install packages**

```bash
npm install detox @config-plugins/detox --save-dev
```

Expected output ends with: `added N packages` (no errors). Detox 20.x is compatible with React Native 0.74.

- [ ] **Step 2: Update .detoxrc.js**

Replace the entire file with a config that adds a debug app + build script alongside the existing release entry:

```js
/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/jest.config.js' },
    jest: { setupTimeout: 120000 },
  },
  apps: {
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build: 'cd android && ./gradlew assembleDebug --no-daemon',
    },
  },
  devices: {
    emulator: {
      type: 'android.emulator',
      device: { avdName: 'Pixel_6_API_34' },
    },
  },
  configurations: {
    'android.emu.release': { device: 'emulator', app: 'android.release' },
    'android.emu.debug': { device: 'emulator', app: 'android.debug' },
  },
};
```

- [ ] **Step 3: Add @config-plugins/detox to app.config.ts**

In `app.config.ts`, add `'@config-plugins/detox'` to the `plugins` array before the existing entries:

```ts
  plugins: [
    '@config-plugins/detox',
    'expo-sqlite',
    'expo-secure-store',
    'expo-camera',
    '@react-native-community/datetimepicker',
    '@react-native-firebase/app',
    '@react-native-firebase/crashlytics',
    '@react-native-firebase/messaging',
    ['expo-notifications', { icon: './assets/icon.png', color: '#00695C' }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withFirebaseNotificationColorFix as any,
  ],
```

- [ ] **Step 4: Verify TypeScript still passes**

```bash
npx tsc --noEmit
```

Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .detoxrc.js app.config.ts
git commit -m "chore(e2e): install detox + @config-plugins/detox; add debug APK configuration"
```

---

## Task 3: Add missing testIDs for E2E

**Files:**

- Modify: `src/presentation/screens/auth/LoginScreen.tsx`
- Modify: `src/presentation/screens/envelopes/AddEditEnvelopeScreen.tsx`

Context: The E2E journeys use `by.id()` which matches the `testID` prop. The email/password inputs in `LoginScreen` have no `testID`. The envelope name/amount inputs and save button in `AddEditEnvelopeScreen` have no `testID` either.

- [ ] **Step 1: Add testIDs to LoginScreen email and password inputs**

In `LoginScreen.tsx`, the email `TextInput` (around line 69) currently has no `testID`. Add `testID="login-email"`. The password `TextInput` (around line 85) gets `testID="login-password"`.

Find the email TextInput (it has `label="Email"`) and add the prop:

```tsx
<TextInput
  label="Email"
  value={email}
  onChangeText={setEmail}
  autoCapitalize="none"
  keyboardType="email-address"
  autoComplete="email"
  textContentType="emailAddress"
  mode="outlined"
  style={[styles.input, { backgroundColor: colors.surface }]}
  disabled={loading}
  accessibilityLabel="Email address"
  accessibilityRole="none"
  maxFontSizeMultiplier={1.6}
  testID="login-email"
/>
```

Find the password TextInput (it has `label="Password"`) and add:

```tsx
<TextInput
  label="Password"
  value={password}
  onChangeText={setPassword}
  secureTextEntry={!passwordVisible}
  autoComplete="password"
  textContentType="password"
  mode="outlined"
  style={[styles.input, { backgroundColor: colors.surface }]}
  disabled={loading}
  accessibilityLabel="Password"
  accessibilityRole="none"
  maxFontSizeMultiplier={1.6}
  testID="login-password"
  right={
    <TextInput.Icon
      icon={passwordVisible ? 'eye-off' : 'eye'}
      onPress={() => setPasswordVisible((v) => !v)}
      accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
    />
  }
/>
```

- [ ] **Step 2: Add testIDs to AddEditEnvelopeScreen**

In `AddEditEnvelopeScreen.tsx`, find the `TextInput` with `label="Envelope name"` and add `testID="envelope-name"`:

```tsx
<TextInput
  label="Envelope name"
  value={name}
  onChangeText={setName}
  mode="outlined"
  style={styles.input}
  disabled={loading}
  testID="envelope-name"
/>
```

Find the `TextInput` with `label="Monthly budget (R)"` and add `testID="envelope-amount"`:

```tsx
<TextInput
  label="Monthly budget (R)"
  value={amountStr}
  onChangeText={setAmountStr}
  mode="outlined"
  style={styles.input}
  keyboardType="decimal-pad"
  disabled={loading}
  testID="envelope-amount"
/>
```

Find the contained `Button` that calls `handleSave` (it has `mode="contained"`) and add `testID="envelope-save"`:

```tsx
<Button
  mode="contained"
  onPress={handleSave}
  loading={loading}
  disabled={loading}
  testID="envelope-save"
>
  Save
</Button>
```

(Keep all other existing props — only add `testID`.)

- [ ] **Step 3: Run Jest to confirm no regressions**

```bash
npx jest --testPathPattern="LoginScreen|AddEditEnvelope" --no-coverage
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/auth/LoginScreen.tsx src/presentation/screens/envelopes/AddEditEnvelopeScreen.tsx
git commit -m "feat(e2e): add testIDs to login email/password inputs and envelope form fields"
```

---

## Task 4: Fix E2E journey files

**Files:**

- Modify: `e2e/journeys/login.e2e.ts`
- Modify: `e2e/journeys/addEnvelope.e2e.ts`
- Modify: `e2e/journeys/syncRoundTrip.e2e.ts`

Context: All three journey files have `STATUS: BLOCKED` banners and use wrong testIDs (e.g., `by.id('fab')` should be `by.id('add-transaction-fab')`). The describe titles also embed `BLOCKED: not installed` which should be cleaned up. The journey files use bare Detox globals (`device`, `element`, `by`) which are ambient when Detox runs — the `declare const` shims handle TypeScript, but once `detox` is installed as a package those shims may conflict with the real types. Replace the shims with the proper import.

- [ ] **Step 1: Rewrite login.e2e.ts**

```ts
/**
 * e2e/journeys/login.e2e.ts
 *
 * Detox E2E — Login Journey
 */

import { device, element, by, expect as detoxExpect } from 'detox';

describe('Login journey', () => {
  beforeAll(async () => {
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
    await detoxExpect(element(by.id('snackbar'))).toBeVisible();
  });
});
```

Note: `signup-email` testID needs to exist on the SignUpScreen email input. If it doesn't, check `src/presentation/screens/auth/SignUpScreen.tsx` and add `testID="signup-email"` to the email TextInput (same pattern as Task 3).

- [ ] **Step 2: Check SignUpScreen for signup-email testID**

```bash
grep -n "testID" src/presentation/screens/auth/SignUpScreen.tsx
```

If the email input has no testID, add `testID="signup-email"` to it (same pattern as Task 3, Step 1). Then re-run Jest:

```bash
npx jest --testPathPattern="SignUpScreen" --no-coverage
```

Expected: tests pass.

- [ ] **Step 3: Rewrite addEnvelope.e2e.ts**

The existing file uses `by.id('fab')` but the real testID on the Dashboard FAB is `add-transaction-fab`. Fix it:

```ts
/**
 * e2e/journeys/addEnvelope.e2e.ts
 *
 * Detox E2E — Add Envelope Journey
 *
 * Prerequisite: user is signed in and on the Dashboard screen.
 * Sign-in setup is handled in the global beforeAll (login.e2e.ts runs first
 * in alphabetical order; device state persists across describe blocks).
 */

import { device, element, by, expect as detoxExpect } from 'detox';

describe('Add Envelope journey', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: false });
  });

  it('opens AddEditEnvelope screen via Dashboard FAB', async () => {
    await detoxExpect(element(by.id('add-transaction-fab'))).toBeVisible();
    // FAB navigates to AddTransaction; envelope creation is via the empty-state button
    // or the nav menu. Navigate using the empty-state button if no envelopes exist:
    await detoxExpect(element(by.id('dashboard-empty-state'))).toBeVisible();
    await element(by.text('+ New envelope')).tap();
    await detoxExpect(element(by.id('envelope-name'))).toBeVisible();
  });

  it('saves a new income envelope and returns to Dashboard', async () => {
    await element(by.id('envelope-name')).typeText('Salary');
    // Select Income type (PickerField with label "Type")
    await element(by.text('Income')).tap();
    await element(by.id('envelope-amount')).typeText('15000');
    await element(by.id('envelope-save')).tap();
    // After save, navigation pops back to Dashboard
    await detoxExpect(element(by.id('add-transaction-fab'))).toBeVisible();
  });
});
```

- [ ] **Step 4: Rewrite syncRoundTrip.e2e.ts**

```ts
/**
 * e2e/journeys/syncRoundTrip.e2e.ts
 *
 * Detox E2E — Sync Round-Trip Journey
 *
 * Verifies that: transaction is queued → offline banner appears → banner hides when online.
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
    // Trigger a sync attempt by re-opening the app
    await device.sendToHome();
    await device.launchApp({ newInstance: false });
    await detoxExpect(element(by.id('offline-banner'))).toBeVisible();
  });

  it('hides the offline banner when network is restored', async () => {
    await device.setURLBlacklist([]);
    // Wait for NetInfo reconnect propagation
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await detoxExpect(element(by.id('offline-banner'))).not.toBeVisible();
  });
});
```

- [ ] **Step 5: Verify TypeScript on e2e files**

```bash
npx tsc --noEmit
```

Expected: 0 errors. (The `detox` package now provides real types; the old `declare const` shims are gone.)

- [ ] **Step 6: Commit**

```bash
git add e2e/journeys/login.e2e.ts e2e/journeys/addEnvelope.e2e.ts e2e/journeys/syncRoundTrip.e2e.ts src/presentation/screens/auth/SignUpScreen.tsx
git commit -m "feat(e2e): unblock all three Detox journeys; fix testID references"
```

---

## Task 5: Wire CI e2e-android job

**Files:**

- Modify: `.github/workflows/ci.yml`

Context: The current `e2e-android` job has `continue-on-error: true` (non-blocking), targets the release configuration (needs keystore), and has no emulator setup step. We need: remove the bypass, switch to the debug configuration, and add `reactivecircus/android-emulator-runner@v2` to spin up the AVD.

- [ ] **Step 1: Replace the e2e-android job**

In `.github/workflows/ci.yml`, replace the entire `e2e-android:` job (lines 42–60) with:

```yaml
e2e-android:
  if: github.ref == 'refs/heads/master'
  runs-on: macos-latest
  needs: check
  steps:
    - uses: actions/checkout@v4

    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'

    - uses: actions/setup-java@v4
      with:
        java-version: '17'
        distribution: 'temurin'

    - name: Install JS dependencies
      run: npm ci

    - name: Install Detox CLI
      run: npm install -g detox-cli

    - name: Build debug APK
      run: detox build --configuration android.emu.debug

    - name: Run Detox tests on emulator
      uses: reactivecircus/android-emulator-runner@v2
      with:
        api-level: 34
        target: google_apis
        arch: x86_64
        avd-name: Pixel_6_API_34
        script: detox test --configuration android.emu.debug --headless --loglevel warn
```

Key changes vs. current:

- Removed `continue-on-error: true`
- Added `needs: check` so E2E only runs after unit tests pass
- Switched to `android.emu.debug` configuration (no keystore needed)
- Separated build step from test step (build outside emulator runner, test inside)
- Used `reactivecircus/android-emulator-runner@v2` to manage AVD lifecycle

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(e2e): add AVD runner, switch to debug config, remove continue-on-error"
```

Expected: after merging to master, the `e2e-android` job will be a hard gate. If Detox tests fail, the CD pipeline (`needs: check` in CD inherits from CI) will not proceed.

---

## Task 6: Fix Crashlytics upload in CD

**Files:**

- Modify: `.github/workflows/cd.yml`

Context: The Crashlytics upload step at line 75 has `continue-on-error: true`. This was a safety net because the upload may fail if `FIREBASE_CLI_TOKEN` or `GOOGLE_APPLICATION_CREDENTIALS` is not configured as a secret. Before removing the bypass, verify the secret exists.

- [ ] **Step 1: Check if the Firebase service account secret is configured**

In your GitHub repo → Settings → Secrets and variables → Actions, look for `FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICES_JSON`. If neither exists, the Crashlytics step will always fail — add the secret first (see Step 2 alternative path).

**Path A — Secret exists:** Skip to Step 3.

**Path B — Secret does not exist:**

Add a `GOOGLE_SERVICES_JSON` secret to the GitHub repo Actions secrets. The value should be the contents of your `android/app/google-services.json` file (base64-encoded or raw JSON, depending on how you write it to disk).

Then, in the `build-and-publish` job in `cd.yml`, add a step immediately after `actions/checkout@v4` to write the file:

```yaml
- name: Write google-services.json
  run: echo '${{ secrets.GOOGLE_SERVICES_JSON }}' > android/app/google-services.json
```

- [ ] **Step 2: Verify the Crashlytics upload tasks are configured**

The tasks `uploadCrashlyticsSymbolFileRelease` and `uploadCrashlyticsMappingFileRelease` require `google-services.json` present and the Firebase app ID registered. Run locally (with your own google-services.json) to confirm they succeed:

```bash
cd android && ./gradlew uploadCrashlyticsSymbolFileRelease --no-daemon
```

Expected: `BUILD SUCCESSFUL`. If it fails with "App ID not found", verify `google-services.json` contains the `mobilesdk_app_id` for `com.henza.accountingv2`.

- [ ] **Step 3: Remove continue-on-error from the Crashlytics step**

In `.github/workflows/cd.yml`, find the Crashlytics step (currently around line 73–78):

```yaml
- name: Upload JS source maps to Crashlytics
  working-directory: android
  continue-on-error: true
  run: |
    ./gradlew uploadCrashlyticsSymbolFileRelease
    ./gradlew uploadCrashlyticsMappingFileRelease
```

Remove the `continue-on-error: true` line:

```yaml
- name: Upload JS source maps to Crashlytics
  working-directory: android
  run: |
    ./gradlew uploadCrashlyticsSymbolFileRelease
    ./gradlew uploadCrashlyticsMappingFileRelease
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/cd.yml
git commit -m "ci(cd): remove continue-on-error from Crashlytics upload step"
```

---

## Task 7: Add Firebase Test Lab smoke run to CD

**Files:**

- Modify: `.github/workflows/cd.yml`

Context: There is currently no automated device test on real hardware. Firebase Test Lab's Robo crawler provides a zero-configuration smoke test that catches crashes on first launch. We add it after the AAB build but before the Play Store upload so a crash-on-launch blocks the release.

- [ ] **Step 1: Add Test Lab steps to cd.yml**

In `.github/workflows/cd.yml`, in the `build-and-publish` job, add the following three steps **after** the `Build release AAB` step and **before** the Crashlytics step:

```yaml
- name: Authenticate to Google Cloud
  uses: google-github-actions/auth@v2
  with:
    credentials_json: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON }}

- name: Set up gcloud CLI
  uses: google-github-actions/setup-gcloud@v2

- name: Build release APK for Firebase Test Lab
  working-directory: android
  run: ./gradlew assembleRelease -PversionCode=${{ github.run_number }} -PversionName=${{ steps.vname.outputs.name }} --no-daemon
  env:
    KEYSTORE_PATH: release.keystore
    KEYSTORE_STORE_PASSWORD: ${{ secrets.KEYSTORE_STORE_PASSWORD }}
    KEYSTORE_KEY_ALIAS: ${{ secrets.KEYSTORE_KEY_ALIAS }}
    KEYSTORE_KEY_PASSWORD: ${{ secrets.KEYSTORE_KEY_PASSWORD }}
    EXPO_PUBLIC_SUPABASE_URL: https://qmfsobqpnogefvzltwyj.supabase.co
    EXPO_PUBLIC_SUPABASE_ANON_KEY: sb_publishable_Rk3QUD3vehZPVPuoWx-RRg_k5oM47l5

- name: Firebase Test Lab — Robo smoke test
  run: |
    gcloud firebase test android run \
      --type robo \
      --app android/app/build/outputs/apk/release/app-release.apk \
      --device model=Pixel6,version=34,locale=en,orientation=portrait \
      --timeout 90s \
      --project ${{ secrets.FIREBASE_PROJECT_ID }}
```

Note: This requires two GitHub secrets:

- `FIREBASE_SERVICE_ACCOUNT_JSON` — Firebase service account JSON with `Firebase Test Lab Admin` role
- `FIREBASE_PROJECT_ID` — your Firebase project ID (e.g., `accountingv2-abc12`)

- [ ] **Step 2: Add secrets to GitHub repo**

In GitHub → Settings → Secrets → Actions, create:

- `FIREBASE_SERVICE_ACCOUNT_JSON`: paste the service account JSON from Firebase Console → Project Settings → Service Accounts → Generate new private key
- `FIREBASE_PROJECT_ID`: your Firebase project ID from the Firebase Console dashboard

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cd.yml
git commit -m "ci(cd): add Firebase Test Lab Robo smoke test before Play Store upload"
```

---

## Task 8: Promote Play Store listing + write privacy policy

**Files:**

- Modify: `.github/workflows/cd.yml`
- Create: `docs/privacy-policy.md`

Context: The Play Store upload step has `status: draft`, meaning each AAB is uploaded but not made available to testers. Changing to `status: completed` makes each upload immediately available to the internal testing group. Also, Google Play requires a privacy policy link for all apps; create the doc and host it (e.g., GitHub Pages or a static URL).

- [ ] **Step 1: Change Play Store status from draft to completed**

In `.github/workflows/cd.yml`, find the `Upload to Play Store — Internal Testing` step. Change:

```yaml
status: draft
```

to:

```yaml
status: completed
```

- [ ] **Step 2: Create docs/privacy-policy.md**

```markdown
# Privacy Policy — AccountingV2

_Last updated: 2026-04-16_

## Who we are

AccountingV2 is a personal budgeting app developed by Henza Kruger (henzardkruger@gmail.com). This policy applies to the Android app published on Google Play under the package name `com.henza.accountingv2`.

## What data we collect

### Data you enter

- Email address and password (used for authentication via Supabase Auth).
- Household budget data: envelope names, allocated amounts, transaction amounts, payees, and descriptions.
- Income figures and payday configuration.

### Data collected automatically

- Crash reports via Firebase Crashlytics. These include device model, OS version, app version, and a stack trace. They do not include personally identifiable information unless it appears in a log message (we do not log PII).
- Anonymous usage events are not currently collected.

## Slip scanning (AI feature)

If you use the slip-scanning feature, a photo of your till slip is sent to OpenAI's API for text extraction. The image is transmitted over TLS and is subject to OpenAI's [data usage policies](https://openai.com/policies/usage-policies). Images are not stored on our servers after the extraction response is returned. We recommend cropping or obscuring your name, card number, and loyalty details before scanning.

## How we store data

- **On-device:** Budget data is stored in a SQLite database on your device. The database is not included in Android backups (`android:allowBackup="false"`). The database is not currently encrypted (see our [security decisions](./security-decisions.md) for rationale and roadmap).
- **In the cloud:** Data is synced to a Supabase PostgreSQL database hosted in the EU (Frankfurt). All connections use TLS 1.2+. Row-level security policies restrict each household to its own data.
- **Credentials:** Authentication tokens are stored in Android Keystore-backed secure storage (`expo-secure-store`), not in plain SQLite.

## Data retention

- Your account and household data remain in the Supabase database until you delete your account.
- Firebase Crashlytics retains crash reports for 90 days.

## Sharing

We do not sell or share your personal data with third parties except:

- **Supabase** — database and authentication host (data processor).
- **OpenAI** — slip image processing (only when you use the scan feature).
- **Firebase / Google** — crash reporting.

## Your rights

You may request deletion of your account and all associated data by emailing henzardkruger@gmail.com. We will process the request within 30 days.

## Children

This app is not directed at children under 13. We do not knowingly collect data from children.

## Changes

We will update this policy when we change data practices. The `Last updated` date at the top will reflect changes.

## Contact

Henza Kruger — henzardkruger@gmail.com
```

- [ ] **Step 3: Host the privacy policy**

The privacy policy must be publicly accessible via URL for Google Play. Options:

1. Enable GitHub Pages on this repo and link to `https://<username>.github.io/AccountingV2/privacy-policy`
2. Or paste the content into a free static host (e.g., Notion public page, GitHub Gist).

In the Google Play Console → App content → Privacy policy, paste the URL.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/cd.yml docs/privacy-policy.md
git commit -m "feat(store): promote Play Store status draft→completed; add privacy policy doc"
```

---

## Task 9: bmad back-fill — epics and stories

**Files:**

- Create: `_bmad-output/planning-artifacts/epics-and-stories/phase4-epics.md`

Context: The bmad workflow expects epic/story artifacts in `_bmad-output/planning-artifacts/epics-and-stories/`. Phase 4 has no back-fill yet.

- [ ] **Step 1: Create the epics and stories doc**

```markdown
# Phase 4 Epics & Stories — Ready for Public Beta

_Back-filled from superpowers plan `docs/superpowers/plans/2026-04-16-phase-4-ready-for-public-beta.md`_

## Epic P4-E1: Security hardening (allowBackup + SQLite)

**Goal:** Close the Android backup gap. Document SQLite residual risk.

| Story    | Title                               | Acceptance Criteria                              |
| -------- | ----------------------------------- | ------------------------------------------------ |
| P4-E1-S1 | Fix allowBackup in source manifest  | `android:allowBackup="false"` in built APK/AAB   |
| P4-E1-S2 | Document SQLite encryption decision | `docs/security-decisions.md` exists and reviewed |

## Epic P4-E2: Detox E2E gate

**Goal:** A green Detox test run blocks broken releases before they reach Play Store.

| Story    | Title                                   | Acceptance Criteria                                                    |
| -------- | --------------------------------------- | ---------------------------------------------------------------------- |
| P4-E2-S1 | Install Detox + wire debug build        | `detox build --configuration android.emu.debug` succeeds locally       |
| P4-E2-S2 | Add testIDs to login + envelope screens | `by.id('login-email')`, `by.id('envelope-save')` etc. resolve in Detox |
| P4-E2-S3 | Unblock all three journey files         | No BLOCKED comments; `detox test` runs 3 suites                        |
| P4-E2-S4 | CI gate: remove continue-on-error       | `e2e-android` CI job is a hard gate on master commits                  |

## Epic P4-E3: CD hardening

**Goal:** Every master build is smoke-tested on a real device before reaching users.

| Story    | Title                                   | Acceptance Criteria                                  |
| -------- | --------------------------------------- | ---------------------------------------------------- |
| P4-E3-S1 | Crashlytics upload works without bypass | `continue-on-error` removed; upload succeeds in CD   |
| P4-E3-S2 | Firebase Test Lab Robo smoke            | CD step passes; no launch crashes in Test Lab report |

## Epic P4-E4: Public beta readiness

**Goal:** External testers can find, install, and provide signal.

| Story    | Title                                  | Acceptance Criteria                                            |
| -------- | -------------------------------------- | -------------------------------------------------------------- |
| P4-E4-S1 | Promote Play Store status to completed | Each master build is available to internal testers immediately |
| P4-E4-S2 | Privacy policy live at public URL      | Google Play Console accepts the URL                            |
| P4-E4-S3 | ≥ 5 real testers on internal track     | Confirmed via Play Console tester list                         |
| P4-E4-S4 | 7-day crash-free session for 1 tester  | Firebase Crashlytics dashboard shows 0 crashes in first week   |
```

- [ ] **Step 2: Commit**

```bash
git add _bmad-output/planning-artifacts/epics-and-stories/phase4-epics.md
git commit -m "docs(bmad): back-fill Phase 4 epics and stories"
```

---

## Self-Review

### Spec coverage

| Phase 4 roadmap item                                                             | Covered by       |
| -------------------------------------------------------------------------------- | ---------------- |
| Un-skip one Detox E2E journey (login → add envelope → log transaction)           | Tasks 2, 3, 4, 5 |
| Working `.detoxrc.js` build script                                               | Task 2           |
| Remove `continue-on-error` from e2e-android CI job                               | Task 5           |
| Encrypted SQLite via `op-sqlite` OR document residual risk + `allowBackup=false` | Task 1           |
| Play Store track: draft → internal with real testers                             | Task 8           |
| Firebase Test Lab smoke run on each CD build                                     | Task 7           |
| `bmad-create-epics-and-stories` back-fill                                        | Task 9           |
| CD Crashlytics mapping upload: remove `continue-on-error`                        | Task 6           |
| Privacy-policy wording matches shipped behaviour                                 | Task 8           |

All roadmap items are covered.

### Placeholder scan

- No "TBD" or "TODO" in code blocks.
- Task 6 Step 2 requires manual verification of the Crashlytics gradle task locally — this is intentional (the task cannot know whether `FIREBASE_SERVICE_ACCOUNT_JSON` is configured as a GitHub secret).
- Task 7 Step 2 requires creating GitHub secrets manually — this is intentional (Claude Code cannot create repo secrets).

### Type consistency

- `detox` import: `{ device, element, by, expect as detoxExpect }` — consistent across all three journey files.
- testIDs used in journey files (`login-email`, `login-password`, `login-submit`, `login-signup-link`, `signup-email`, `add-transaction-fab`, `envelope-name`, `envelope-amount`, `envelope-save`, `offline-banner`, `dashboard-empty-state`) — all either exist in the codebase or are added in Task 3.
- `.detoxrc.js` configuration name `android.emu.debug` — used consistently in Task 2 (`.detoxrc.js`), Task 5 (CI `detox build`/`detox test` commands).

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-16-phase-4-ready-for-public-beta.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, spec + quality review after each, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
