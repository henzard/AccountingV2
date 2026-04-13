import { ExpoSlipImageCompressor } from '../ExpoSlipImageCompressor';
import { manipulateAsync } from 'expo-image-manipulator';

describe('ExpoSlipImageCompressor', () => {
  it('compresses to JPEG q80 + max-edge 1600', async () => {
    const compressor = new ExpoSlipImageCompressor();
    const result = await compressor.compress('file:///input.jpg');
    expect(manipulateAsync).toHaveBeenCalledWith(
      'file:///input.jpg',
      [{ resize: { width: 1600 } }],
      expect.objectContaining({ compress: 0.8, base64: true }),
    );
    expect(result.uri).toBe('file:///compressed.jpg');
    expect(result.base64).toBe('dGVzdC1iYXNlNjQ=');
  });
});
