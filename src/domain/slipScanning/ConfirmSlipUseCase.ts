import type { ISlipQueueRepository } from '../ports/ISlipQueueRepository';
import { createSuccess, createFailure } from '../shared/types';
import type { Result } from '../shared/types';

export type ConfirmSlipItem = {
  description: string;
  amountCents: number;
  envelopeId: string;
};

export type ConfirmSlipInput = {
  slipId: string;
  householdId: string;
  transactionDate: string;
  items: ConfirmSlipItem[];
};

export type CreateTransactionUseCaseFactory = (input: {
  householdId: string;
  envelopeId: string;
  amountCents: number;
  transactionDate: string;
  payee: string | null;
  description: string | null;
  slipId: string;
}) => { execute: () => Promise<Result<{ id: string }>> };

export class ConfirmSlipUseCase {
  constructor(
    private readonly createTransactionFactory: CreateTransactionUseCaseFactory,
    private readonly repo: ISlipQueueRepository,
  ) {}

  async execute(input: ConfirmSlipInput): Promise<Result<{ transactionIds: string[] }>> {
    const ids: string[] = [];
    for (const item of input.items) {
      const usecase = this.createTransactionFactory({
        householdId: input.householdId,
        envelopeId: item.envelopeId,
        amountCents: item.amountCents,
        transactionDate: input.transactionDate,
        payee: null,
        description: item.description,
        slipId: input.slipId,
      });
      const result = await usecase.execute();
      if (!result.success) {
        return createFailure({
          code: 'PARTIAL_SAVE_FAILED',
          message: `Transaction creation failed mid-loop: ${result.error.message}`,
        });
      }
      ids.push(result.data.id);
    }
    await this.repo.update(input.slipId, { status: 'completed' });
    return createSuccess({ transactionIds: ids });
  }
}
