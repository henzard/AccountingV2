import type { CaptureSlipUseCase } from '../domain/slipScanning/CaptureSlipUseCase';
import type { UploadSlipImagesUseCase } from '../domain/slipScanning/UploadSlipImagesUseCase';
import type { ExtractSlipUseCase } from '../domain/slipScanning/ExtractSlipUseCase';
import type { SlipExtraction } from '../domain/slipScanning/types';
import type { SlipScanError } from '../domain/slipScanning/errors';
import { createSuccess, createFailure } from '../domain/shared/types';
import type { Result } from '../domain/shared/types';

export type ProgressState =
  | { stage: 'capturing' }
  | { stage: 'uploading'; slipId: string }
  | { stage: 'extracting'; slipId: string }
  | { stage: 'done'; slipId: string }
  | { stage: 'failed'; slipId?: string; error: SlipScanError };

export type SlipScanFlowDeps = {
  captureSlip: Pick<CaptureSlipUseCase, 'execute'>;
  uploadSlipImages: Pick<UploadSlipImagesUseCase, 'execute'>;
  extractSlip: Pick<ExtractSlipUseCase, 'execute'>;
};

export class SlipScanFlow {
  constructor(private readonly deps: SlipScanFlowDeps) {}

  async start(
    input: { householdId: string; createdBy: string; frameLocalUris: string[] },
    onProgress: (state: ProgressState) => void,
  ): Promise<Result<{ slipId: string; extraction: SlipExtraction }, SlipScanError>> {
    onProgress({ stage: 'capturing' });
    const capture = await this.deps.captureSlip.execute(input);
    if (!capture.success) {
      const err: SlipScanError = { code: 'SLIP_OFFLINE', message: capture.error.message };
      onProgress({ stage: 'failed', error: err });
      return createFailure(err);
    }
    const slipId = capture.data.slipId;
    onProgress({ stage: 'uploading', slipId });

    const upload = await this.deps.uploadSlipImages.execute({
      slipId,
      householdId: input.householdId,
      frameLocalUris: input.frameLocalUris,
    });
    if (!upload.success) {
      const err: SlipScanError = { code: 'SLIP_OFFLINE', message: upload.error.message };
      onProgress({ stage: 'failed', slipId, error: err });
      return createFailure(err);
    }
    onProgress({ stage: 'extracting', slipId });

    const extract = await this.deps.extractSlip.execute({
      slipId,
      householdId: input.householdId,
      framesBase64: upload.data.framesBase64,
    });
    if (!extract.success) {
      onProgress({ stage: 'failed', slipId, error: extract.error });
      return createFailure(extract.error);
    }
    onProgress({ stage: 'done', slipId });
    return createSuccess({ slipId, extraction: extract.data });
  }
}
