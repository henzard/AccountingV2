#!/usr/bin/env bash
# Runs the Detox suite against an already-booted Android emulator, capturing
# logcat around the run so failures are diagnosable from the CI artifact
# instead of a bare "app has unexpectedly disconnected from Detox server".
#
# Extracted from cd.yml/ci.yml's e2e job `script:` blocks (deep-review OPS-1):
# reactivecircus/android-emulator-runner executes each `script:` line in its
# own `sh -c`, so a multi-line inline script cannot share shell state across
# lines — `DETOX_EXIT=$?` set on one line and `exit $DETOX_EXIT` read on a
# later line was a no-op (`exit` with no args = 0, i.e. always green), and
# `LOGCAT_PID=$!` was likewise lost, so the logcat dump was always empty.
# Running the whole thing as a single script file (one `script:` line calling
# this file) keeps it all in one shell.
#
# Follow-up (still deep-review OPS-1): the tag filter this script used to
# pass to `adb logcat` — `AndroidRuntime:E ReactNativeJS:V
# com.henza.accountingv2:V detox:V *:S` — produced an EMPTY file on every one
# of the 11/11 failing runs. `com.henza.accountingv2` is the app's package
# name, not a logcat TAG, so that clause matched nothing; combined with the
# trailing `*:S` (silence everything else), the filter suppressed the whole
# stream. The real root-cause hypothesis (see cd.yml's e2e-gate DECISION
# comment) is that CI was building+testing the `debug` variant, which has no
# embedded JS bundle and opens expo-dev-client's launcher instead of the app
# — so there may genuinely be very little app-side log output, which is
# exactly why we now capture everything instead of pre-filtering.
#
# Usage: run-detox.sh <detox-configuration> [logcat-output-path]
set -uo pipefail

CONFIGURATION="${1:?usage: run-detox.sh <detox-configuration> [logcat-output-path]}"
LOGCAT_FILE="${2:-/tmp/logcat.txt}"
PACKAGE_NAME="com.henza.accountingv2"

adb shell input keyevent 82
adb logcat -c
# Unfiltered, threadtime-formatted logcat straight to the artifact file. No
# tag/level filter: the failure mode under investigation is "the app never
# starts", so filtering by app-side tags is exactly what could hide the
# evidence (as it did above).
adb logcat -v threadtime >"$LOGCAT_FILE" 2>&1 &
LOGCAT_PID=$!

detox test --configuration "$CONFIGURATION" --headless --loglevel info 2>&1
DETOX_EXIT=$?

# Give logcat a moment to flush the final lines (e.g. a crash at the very end
# of the run) before killing it.
sleep 2
kill "$LOGCAT_PID" 2>/dev/null || true
wait "$LOGCAT_PID" 2>/dev/null || true

if [ "$DETOX_EXIT" -ne 0 ]; then
  echo "===== LOGCAT (last 400 lines for our process + crash signatures) ====="
  PID="$(adb shell pidof "$PACKAGE_NAME" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
  if [ -n "${PID:-}" ]; then
    grep -E " ${PID} | FATAL|AndroidRuntime|ReactNativeJS|DetoxManager|Detox" "$LOGCAT_FILE" | tail -n 400 || true
  else
    grep -E "${PACKAGE_NAME}|FATAL|AndroidRuntime|ReactNativeJS|DetoxManager|Detox" "$LOGCAT_FILE" | tail -n 400 || true
  fi
  echo "===== END LOGCAT EXCERPT (full log uploaded as an artifact) ====="
fi

exit "$DETOX_EXIT"
