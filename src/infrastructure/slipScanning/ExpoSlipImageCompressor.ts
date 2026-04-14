import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ISlipImageCompressor } from '../../domain/ports/ISlipImageCompressor';

export class ExpoSlipImageCompressor implements ISlipImageCompressor {
  async compress(localUri: string): Promise<{ uri: string; base64: string }> {
    const result = await manipulateAsync(localUri, [{ resize: { width: 1600 } }], {
      compress: 0.8,
      format: SaveFormat.JPEG,
      base64: true,
    });
    return { uri: result.uri, base64: result.base64 ?? '' };
  }
}
