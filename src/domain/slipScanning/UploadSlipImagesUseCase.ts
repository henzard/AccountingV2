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

/**
 * Compresses the captured frames, uploads them, and records the resulting
 * REMOTE Storage paths on the slip row.
 *
 * A-2 (intentional, do not "fix" here): `repo.update(..., { imageUris })`
 * REPLACES the on-device capture URIs with the remote paths. `image_uris` is
 * a synced slip_queue column and the server/other devices rely on it meaning
 * "remote Storage path", so the stored value must not change.
 *
 * The consequence is that after this use case succeeds, a slip row no longer
 * points at anything this device can read: `framesBase64` is returned to the
 * caller in memory only (nothing persists it — SlipImageLocalStore is never
 * called by a capture path). So if the app dies between here and extraction,
 * the scan cannot be resumed: the `extract-slip` edge function accepts only
 * inline `images_base64`, and there is no download port to turn a Storage
 * path back into base64. SlipQueueScreen therefore detects that state and
 * offers to clear the slip rather than feeding remote paths to the
 * compressor, which throws and strands the row at 'processing'.
 */
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
