import * as Crypto from 'expo-crypto';
import type { ISlipQueueRepository } from '../ports/ISlipQueueRepository';
import { createSuccess, createFailure } from '../shared/types';
import type { Result } from '../shared/types';

export type CaptureSlipInput = {
  householdId: string;
  createdBy: string;
  frameLocalUris: string[];
};

export class CaptureSlipUseCase {
  constructor(private readonly repo: ISlipQueueRepository) {}

  async execute(input: CaptureSlipInput): Promise<Result<{ slipId: string }>> {
    if (input.frameLocalUris.length === 0 || input.frameLocalUris.length > 5) {
      return createFailure({ code: 'SLIP_INVALID_FRAME_COUNT', message: 'Slip needs 1-5 frames' });
    }
    const slipId = Crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await this.repo.create({
        id: slipId,
        householdId: input.householdId,
        createdBy: input.createdBy,
        imageUris: input.frameLocalUris,
        status: 'processing',
        createdAt: now,
        updatedAt: now,
      });
      return createSuccess({ slipId });
    } catch (err) {
      return createFailure({
        code: 'SLIP_DB_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
