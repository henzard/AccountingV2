import type { ISlipQueueRepository } from '../ports/ISlipQueueRepository';
import { createSuccess, createFailure } from '../shared/types';
import type { Result } from '../shared/types';

export interface ISlipImageLocalStore {
  delete(slipId: string): Promise<void>;
}

export class CleanupExpiredSlipsUseCase {
  constructor(
    private readonly repo: ISlipQueueRepository,
    private readonly localStore: ISlipImageLocalStore,
  ) {}

  async execute(): Promise<Result<{ cleanedCount: number }>> {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const expired = await this.repo.listExpired(cutoff);
      const now = new Date().toISOString();
      for (const slip of expired) {
        await this.localStore.delete(slip.id);
        await this.repo.update(slip.id, { imagesDeletedAt: now, rawResponseJson: null });
      }
      return createSuccess({ cleanedCount: expired.length });
    } catch (err) {
      return createFailure({
        code: 'CLEANUP_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
