import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { ISlipQueueRepository } from '../ports/ISlipQueueRepository';
import { createSuccess, createFailure } from '../shared/types';
import type { Result } from '../shared/types';

type Tx = Parameters<Parameters<ExpoSQLiteDatabase<typeof schema>['transaction']>[0]>[0];

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

export type CreateTransactionUseCaseFactory = (
  tx: Tx,
  input: {
    householdId: string;
    envelopeId: string;
    amountCents: number;
    transactionDate: string;
    payee: string | null;
    description: string | null;
    slipId: string;
  },
) => { execute: () => Promise<Result<{ id: string }>> };

export class ConfirmSlipUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly createTransactionFactory: CreateTransactionUseCaseFactory,
    private readonly repo: ISlipQueueRepository,
  ) {}

  async execute(input: ConfirmSlipInput): Promise<Result<{ transactionIds: string[] }>> {
    try {
      const ids = await this.db.transaction(async (tx) => {
        const created: string[] = [];
        for (const item of input.items) {
          const usecase = this.createTransactionFactory(tx, {
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
            throw new Error(`SLIP_PARTIAL_SAVE_FAILED: ${result.error.message}`);
          }
          created.push(result.data.id);
        }
        await this.repo.update(input.slipId, { status: 'completed' });
        return created;
      });
      return createSuccess({ transactionIds: ids });
    } catch (err) {
      // Drizzle rolled back; mark slip as failed so the user can retry cleanly.
      await this.repo.update(input.slipId, {
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return createFailure({
        code: 'SLIP_PARTIAL_SAVE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
