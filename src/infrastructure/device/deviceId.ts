/**
 * deviceId — app-scoped random device identifier, persisted in local storage.
 *
 * This is NEVER a hardware identifier (e.g. IMEI, Android ID, IDFV) — those
 * are subject to platform privacy restrictions (Play data-safety disclosure
 * requirements) and can be reset/rotated outside the app's control. Instead
 * a random UUID (v4) is generated on first use and persisted, so the app
 * fully owns its lifecycle (spec §7.7).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

const DEVICE_ID_KEY = '@device_id';

/**
 * Returns this install's device id, generating and persisting one via
 * `expo-crypto`'s `randomUUID()` (a v4 UUID) on first call. Stable across
 * calls within the same app install.
 *
 * Uses `expo-crypto` rather than the `uuid` npm package: `uuid`'s v4
 * generator calls `crypto.getRandomValues()`, which does not exist on
 * native RN without the `react-native-get-random-values` polyfill and
 * throws at runtime when omitted. `expo-crypto` is already a project
 * dependency and needs no polyfill.
 */
export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const id = randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}
