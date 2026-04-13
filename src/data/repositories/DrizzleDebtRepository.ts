import { and, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';
import { debts } from '../local/schema';
import type { IDebtRepository } from '../../domain/ports/IDebtRepository';
import type { DebtEntity } from '../../domain/debtSnowball/DebtEntity';

export class DrizzleDebtRepository implements IDebtRepository {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async findById(id: string, householdId: string): Promise<DebtEntity | null> {
    const [row] = await this.db
      .select()
      .from(debts)
      .where(and(eq(debts.id, id), eq(debts.householdId, householdId)))
      .limit(1);
    if (!row) return null;
    return this.rowToEntity(row);
  }

  async findByHousehold(householdId: string): Promise<DebtEntity[]> {
    const rows = await this.db.select().from(debts).where(eq(debts.householdId, householdId));
    return rows.map((r) => this.rowToEntity(r));
  }

  async insert(debt: DebtEntity): Promise<void> {
    await this.db.insert(debts).values({ ...debt, isSynced: false });
  }

  async update(debt: Partial<DebtEntity> & { id: string; householdId: string }): Promise<void> {
    const { id, householdId, ...rest } = debt;
    await this.db
      .update(debts)
      .set(rest)
      .where(and(eq(debts.id, id), eq(debts.householdId, householdId)));
  }

  private rowToEntity(row: typeof debts.$inferSelect): DebtEntity {
    return {
      id: row.id,
      householdId: row.householdId,
      creditorName: row.creditorName,
      debtType: row.debtType as DebtEntity['debtType'],
      outstandingBalanceCents: row.outstandingBalanceCents,
      initialBalanceCents: row.initialBalanceCents,
      interestRatePercent: row.interestRatePercent,
      minimumPaymentCents: row.minimumPaymentCents,
      sortOrder: row.sortOrder,
      isPaidOff: row.isPaidOff,
      totalPaidCents: row.totalPaidCents,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isSynced: row.isSynced,
    };
  }
}
