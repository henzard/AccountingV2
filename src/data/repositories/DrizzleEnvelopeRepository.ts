import { and, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';
import { envelopes } from '../local/schema';
import type { IEnvelopeRepository } from '../../domain/ports/IEnvelopeRepository';
import type { EnvelopeEntity } from '../../domain/envelopes/EnvelopeEntity';
import { getEnvelopeSpentCents } from '../local/balances/EnvelopeBalanceQuery';

export class DrizzleEnvelopeRepository implements IEnvelopeRepository {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  /**
   * `spent_cents` is no longer a stored column (see migration
   * 0012_derive_balances) — spend is derived from the transaction ledger via
   * `getEnvelopeSpentCents`, scoped by the envelope row's own `period_start`.
   * This works uniformly for both period-scoped and persistent envelope
   * types; see `EnvelopeBalanceQuery` for the scope rule.
   */
  async findById(id: string, householdId: string): Promise<EnvelopeEntity | null> {
    const [row] = await this.db
      .select()
      .from(envelopes)
      .where(and(eq(envelopes.id, id), eq(envelopes.householdId, householdId)))
      .limit(1);
    if (!row) return null;
    const spentByEnvelope = await getEnvelopeSpentCents(this.db, householdId, row.periodStart);
    return this.rowToEntity(row, spentByEnvelope.get(row.id) ?? 0);
  }

  /** Returns every household envelope for `periodStart`, with `spentCents` derived from the ledger. */
  async listByHousehold(householdId: string, periodStart: string): Promise<EnvelopeEntity[]> {
    const rows = await this.db
      .select()
      .from(envelopes)
      .where(eq(envelopes.householdId, householdId));
    const spentByEnvelope = await getEnvelopeSpentCents(this.db, householdId, periodStart);
    return rows.map((r) => this.rowToEntity(r, spentByEnvelope.get(r.id) ?? 0));
  }

  async insert(e: EnvelopeEntity): Promise<void> {
    // spentCents is a derived, not a stored, field — never written to the row.
    const { spentCents: _spentCents, ...columns } = e;
    await this.db.insert(envelopes).values(columns);
  }

  async update(e: EnvelopeEntity): Promise<void> {
    await this.db
      .update(envelopes)
      .set({
        name: e.name,
        allocatedCents: e.allocatedCents,
        envelopeType: e.envelopeType,
        isSavingsLocked: e.isSavingsLocked,
        isArchived: e.isArchived,
        periodStart: e.periodStart,
        updatedAt: e.updatedAt,
      })
      .where(and(eq(envelopes.id, e.id), eq(envelopes.householdId, e.householdId)));
  }

  async delete(id: string, householdId: string): Promise<void> {
    await this.db
      .delete(envelopes)
      .where(and(eq(envelopes.id, id), eq(envelopes.householdId, householdId)));
  }

  private rowToEntity(row: typeof envelopes.$inferSelect, spentCents: number): EnvelopeEntity {
    return {
      id: row.id,
      householdId: row.householdId,
      name: row.name,
      allocatedCents: row.allocatedCents,
      spentCents,
      envelopeType: row.envelopeType as EnvelopeEntity['envelopeType'],
      isSavingsLocked: row.isSavingsLocked,
      isArchived: row.isArchived,
      periodStart: row.periodStart,
      targetAmountCents: row.targetAmountCents ?? null,
      targetDate: row.targetDate ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
