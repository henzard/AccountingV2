import type { SlipStatus } from '../slipScanning/types';

export type SlipQueueRow = {
  id: string;
  householdId: string;
  createdBy: string;
  imageUris: string[]; // parsed
  status: SlipStatus;
  errorMessage: string | null;
  merchant: string | null;
  slipDate: string | null;
  totalCents: number | null;
  rawResponseJson: string | null;
  imagesDeletedAt: string | null;
  openaiCostCents: number;
  createdAt: string;
  updatedAt: string;
};

export interface ISlipQueueRepository {
  create(
    row: Omit<
      SlipQueueRow,
      | 'imagesDeletedAt'
      | 'errorMessage'
      | 'merchant'
      | 'slipDate'
      | 'totalCents'
      | 'rawResponseJson'
      | 'openaiCostCents'
    >,
  ): Promise<void>;
  get(id: string): Promise<SlipQueueRow | null>;
  update(id: string, patch: Partial<SlipQueueRow>): Promise<void>;
  listByHousehold(householdId: string, limit: number, offset: number): Promise<SlipQueueRow[]>;
  listExpired(beforeDateIso: string): Promise<SlipQueueRow[]>;
  listProcessingOlderThan(beforeDateIso: string): Promise<SlipQueueRow[]>;
}
