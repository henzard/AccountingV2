import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISlipImageUploader } from '../../domain/ports/ISlipImageUploader';

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
