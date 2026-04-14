import { RecordSlipConsentUseCase } from '../RecordSlipConsentUseCase';

describe('RecordSlipConsentUseCase', () => {
  it('persists current timestamp', async () => {
    const repo = { setSlipScanConsent: jest.fn().mockResolvedValue(undefined) };
    const useCase = new RecordSlipConsentUseCase(repo as any);
    const result = await useCase.execute({ userId: 'u1' });
    expect(result.success).toBe(true);
    expect(repo.setSlipScanConsent).toHaveBeenCalledWith('u1', expect.any(String));
  });

  it('returns failure when repo throws', async () => {
    const repo = { setSlipScanConsent: jest.fn().mockRejectedValue(new Error('db')) };
    const useCase = new RecordSlipConsentUseCase(repo as any);
    const result = await useCase.execute({ userId: 'u1' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('DB_ERROR');
  });
});
