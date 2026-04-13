import { UploadSlipImagesUseCase } from '../UploadSlipImagesUseCase';

describe('UploadSlipImagesUseCase', () => {
  it('compresses + uploads frames in parallel', async () => {
    const compressor = {
      compress: jest.fn().mockImplementation(async (uri) => ({ uri: `${uri}.jpg`, base64: 'b64' })),
    };
    const uploader = {
      upload: jest.fn().mockImplementation(async ({ frameIndex }) => `path/${frameIndex}`),
    };
    const repo = { update: jest.fn().mockResolvedValue(undefined) };

    const useCase = new UploadSlipImagesUseCase(compressor as any, uploader as any, repo as any);
    const result = await useCase.execute({
      slipId: 's1',
      householdId: 'h1',
      frameLocalUris: ['a', 'b'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.remotePaths).toEqual(['path/0', 'path/1']);
    expect(result.data.framesBase64).toEqual(['b64', 'b64']);
    expect(repo.update).toHaveBeenCalledWith('s1', { imageUris: ['path/0', 'path/1'] });
  });

  it('returns failure when upload fails', async () => {
    const compressor = { compress: jest.fn().mockResolvedValue({ uri: 'x', base64: 'b' }) };
    const uploader = { upload: jest.fn().mockRejectedValue(new Error('network')) };
    const repo = { update: jest.fn() };

    const useCase = new UploadSlipImagesUseCase(compressor as any, uploader as any, repo as any);
    const result = await useCase.execute({
      slipId: 's1',
      householdId: 'h1',
      frameLocalUris: ['a'],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('UPLOAD_FAILED');
  });
});
