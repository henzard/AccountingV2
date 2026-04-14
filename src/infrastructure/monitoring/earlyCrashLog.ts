/**
 * earlyCrashLog.ts
 *
 * Pre-Crashlytics crash capture for JS-land errors that occur before Firebase
 * initialises. Must be called synchronously at the very top of App.tsx before
 * any other imports run side-effects.
 *
 * Storage key: @crash:last
 * Shape: { timestamp, step, message, stack }
 *
 * Design constraints:
 *  - Synchronous install (no await at call site).
 *  - AsyncStorage writes are fire-and-forget; we cannot await them in a crash
 *    handler so we accept the tiny risk of the write racing the SIGABRT.
 *  - Idempotent: calling installEarlyCrashHandler() more than once is safe.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Public types ────────────────────────────────────────────────────────────

export interface CrashRecord {
  timestamp: string; // ISO-8601
  step: string; // caller-provided label, e.g. 'App.tsx init'
  message: string;
  stack: string;
}

// ─── Internal state ──────────────────────────────────────────────────────────

export const CRASH_KEY = '@crash:last';
let _installed = false;
let _previousGlobalHandler: ((error: Error, isFatal?: boolean) => void) | null = null;

// ─── Storage helpers ─────────────────────────────────────────────────────────

/**
 * Synchronously kicks off an AsyncStorage write. Fire-and-forget — the crash
 * handler cannot await because the JS thread may die immediately after.
 */
function persistRecord(record: CrashRecord): void {
  // We deliberately do NOT await. The OS typically lets AsyncStorage flush
  // before the process dies on a JS-originated crash.
  AsyncStorage.setItem(CRASH_KEY, JSON.stringify(record)).catch(() => {
    // Nothing we can do if storage itself is broken this early.
  });
}

function buildRecord(step: string, err: unknown): CrashRecord {
  const error = err instanceof Error ? err : new Error(String(err));
  return {
    timestamp: new Date().toISOString(),
    step,
    message: error.message,
    stack: error.stack ?? '(no stack)',
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Manually record a boot-phase error. Use inside try-catch blocks that wrap
 * dangerous synchronous operations (e.g. the App.tsx import chain).
 *
 * This does NOT suppress the error — re-throw after calling this so the
 * normal crash path still runs.
 */
export function captureBoot(step: string, err: unknown): void {
  persistRecord(buildRecord(step, err));
}

/**
 * Read the most recently stored crash record. Returns null if none exists or
 * if parsing fails. Safe to call at any point after cold start.
 */
export async function readLastCrash(): Promise<CrashRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(CRASH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CrashRecord;
  } catch {
    return null;
  }
}

/**
 * Delete the stored crash record (e.g. after the user dismisses the viewer).
 */
export async function clearLastCrash(): Promise<void> {
  await AsyncStorage.removeItem(CRASH_KEY);
}

/**
 * Wire up global JS error handlers. Idempotent — safe to call multiple times.
 *
 * Captures:
 *  1. Synchronous JS errors via ErrorUtils.setGlobalHandler
 *  2. Unhandled promise rejections via the global `unhandledrejection` event
 *     (Hermes / JSC surfaces this through the global event emitter)
 *
 * IMPORTANT: Call this synchronously at the very top of App.tsx BEFORE any
 * other import that might throw.
 */
export function installEarlyCrashHandler(): void {
  if (_installed) return;
  _installed = true;

  // ── 1. Synchronous / render errors via ErrorUtils ─────────────────────────
  // ErrorUtils is a React Native global — always present on Hermes and JSC.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const EU = (global as any).ErrorUtils as
    | {
        setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
        getGlobalHandler: () => (error: Error, isFatal?: boolean) => void;
      }
    | undefined;

  if (EU) {
    _previousGlobalHandler = EU.getGlobalHandler();

    EU.setGlobalHandler((error: Error, isFatal?: boolean) => {
      persistRecord(buildRecord(isFatal ? 'fatal (ErrorUtils)' : 'non-fatal (ErrorUtils)', error));

      // Always call the previous handler so React Native's own red-screen /
      // crash logic continues to fire.
      if (_previousGlobalHandler) {
        _previousGlobalHandler(error, isFatal);
      }
    });
  }

  // ── 2. Unhandled promise rejections ───────────────────────────────────────
  // Hermes exposes this as a global event; Metro/RN polyfills it for JSC.
  // The `reason` field is the rejection value (often an Error).
  const g = global as unknown as {
    addEventListener?: (type: string, handler: (evt: { reason?: unknown }) => void) => void;
  };

  if (typeof g.addEventListener === 'function') {
    g.addEventListener('unhandledrejection', (event: { reason?: unknown }) => {
      persistRecord(
        buildRecord('unhandledrejection', event.reason ?? new Error('Unknown rejection')),
      );
      // Do not suppress — default behaviour (console warn / debugger) continues.
    });
  }
}
