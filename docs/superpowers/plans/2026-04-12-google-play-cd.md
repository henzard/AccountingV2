# Google Play CD Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically build a signed release AAB and upload it to Google Play Internal Testing on every push to master.

**Architecture:** Two files change. `android/app/build.gradle` gains a `release` signingConfig that reads the keystore path and credentials from environment variables, plus a dynamic `versionCode` driven by a Gradle property. A new `.github/workflows/cd.yml` workflow runs the existing CI checks as a gate, then decodes the keystore secret, builds the signed AAB with Gradle, and uploads it to the Internal Testing track using `r0adkll/upload-google-play@v1`.

**Tech Stack:** GitHub Actions, Gradle (Groovy DSL), `r0adkll/upload-google-play@v1`, 5 GitHub Secrets already set (KEYSTORE_BASE64, KEYSTORE_STORE_PASSWORD, KEYSTORE_KEY_ALIAS, KEYSTORE_KEY_PASSWORD, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)

---

## File Map

| File | Change |
|------|--------|
| `android/app/build.gradle` | Add release signingConfig + dynamic versionCode |
| `.github/workflows/cd.yml` | New CD workflow |

---

### Task 1: Release signing config and dynamic versionCode

**Files:**
- Modify: `android/app/build.gradle` (lines 91–123)

The current file uses `signingConfig signingConfigs.debug` for the release build type — a placeholder. Replace it with a proper release config that reads credentials from env vars (safe for local dev too, it falls back to the debug keystore when env vars are absent).

- [ ] **Step 1: Open `android/app/build.gradle`** and locate the `android { ... }` block (lines 84–133).

- [ ] **Step 2: Replace `versionCode 1` with a dynamic value**

Find (line 95):
```groovy
        versionCode 1
```

Replace with:
```groovy
        versionCode (findProperty('versionCode') ?: '1').toInteger()
```

`findProperty` reads a Gradle project property, which the CD workflow will pass as `-PversionCode=${{ github.run_number }}`. Locally, with no property set, it falls back to `1`.

- [ ] **Step 3: Add the `release` signing config**

Find the `signingConfigs` block (lines 100–107):
```groovy
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
```

Replace with:
```groovy
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file(System.getenv("KEYSTORE_PATH") ?: "debug.keystore")
            storePassword System.getenv("KEYSTORE_STORE_PASSWORD") ?: 'android'
            keyAlias System.getenv("KEYSTORE_KEY_ALIAS") ?: 'androiddebugkey'
            keyPassword System.getenv("KEYSTORE_KEY_PASSWORD") ?: 'android'
        }
    }
```

`file()` in `build.gradle` resolves relative to the module directory (`android/app/`). In CI, `KEYSTORE_PATH` will be `release.keystore` (decoded into `android/app/release.keystore`). Locally, when those env vars are absent, the block falls back to the debug keystore so `./gradlew assembleDebug` still works.

- [ ] **Step 4: Point the release build type at the release signing config**

Find (lines 112–122):
```groovy
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
```

Replace only `signingConfig signingConfigs.debug` with `signingConfig signingConfigs.release`:
```groovy
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.release
```

- [ ] **Step 5: Verify the file compiles**

Run from `android/`:
```bash
./gradlew tasks --quiet
```

Expected: Gradle prints the task list without errors. If it fails with a syntax error, re-check the `signingConfigs` block for mismatched braces.

- [ ] **Step 6: Commit**

```bash
git add android/app/build.gradle
git commit -m "feat(android): release signing config + dynamic versionCode"
```

---

### Task 2: Create the CD workflow

**Files:**
- Create: `.github/workflows/cd.yml`

The workflow has two jobs. `ci-gate` is the exact same checks as `ci.yml` — this ensures no broken code reaches the Play Store even if someone bypasses a PR. `build-and-publish` depends on `ci-gate` and only runs on master.

- [ ] **Step 1: Create `.github/workflows/cd.yml`** with the following content:

```yaml
name: CD — Google Play Internal Testing

on:
  push:
    branches: [master]

jobs:
  ci-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: TypeScript check
        run: npx tsc --noEmit

      - name: ESLint
        run: npx eslint src/ --ext .ts,.tsx --max-warnings 0

      - name: Jest
        run: npx jest --coverage --coverageThreshold='{"global":{"lines":80}}'

  build-and-publish:
    needs: ci-gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install JS dependencies
        run: npm ci

      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Decode keystore
        run: |
          echo "${{ secrets.KEYSTORE_BASE64 }}" | base64 --decode > android/app/release.keystore

      - name: Build release AAB
        working-directory: android
        run: ./gradlew bundleRelease -PversionCode=${{ github.run_number }} --no-daemon
        env:
          KEYSTORE_PATH: release.keystore
          KEYSTORE_STORE_PASSWORD: ${{ secrets.KEYSTORE_STORE_PASSWORD }}
          KEYSTORE_KEY_ALIAS: ${{ secrets.KEYSTORE_KEY_ALIAS }}
          KEYSTORE_KEY_PASSWORD: ${{ secrets.KEYSTORE_KEY_PASSWORD }}

      - name: Upload to Play Store — Internal Testing
        uses: r0adkll/upload-google-play@v1
        with:
          serviceAccountJsonPlainText: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}
          packageName: com.henza.accountingv2
          releaseFiles: android/app/build/outputs/bundle/release/*.aab
          track: internal
          status: completed
          inAppUpdatePriority: 2
```

- [ ] **Step 2: Verify YAML syntax**

Run from the repo root:
```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/cd.yml','utf8')); console.log('YAML OK')"
```

Expected output: `YAML OK`. If `js-yaml` is not available, install it first: `npm install --no-save js-yaml`.

- [ ] **Step 3: Commit and push to master**

```bash
git add .github/workflows/cd.yml
git commit -m "feat(ci): CD workflow — build release AAB and publish to Play Store internal track"
git push origin master
```

- [ ] **Step 4: Watch the workflow run**

Open GitHub Actions in the browser:
```
https://github.com/henzard/AccountingV2/actions
```

The `CD — Google Play Internal Testing` workflow should appear. Monitor both jobs:
- `ci-gate`: TypeScript + ESLint + Jest (~2 min)
- `build-and-publish`: Gradle build (~8–12 min) + upload

Expected final status: both jobs green.

- [ ] **Step 5: Verify the release appears in Play Console**

Open:
```
https://play.google.com/console/u/0/developers/9165168680274460589/app/4976076933721557898/tracks/internal
```

A new release with `versionCode = <github.run_number>` should appear. Status will be `In review` briefly, then `Available to testers`.

**Note:** To actually install the app, add your Google account as a tester under Testing → Internal Testing → Testers in Play Console before the release is promoted.
