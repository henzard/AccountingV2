import { SupabaseSlipImageUploader } from '../SupabaseSlipImageUploader';

describe('SupabaseSlipImageUploader', () => {
  it('uploads to slip-images/<household>/<slip>/<index>.jpg', async () => {
    const uploadFn = jest.fn().mockResolvedValue({ data: { path: 'h1/s1/0.jpg' }, error: null });
    const supabase = { storage: { from: jest.fn().mockReturnValue({ upload: uploadFn }) } } as any;
    const uploader = new SupabaseSlipImageUploader(supabase);
    const path = await uploader.upload({
      householdId: 'h1',
      slipId: 's1',
      frameIndex: 0,
      base64: 'dGVzdA==',
    });

    expect(supabase.storage.from).toHaveBeenCalledWith('slip-images');
    expect(uploadFn).toHaveBeenCalledWith(
      'h1/s1/0.jpg',
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: 'image/jpeg' }),
    );
    expect(path).toBe('h1/s1/0.jpg');
  });

  it('throws on upload error', async () => {
    const uploadFn = jest
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'storage fail' } });
    const supabase = { storage: { from: jest.fn().mockReturnValue({ upload: uploadFn }) } } as any;
    const uploader = new SupabaseSlipImageUploader(supabase);
    await expect(
      uploader.upload({ householdId: 'h1', slipId: 's1', frameIndex: 0, base64: 'dGVzdA==' }),
    ).rejects.toMatchObject({ message: 'storage fail' });
  });
});
