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
  /**
   * DB-13: the slip_queue row created by `captureSlip` must have been pushed
   * to the server BEFORE `extractSlip` calls the `extract-slip` edge
   * function — it 403s if the row isn't there yet. When supplied, `start`
   * triggers and awaits one sync round for the household after upload
   * succeeds and before extraction begins. Optional because this flow has
   * no direct access to a sync engine/scheduler instance (see the
   * constructor call site for the concrete wiring this needs).
   */
  ensureSynced?: (householdId: string) => Promise<void>;
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

    // DB-13: the slip_queue insert must reach the server before extraction
    // calls the edge function, which 403s on a row it hasn't seen yet.
    if (this.deps.ensureSynced) {
      try {
        await this.deps.ensureSynced(input.householdId);
      } catch (syncErr) {
        const message = syncErr instanceof Error ? syncErr.message : 'Sync failed';
        const err: SlipScanError = { code: 'SLIP_OFFLINE', message };
        onProgress({ stage: 'failed', slipId, error: err });
        return createFailure(err);
      }
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
