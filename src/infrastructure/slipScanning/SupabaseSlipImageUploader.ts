import type { SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import type { ISlipImageUploader } from '../../domain/ports/ISlipImageUploader';

const WIFI_ONLY_KEY = '@settings:slip_wifi_only';

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class SupabaseSlipImageUploader implements ISlipImageUploader {
  constructor(private readonly supabase: SupabaseClient) {}

  async upload({
    householdId,
    slipId,
    frameIndex,
    base64,
  }: {
    householdId: string;
    slipId: string;
    frameIndex: number;
    base64: string;
  }): Promise<string> {
    const wifiOnly = (await AsyncStorage.getItem(WIFI_ONLY_KEY)) === 'true';
    if (wifiOnly) {
      const state = await NetInfo.fetch();
      if (state.type !== 'wifi') {
        throw {
          code: 'SLIP_WIFI_REQUIRED',
          message: 'WiFi-only mode is on; connect to WiFi or disable the setting.',
        };
      }
    }

    const path = `${householdId}/${slipId}/${frameIndex}.jpg`;
    const bytes = base64ToBytes(base64);
    const { error } = await this.supabase.storage.from('slip-images').upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) throw error;
    return path;
  }
}
