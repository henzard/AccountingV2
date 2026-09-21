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

# ---------------------------------------------------------------------------
# Crawl phase — a random-tap "robot" over the RELEASE build.
#
# This replaces the Firebase Test Lab Robo step, which never once ran: on a
# project without billing, Test Lab can only write results to a Google-managed
# bucket that needs the project-wide Editor role on the CI service account.
# The emulator here already has the minified release APK installed, so
# Android's own `monkey` gives the same kind of signal (does random poking
# crash the release build?) with no cloud permissions at all.
#
#  - Fixed seed: the same app gets the same event stream, so a failure is
#    reproducible (`adb shell monkey -s <seed> ...`) rather than flaky.
#  - Confined to our package, with system keys / app switches disabled so it
#    cannot wander into Settings or the notification shade.
#  - Judged on HARD crash signatures only (Java crash, native signal, ANR for
#    our package). `E ReactNativeJS` is deliberately NOT a failure here: random
#    taps against the dummy backend legitimately produce handled-error logs.
# CRAWL_EVENTS=0 skips the phase.
# ---------------------------------------------------------------------------
CRAWL_EVENTS="${CRAWL_EVENTS:-1500}"
CRAWL_SEED="${CRAWL_SEED:-20260921}"
CRAWL_LOG="${CRAWL_LOG:-monkey-release-smoke.txt}"
CRAWL_HARD_PATTERN='FATAL EXCEPTION|Fatal signal|libc\+\+abi: terminating|ANR in '

if [ "$CRAWL_EVENTS" -gt 0 ]; then
  echo "release-smoke: crawl - $CRAWL_EVENTS random events, seed $CRAWL_SEED"
  adb logcat -c
  set +e
  adb shell monkey -p "$PACKAGE" -s "$CRAWL_SEED" --throttle 150     --pct-syskeys 0 --pct-appswitch 0 --pct-anyevent 0     --ignore-security-exceptions -v "$CRAWL_EVENTS" >"$CRAWL_LOG" 2>&1
  MONKEY_EXIT=$?
  set -e
  {
    echo "===== crawl phase logcat (seed $CRAWL_SEED, $CRAWL_EVENTS events) ====="
    adb logcat -d
  } >>"$LOGCAT_FILE"

  CRAWL_FAILED=0
  # monkey itself reports an app crash / ANR it provoked, naming the package.
  if grep -E '// CRASH: |// NOT RESPONDING: ' "$CRAWL_LOG" | grep -qF "$PACKAGE"; then
    echo "release-smoke: FAIL - monkey reported a crash/ANR in $PACKAGE:"
    grep -E -A12 '// CRASH: |// NOT RESPONDING: ' "$CRAWL_LOG" | head -60
    CRAWL_FAILED=1
  fi
  # ... and so does logcat, for crashes monkey does not attribute.
  CRAWL_LINES=$(sed -n '/===== crawl phase logcat/,$p' "$LOGCAT_FILE" |
    grep -nE "$CRAWL_HARD_PATTERN" | cut -d: -f1 || true)
  if [ -n "$CRAWL_LINES" ]; then
    CRAWL_SECTION=$(sed -n '/===== crawl phase logcat/,$p' "$LOGCAT_FILE")
    for LINE_NO in $CRAWL_LINES; do
      START=$((LINE_NO - CONTEXT_LINES))
      [ "$START" -lt 1 ] && START=1
      END=$((LINE_NO + CONTEXT_LINES))
      WINDOW=$(printf '%s
' "$CRAWL_SECTION" | sed -n "${START},${END}p")
      if printf '%s
' "$WINDOW" | grep -qF "$PACKAGE"; then
        echo "release-smoke: FAIL - crash signature during crawl (seed $CRAWL_SEED) matches $PACKAGE"
        echo "----- logcat context -----"
        printf '%s
' "$WINDOW"
        echo "----- end context -----"
        CRAWL_FAILED=1
      fi
    done
  fi
  # A crawl that did not actually run must not pass: that is precisely the
  # "green but never ran" failure this phase replaced. monkey must exit 0 AND
  # report having injected every requested event.
  if [ "$MONKEY_EXIT" -ne 0 ]; then
    echo "release-smoke: FAIL - monkey exited $MONKEY_EXIT before completing the crawl"
    tail -25 "$CRAWL_LOG"
    CRAWL_FAILED=1
  fi
  INJECTED=$(grep -oE 'Events injected: [0-9]+' "$CRAWL_LOG" | tail -1 | grep -oE '[0-9]+' || true)
  if [ "${INJECTED:-0}" -ne "$CRAWL_EVENTS" ]; then
    echo "release-smoke: FAIL - monkey injected ${INJECTED:-0} of $CRAWL_EVENTS events"
    tail -25 "$CRAWL_LOG"
    CRAWL_FAILED=1
  fi
  if [ "$CRAWL_FAILED" -ne 0 ]; then
    echo "release-smoke: reproduce with: adb shell monkey -p $PACKAGE -s $CRAWL_SEED --throttle 150 --pct-syskeys 0 --pct-appswitch 0 --pct-anyevent 0 -v $CRAWL_EVENTS"
    exit 1
  fi
  echo "release-smoke: crawl PASS - $INJECTED of $CRAWL_EVENTS events injected, no crash or ANR in $PACKAGE"
fi

echo "release-smoke: PASS - $PACKAGE launched and is still running after ${WAIT_SECONDS}s"
