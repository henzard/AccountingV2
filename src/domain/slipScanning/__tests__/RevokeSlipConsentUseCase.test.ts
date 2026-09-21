import { RevokeSlipConsentUseCase } from '../RevokeSlipConsentUseCase';

describe('RevokeSlipConsentUseCase', () => {
  it('clears consent for the given user', async () => {
    const repo = { clearSlipScanConsent: jest.fn().mockResolvedValue(undefined) };
    const useCase = new RevokeSlipConsentUseCase(repo as any);
    const result = await useCase.execute({ userId: 'u1' });
    expect(result.success).toBe(true);
    expect(repo.clearSlipScanConsent).toHaveBeenCalledWith('u1');
  });

  it('returns failure when repo throws', async () => {
    const repo = { clearSlipScanConsent: jest.fn().mockRejectedValue(new Error('db')) };
    const useCase = new RevokeSlipConsentUseCase(repo as any);
    const result = await useCase.execute({ userId: 'u1' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('DB_ERROR');
  });
});
