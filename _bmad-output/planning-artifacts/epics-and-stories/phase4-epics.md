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
