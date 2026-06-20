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

  it('returns failure with error message when compressor fails', async () => {
    const compressor = {
      compress: jest.fn().mockRejectedValue(new Error('corrupt image file')),
    };
    const uploader = { upload: jest.fn() };
    const repo = { update: jest.fn() };

    const useCase = new UploadSlipImagesUseCase(compressor as any, uploader as any, repo as any);
    const result = await useCase.execute({
      slipId: 's1',
      householdId: 'h1',
      frameLocalUris: ['bad-image.png'],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('UPLOAD_FAILED');
    expect(result.error.message).toBe('corrupt image file');
    expect(uploader.upload).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('returns failure with stringified message when error is not an Error instance', async () => {
    const compressor = {
      compress: jest.fn().mockRejectedValue('string-error'),
    };
    const uploader = { upload: jest.fn() };
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
    expect(result.error.message).toBe('string-error');
  });

  it('returns failure when repo.update throws', async () => {
    const compressor = {
      compress: jest.fn().mockResolvedValue({ uri: 'x', base64: 'b' }),
    };
    const uploader = {
      upload: jest.fn().mockResolvedValue('path/0'),
    };
    const repo = {
      update: jest.fn().mockRejectedValue(new Error('DB write failed')),
    };

    const useCase = new UploadSlipImagesUseCase(compressor as any, uploader as any, repo as any);
    const result = await useCase.execute({
      slipId: 's1',
      householdId: 'h1',
      frameLocalUris: ['a'],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('UPLOAD_FAILED');
    expect(result.error.message).toBe('DB write failed');
  });

  it('handles single frame correctly', async () => {
    const compressor = {
      compress: jest.fn().mockResolvedValue({ uri: 'out.jpg', base64: 'single-b64' }),
    };
    const uploader = {
      upload: jest.fn().mockResolvedValue('remote/0'),
    };
    const repo = { update: jest.fn().mockResolvedValue(undefined) };

    const useCase = new UploadSlipImagesUseCase(compressor as any, uploader as any, repo as any);
    const result = await useCase.execute({
      slipId: 's1',
      householdId: 'h1',
      frameLocalUris: ['one-frame'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.remotePaths).toEqual(['remote/0']);
    expect(result.data.framesBase64).toEqual(['single-b64']);
    expect(uploader.upload).toHaveBeenCalledWith({
      householdId: 'h1',
      slipId: 's1',
      frameIndex: 0,
      base64: 'single-b64',
    });
  });

  it('passes correct frameIndex to uploader for each frame', async () => {
    const compressor = {
      compress: jest.fn().mockResolvedValue({ uri: 'out.jpg', base64: 'b' }),
    };
    const uploader = {
      upload: jest.fn().mockImplementation(async ({ frameIndex }) => `p/${frameIndex}`),
    };
    const repo = { update: jest.fn().mockResolvedValue(undefined) };

    const useCase = new UploadSlipImagesUseCase(compressor as any, uploader as any, repo as any);
    await useCase.execute({
      slipId: 's1',
      householdId: 'h1',
      frameLocalUris: ['a', 'b', 'c'],
    });

    expect(uploader.upload).toHaveBeenCalledTimes(3);
    expect(uploader.upload).toHaveBeenCalledWith(expect.objectContaining({ frameIndex: 0 }));
    expect(uploader.upload).toHaveBeenCalledWith(expect.objectContaining({ frameIndex: 1 }));
    expect(uploader.upload).toHaveBeenCalledWith(expect.objectContaining({ frameIndex: 2 }));
  });

  it('returns success with empty arrays when frameLocalUris is empty', async () => {
    const compressor = { compress: jest.fn() };
    const uploader = { upload: jest.fn() };
    const repo = { update: jest.fn().mockResolvedValue(undefined) };

    const useCase = new UploadSlipImagesUseCase(compressor as any, uploader as any, repo as any);
    const result = await useCase.execute({
      slipId: 's1',
      householdId: 'h1',
      frameLocalUris: [],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.remotePaths).toEqual([]);
    expect(result.data.framesBase64).toEqual([]);
    expect(compressor.compress).not.toHaveBeenCalled();
    expect(uploader.upload).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('s1', { imageUris: [] });
  });
});
