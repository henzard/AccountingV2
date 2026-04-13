import type { IUserConsentRepository } from '../ports/IUserConsentRepository';
import { createSuccess, createFailure } from '../shared/types';
import type { Result } from '../shared/types';

export class RecordSlipConsentUseCase {
  constructor(private readonly repo: IUserConsentRepository) {}

  async execute(input: { userId: string }): Promise<Result<void>> {
    try {
      await this.repo.setSlipScanConsent(input.userId, new Date().toISOString());
      return createSuccess(undefined);
    } catch (err) {
      return createFailure({
        code: 'DB_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
