import { Linking } from 'react-native';

/**
 * Thin wrapper around React Native's `Linking` API.
 *
 * `react-native`'s index module defines most of its exports (Linking
 * included) as non-configurable getter-backed properties for lazy native
 * loading, which makes `Linking.addEventListener`/`getInitialURL` awkward to
 * mock directly in tests (a plain `jest.mock('react-native', ...)` override
 * either silently no-ops or throws while eagerly evaluating unrelated
 * native-only exports). Routing through this module — like the existing
 * `getDeviceId`/`networkObserver` infra wrappers — means App.tsx's
 * deep-link handling can be unit-tested by mocking this file directly
 * instead of fighting react-native's module internals.
 */
export function addUrlListener(handler: (event: { url: string }) => void): { remove: () => void } {
  return Linking.addEventListener('url', handler);
}

export function getInitialURL(): Promise<string | null> {
  return Linking.getInitialURL();
}
