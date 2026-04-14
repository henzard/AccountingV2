import * as LegacyFS from 'expo-file-system/legacy';

export type FSAdapter = {
  documentDirectory: string | null;
  makeDirectoryAsync(dir: string, opts: { intermediates: boolean }): Promise<void>;
  writeAsStringAsync(uri: string, data: string, opts: { encoding: string }): Promise<void>;
  deleteAsync(uri: string, opts: { idempotent: boolean }): Promise<void>;
  EncodingType: { Base64: string };
};

export class SlipImageLocalStore {
  private readonly fs: FSAdapter;

  constructor(fs?: FSAdapter) {
    this.fs = fs ?? (LegacyFS as unknown as FSAdapter);
  }

  private get base(): string {
    return `${this.fs.documentDirectory ?? ''}slips/`;
  }

  async save(slipId: string, frameIndex: number, base64: string): Promise<string> {
    const dir = `${this.base}${slipId}`;
    await this.fs.makeDirectoryAsync(dir, { intermediates: true });
    const uri = `${dir}/${frameIndex}.jpg`;
    await this.fs.writeAsStringAsync(uri, base64, { encoding: this.fs.EncodingType.Base64 });
    return uri;
  }

  async delete(slipId: string): Promise<void> {
    await this.fs.deleteAsync(`${this.base}${slipId}`, { idempotent: true });
  }
}
