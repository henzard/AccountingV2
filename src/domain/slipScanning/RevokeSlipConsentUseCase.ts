import type { IUserConsentRepository } from '../ports/IUserConsentRepository';
import { createSuccess, createFailure } from '../shared/types';
import type { Result } from '../shared/types';

/**
 * Revokes a previously granted slip-scan consent (SET-1). Clears
 * `slip_scan_consent_at` back to null — the existing "not consented" state
 * both the local hasConsented check and the extract-slip edge function's
 * consent gate already read. Does not touch slip_queue or transactions:
 * already-scanned slips and the transactions created from them are kept.
 */
export class RevokeSlipConsentUseCase {
  constructor(private readonly repo: IUserConsentRepository) {}

  async execute(input: { userId: string }): Promise<Result<void>> {
    try {
      await this.repo.clearSlipScanConsent(input.userId);
      return createSuccess(undefined);
    } catch (err) {
      return createFailure({
        code: 'DB_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
