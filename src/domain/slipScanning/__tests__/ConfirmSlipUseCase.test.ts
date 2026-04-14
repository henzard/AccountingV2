import { ConfirmSlipUseCase } from '../ConfirmSlipUseCase';

// Mock db with transaction that executes the callback immediately
function makeMockDb(
  overrideTransaction?: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>,
) {
  const transaction = jest
    .fn()
    .mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
      overrideTransaction ? overrideTransaction(cb) : cb('mock-tx'),
    );
  return { transaction };
}

describe('ConfirmSlipUseCase', () => {
  it('creates one transaction per item via CreateTransactionUseCase, all with slipId', async () => {
    const txExecute = jest.fn().mockResolvedValue({ success: true, data: { id: 't' } });
    const txFactory = jest.fn().mockImplementation(() => ({ execute: txExecute }));
    const repo = { update: jest.fn().mockResolvedValue(undefined) };
    const db = makeMockDb();

    const useCase = new ConfirmSlipUseCase(db as any, txFactory as any, repo as any);
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
    // Factory is now called with (tx, input) — assert the input arg (index 1)
    expect(txFactory).toHaveBeenNthCalledWith(
      1,
      'mock-tx',
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
    const repo = { update: jest.fn().mockResolvedValue(undefined) };
    const db = makeMockDb();

    const useCase = new ConfirmSlipUseCase(db as any, txFactory as any, repo as any);
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
    // On failure, slip is marked failed (not completed)
    expect(repo.update).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'failed' }));
    expect(repo.update).not.toHaveBeenCalledWith('s1', { status: 'completed' });
  });
});
