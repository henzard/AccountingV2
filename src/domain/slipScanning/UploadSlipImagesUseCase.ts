import type { ISlipImageCompressor } from '../ports/ISlipImageCompressor';
import type { ISlipImageUploader } from '../ports/ISlipImageUploader';
import type { ISlipQueueRepository } from '../ports/ISlipQueueRepository';
import { createSuccess, createFailure } from '../shared/types';
import type { Result } from '../shared/types';

export type UploadSlipImagesInput = {
  slipId: string;
  householdId: string;
  frameLocalUris: string[];
};

export type UploadSlipImagesOutput = {
  remotePaths: string[];
  framesBase64: string[];
};

export class UploadSlipImagesUseCase {
  constructor(
    private readonly compressor: ISlipImageCompressor,
    private readonly uploader: ISlipImageUploader,
    private readonly repo: ISlipQueueRepository,
  ) {}

  async execute(input: UploadSlipImagesInput): Promise<Result<UploadSlipImagesOutput>> {
    try {
      const compressed = await Promise.all(
        input.frameLocalUris.map((uri) => this.compressor.compress(uri)),
      );
      const remotePaths = await Promise.all(
        compressed.map((c, i) =>
          this.uploader.upload({
            householdId: input.householdId,
            slipId: input.slipId,
            frameIndex: i,
            base64: c.base64,
          }),
        ),
      );
      await this.repo.update(input.slipId, { imageUris: remotePaths });
      return createSuccess({ remotePaths, framesBase64: compressed.map((c) => c.base64) });
    } catch (err) {
      return createFailure({
        code: 'UPLOAD_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
