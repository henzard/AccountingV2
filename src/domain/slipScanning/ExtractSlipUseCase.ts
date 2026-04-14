import type { ISlipExtractor } from '../ports/ISlipExtractor';
import type { ISlipQueueRepository } from '../ports/ISlipQueueRepository';
import type { SlipExtraction } from './types';
import type { SlipScanError, SlipScanErrorCode } from './errors';
import { createSuccess, createFailure } from '../shared/types';
import type { Result } from '../shared/types';

export type ExtractSlipInput = {
  slipId: string;
  householdId: string;
  framesBase64: string[];
};

export class ExtractSlipUseCase {
  constructor(
    private readonly extractor: ISlipExtractor,
    private readonly repo: ISlipQueueRepository,
  ) {}

  async execute(input: ExtractSlipInput): Promise<Result<SlipExtraction, SlipScanError>> {
    try {
      const extraction = await this.extractor.extract(input);
      await this.repo.update(input.slipId, {
        status: 'completed',
        merchant: extraction.merchant,
        slipDate: extraction.slipDate,
        totalCents: extraction.totalCents,
        rawResponseJson: extraction.rawResponseJson,
        openaiCostCents: extraction.openaiCostCents,
      });
      return createSuccess(extraction);
    } catch (err) {
      const sse = err as { code?: SlipScanErrorCode; message?: string };
      const code: SlipScanErrorCode = sse?.code ?? 'SLIP_OPENAI_UNREACHABLE';
      const message = sse?.message ?? 'Unknown error';
      await this.repo.update(input.slipId, { status: 'failed', errorMessage: message });
      return createFailure({ code, message });
    }
  }
}
