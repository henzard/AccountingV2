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
import { v4 as uuidv4 } from 'uuid';

const DEVICE_ID_KEY = '@device_id';

/**
 * Returns this install's device id, generating and persisting one via
 * uuid v4 on first call. Stable across calls within the same app install.
 */
export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const id = uuidv4();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}
