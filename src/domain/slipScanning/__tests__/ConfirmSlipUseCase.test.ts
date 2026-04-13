import { ConfirmSlipUseCase } from '../ConfirmSlipUseCase';

describe('ConfirmSlipUseCase', () => {
  it('creates one transaction per item via CreateTransactionUseCase, all with slipId', async () => {
    const txExecute = jest.fn().mockResolvedValue({ success: true, data: { id: 't' } });
    const txFactory = jest.fn().mockImplementation(() => ({ execute: txExecute }));
    const repo = { update: jest.fn().mockResolvedValue(undefined) };

    const useCase = new ConfirmSlipUseCase(txFactory as any, repo as any);
    const result = await useCase.execute({
      slipId: 's1',
      householdId: 'h1',
      transactionDate: '2026-04-13',
      items: [
        { description: 'eggs', amountCents: 5000, envelopeId: 'env1' },
        { description: 'bread', amountCents: 3000, envelopeId: 'env2' },
      ],
    });

    expect(result.success).toBe(true);
    expect(txExecute).toHaveBeenCalledTimes(2);
    expect(txFactory).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        slipId: 's1',
        envelopeId: 'env1',
        amountCents: 5000,
      }),
    );
    expect(repo.update).toHaveBeenCalledWith('s1', { status: 'completed' });
  });

  it('returns failure when one transaction fails', async () => {
    const txExecute = jest
      .fn()
      .mockResolvedValueOnce({ success: true, data: { id: 't1' } })
      .mockResolvedValueOnce({ success: false, error: { code: 'X', message: 'fail' } });
    const txFactory = jest.fn().mockImplementation(() => ({ execute: txExecute }));
    const repo = { update: jest.fn() };

    const useCase = new ConfirmSlipUseCase(txFactory as any, repo as any);
    const result = await useCase.execute({
      slipId: 's1',
      householdId: 'h1',
      transactionDate: '2026-04-13',
      items: [
        { description: 'eggs', amountCents: 5000, envelopeId: 'env1' },
        { description: 'bread', amountCents: 3000, envelopeId: 'env2' },
      ],
    });

    expect(result.success).toBe(false);
    expect(repo.update).not.toHaveBeenCalledWith('s1', { status: 'completed' });
  });
});
