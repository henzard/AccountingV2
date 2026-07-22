import type { SupportedStorage } from '@supabase/supabase-js';

/**
 * Web variant of SecureStorageAdapter (Metro resolves `.web.ts` first on the
 * web platform). `expo-secure-store` has no web implementation — the native
 * Keychain/Keystore it wraps does not exist in a browser — so the Supabase
 * auth session is persisted in `localStorage` instead.
 *
 * This is intentionally less "secure" than the native Keychain: browser web
 * storage is the standard place web apps keep their Supabase session, and it
 * is origin-isolated, but it is readable by any script running on the origin.
 * That trade-off is inherent to running a web build; native builds keep using
 * the SecureStore-backed adapter unchanged.
 *
 * Guards against `localStorage` being unavailable (SSR / privacy modes) by
 * falling back to an in-memory map so auth still functions for the session.
 */
const memory = new Map<string, string>();

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

export const SecureStorageAdapter: SupportedStorage = {
  getItem: (key: string): Promise<string | null> =>
    Promise.resolve(
      hasLocalStorage() ? window.localStorage.getItem(key) : (memory.get(key) ?? null),
    ),
  setItem: (key: string, value: string): Promise<void> => {
    if (hasLocalStorage()) {
      window.localStorage.setItem(key, value);
    } else {
      memory.set(key, value);
    }
    return Promise.resolve();
  },
  removeItem: (key: string): Promise<void> => {
    if (hasLocalStorage()) {
      window.localStorage.removeItem(key);
    } else {
      memory.delete(key);
    }
    return Promise.resolve();
  },
};
