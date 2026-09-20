#!/usr/bin/env bash
# Release-launch smoke gate (deep-review OPS-2).
#
# Installs the MINIFIED release APK on an already-booted emulator, launches
# it, and fails the job if the process crashes or never starts. This is the
# check that would have caught 1.1.127: R8 optimisation broke
# expo-modules-core's Record conversion (openDatabaseSync's options argument),
# aborting the process on every launch, and no CI/CD job had ever installed
# or launched a minified release build — the Detox gate only ever exercises
# the debug build. See android/app/proguard-rules.pro for the fix.
#
# Usage: release-smoke.sh <path-to-release-apk>
set -euo pipefail

APK_PATH="${1:?usage: release-smoke.sh <path-to-release-apk>}"
PACKAGE="com.henza.accountingv2"
LOGCAT_FILE="${LOGCAT_FILE:-logcat-release-smoke.txt}"
WAIT_SECONDS="${WAIT_SECONDS:-30}"
CONTEXT_LINES=40
# Signatures we never expect to see from a clean launch.
CRASH_PATTERN='FATAL EXCEPTION|Fatal signal|E ReactNativeJS|libc\+\+abi: terminating'

echo "release-smoke: installing $APK_PATH"
adb install -r "$APK_PATH"

adb logcat -c

echo "release-smoke: launching $PACKAGE"
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1

echo "release-smoke: waiting ${WAIT_SECONDS}s to observe steady-state"
sleep "$WAIT_SECONDS"

adb logcat -d >"$LOGCAT_FILE"

FAILED=0

# logcat -d dumps the whole device buffer, which can include unrelated
# system/process noise, so only treat a crash signature as ours if the
# package name actually appears in the surrounding lines.
MATCH_LINES=$(grep -nE "$CRASH_PATTERN" "$LOGCAT_FILE" | cut -d: -f1 || true)
if [ -n "$MATCH_LINES" ]; then
  TOTAL_LINES=$(wc -l <"$LOGCAT_FILE")
  for LINE_NO in $MATCH_LINES; do
    START=$((LINE_NO - CONTEXT_LINES))
    [ "$START" -lt 1 ] && START=1
    END=$((LINE_NO + CONTEXT_LINES))
    [ "$END" -gt "$TOTAL_LINES" ] && END=$TOTAL_LINES
    WINDOW=$(sed -n "${START},${END}p" "$LOGCAT_FILE")
    # ReactNativeJS / libc++abi lines never carry the package name, and ours is
    # the only React Native app on the emulator, so those are always ours.
    if sed -n "${LINE_NO}p" "$LOGCAT_FILE" | grep -qE 'E ReactNativeJS|libc\+\+abi: terminating' ||
      printf '%s\n' "$WINDOW" | grep -qF "$PACKAGE"; then
      echo "release-smoke: FAIL - crash signature at logcat line $LINE_NO matches $PACKAGE"
      echo "----- logcat context (lines $START-$END) -----"
      printf '%s\n' "$WINDOW"
      echo "----- end context -----"
      FAILED=1
    fi
  done
fi

PIDOF_OUTPUT=$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)
if [ -z "$PIDOF_OUTPUT" ]; then
  echo "release-smoke: FAIL - $PACKAGE has no running process (pidof empty) after ${WAIT_SECONDS}s"
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "release-smoke: PASS - $PACKAGE launched and is still running after ${WAIT_SECONDS}s"
