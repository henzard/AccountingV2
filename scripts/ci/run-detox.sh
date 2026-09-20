#!/usr/bin/env bash
# Runs the Detox suite against an already-booted Android emulator, capturing
# logcat for the app/RN/Detox processes around the run so failures are
# diagnosable from the CI artifact instead of a bare "app has unexpectedly
# disconnected from Detox server".
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
# Usage: run-detox.sh <detox-configuration> [logcat-output-path]
set -uo pipefail

CONFIGURATION="${1:?usage: run-detox.sh <detox-configuration> [logcat-output-path]}"
LOGCAT_FILE="${2:-/tmp/logcat.txt}"

adb shell input keyevent 82
adb logcat -c
adb logcat AndroidRuntime:E ReactNativeJS:V com.henza.accountingv2:V detox:V *:S >>"$LOGCAT_FILE" 2>&1 &
LOGCAT_PID=$!

detox test --configuration "$CONFIGURATION" --headless --loglevel info 2>&1
DETOX_EXIT=$?

kill "$LOGCAT_PID" 2>/dev/null || true

echo "===== LOGCAT ====="
cat "$LOGCAT_FILE" || true
echo "===== END LOGCAT ====="

exit "$DETOX_EXIT"
