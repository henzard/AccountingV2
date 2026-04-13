export interface ISlipImageCompressor {
  compress(localUri: string): Promise<{ uri: string; base64: string }>;
}
