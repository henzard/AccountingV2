import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';

export interface IEnvelopeRepository {
  /** Returns the envelope with its `spentCents` derived from the transaction ledger. */
  findById(id: string, householdId: string): Promise<EnvelopeEntity | null>;
  /** Returns every household envelope for `periodStart`, each with `spentCents` derived from the ledger. */
  listByHousehold(householdId: string, periodStart: string): Promise<EnvelopeEntity[]>;
  insert(e: EnvelopeEntity): Promise<void>;
  update(e: EnvelopeEntity): Promise<void>;
  delete(id: string, householdId: string): Promise<void>;
}
