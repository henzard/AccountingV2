import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';

export interface IEnvelopeRepository {
  findById(id: string, householdId: string): Promise<EnvelopeEntity | null>;
  findByHousehold(householdId: string): Promise<EnvelopeEntity[]>;
  insert(e: EnvelopeEntity): Promise<void>;
  update(e: EnvelopeEntity): Promise<void>;
  delete(id: string, householdId: string): Promise<void>;
}
