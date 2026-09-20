jest.mock('expo-crypto', () => ({ randomUUID: () => 'new-env-uuid' }));

import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { CreateEnvelopeUseCase } from './CreateEnvelopeUseCase';
import { periodContributionId } from '../budgets/PersistentContributions';

const dialect = new SQLiteSyncDialect();

/**
 * Fake drizzle db exposing the `select().from().where()` chain the create-time
 * EMF duplicate guard queries, PLUS the `transaction` the unit of work needs.
 *
 * The envelope insert and (for a persistent type) its creation-period
 * contribution now share ONE `runInUnitOfWork` — a fund must never exist
 * without its first contribution row — so this use case no longer writes
 * through an injectable `SyncedRepo` and the rows are read back out of the
 * captured SQL instead (same pattern as `CreateHouseholdUseCase.test.ts`).
 */
function makeDb(existingRows: Record<string, unknown>[] = []) {
  // Typed with its `query` parameter so `mock.calls` carries the captured SQL
  // rather than jest's empty-tuple default.
  const txRun = jest.fn((query: unknown) => {
    void query;
    return { changes: 1 };
  });
  const whereFn = jest.fn().mockResolvedValue(existingRows);
  const fromFn = jest.fn().mockReturnValue({ where: whereFn });
  const selectFn = jest.fn().mockReturnValue({ from: fromFn });
  return {
    select: selectFn,
    transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({ run: txRun })),
    _txRun: txRun,
    _whereFn: whereFn,
    _fromFn: fromFn,
    _selectFn: selectFn,
  };
}

type FakeDb = ReturnType<typeof makeDb>;

const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

/**
 * Every ENTITY row inserted inside the unit of work, decoded back into a
 * column map from the SQL the transaction actually ran. The paired `oplog`
 * inserts are filtered out — they are asserted by count where it matters.
 */
function insertedRows(db: FakeDb): { table: string; row: Record<string, unknown> }[] {
  return db._txRun.mock.calls
    .map(([query]) => dialect.sqlToQuery(query as unknown as SQL))
    .map(({ sql, params }) => {
      const match = /^\s*INSERT INTO (\w+) \(([^)]*)\) VALUES/.exec(sql);
      if (!match || match[1] === 'oplog') return null;
      const columns = match[2].split(',').map((c) => c.trim());
      const row: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        row[column] = params[index];
      });
      return { table: match[1], row };
    })
    .filter((entry): entry is { table: string; row: Record<string, unknown> } => entry !== null);
}

function rowsFor(db: FakeDb, table: string): Record<string, unknown>[] {
  return insertedRows(db)
    .filter((entry) => entry.table === table)
    .map((entry) => entry.row);
}

const validInput = {
  householdId: 'hh-1',
  name: 'Groceries',
  allocatedCents: 300000,
  envelopeType: 'spending' as const,
  periodStart: '2026-03-25',
};

describe('CreateEnvelopeUseCase', () => {
  it('creates envelope and returns it', async () => {
    const db = makeDb();
    const audit = makeAudit();
    const uc = new CreateEnvelopeUseCase(db as never, audit as never, validInput);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('new-env-uuid');
      expect(result.data.name).toBe('Groceries');
      expect(result.data.allocatedCents).toBe(300000);
      expect(result.data.spentCents).toBe(0);
    }
    expect(rowsFor(db, 'envelopes')).toHaveLength(1);
    expect(audit.log).toHaveBeenCalled();
  });

  it('inserts a row with snake_case columns, no envelope mutation elsewhere', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, validInput);
    await uc.execute();

    // One transaction, and inside it exactly the envelope INSERT + its oplog op.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db._txRun).toHaveBeenCalledTimes(2);

    const [row] = rowsFor(db, 'envelopes');
    expect(row).toEqual(
      expect.objectContaining({
        id: 'new-env-uuid',
        household_id: 'hh-1',
        name: 'Groceries',
        allocated_cents: 300000,
        envelope_type: 'spending',
        is_archived: 0,
        period_start: '2026-03-25',
      }),
    );
    expect(row).not.toHaveProperty('spent_cents');
    expect(row).not.toHaveProperty('is_synced');
  });

  it('trims whitespace from name', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, {
      ...validInput,
      name: '  Groceries  ',
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Groceries');
  });

  it('returns failure when name is empty', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, {
      ...validInput,
      name: '   ',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns failure when allocatedCents is zero', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, {
      ...validInput,
      allocatedCents: 0,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('sets isSavingsLocked true for savings type', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, {
      ...validInput,
      envelopeType: 'savings' as const,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(true);
  });

  it('sets isSavingsLocked true for emergency_fund type', async () => {
    const db = makeDb([]); // no existing active EMF in this household
    const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, {
      ...validInput,
      envelopeType: 'emergency_fund' as const,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(true);
  });

  it('sets isSavingsLocked false for spending type', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, validInput);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(false);
  });

  // ── REG-7: a fund created MID-period funds that period immediately ───────
  describe('creation-period contribution for persistent types', () => {
    it('writes the creation period’s contribution in the SAME transaction as the envelope', async () => {
      const db = makeDb();
      const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, {
        ...validInput,
        name: 'Car Service',
        envelopeType: 'sinking_fund' as const,
      });
      const result = await uc.execute();
      expect(result.success).toBe(true);

      // ONE transaction: a fund must never exist without its first
      // contribution, nor a contribution without its fund.
      expect(db.transaction).toHaveBeenCalledTimes(1);

      const [contribution] = rowsFor(db, 'envelope_contributions');
      expect(contribution).toEqual(
        expect.objectContaining({
          // The SAME deterministic id a later rollover INTO this period would
          // compute — which is what stops that rollover double-funding it.
          id: periodContributionId('hh-1', 'new-env-uuid', '2026-03-25'),
          household_id: 'hh-1',
          envelope_id: 'new-env-uuid',
          amount_cents: 300000,
          period_start: '2026-03-25',
          source: 'initial',
        }),
      );
    });

    it('writes no contribution for a PERIOD-scoped envelope', async () => {
      const db = makeDb();
      await new CreateEnvelopeUseCase(db as never, makeAudit() as never, validInput).execute();
      expect(rowsFor(db, 'envelope_contributions')).toHaveLength(0);
    });
  });

  describe('emergency_fund create-time duplicate guard', () => {
    const emfInput = {
      householdId: 'hh-1',
      name: 'Emergency Fund',
      allocatedCents: 500000,
      envelopeType: 'emergency_fund' as const,
      periodStart: '2026-03-25',
    };

    it('returns DUPLICATE_EMERGENCY_FUND and does not insert when an active emergency_fund already exists', async () => {
      const audit = makeAudit();
      const db = makeDb([{ id: 'existing-emf' }]);
      const uc = new CreateEnvelopeUseCase(db as never, audit as never, emfInput);

      const result = await uc.execute();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('DUPLICATE_EMERGENCY_FUND');
      expect(db.transaction).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('queries scoped to the household, active, non-deleted emergency_fund rows', async () => {
      const db = makeDb([]);
      const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, emfInput);

      await uc.execute();

      expect(db._selectFn).toHaveBeenCalledTimes(1);
      expect(db._fromFn).toHaveBeenCalledTimes(1);
      expect(db._whereFn).toHaveBeenCalledTimes(1);
    });

    it('does not query the db at all for non-emergency_fund envelope types', async () => {
      const db = makeDb([]);
      const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, validInput);

      const result = await uc.execute();

      expect(result.success).toBe(true);
      expect(db._selectFn).not.toHaveBeenCalled();
      expect(rowsFor(db, 'envelopes')).toHaveLength(1);
    });

    it('allows creating multiple non-EMF persistent envelopes (e.g. sinking_fund) without querying', async () => {
      const db1 = makeDb();
      const db2 = makeDb();
      const uc1 = new CreateEnvelopeUseCase(db1 as never, makeAudit() as never, {
        ...validInput,
        name: 'Roof Fund',
        envelopeType: 'sinking_fund' as const,
      });
      const uc2 = new CreateEnvelopeUseCase(db2 as never, makeAudit() as never, {
        ...validInput,
        name: 'Car Fund',
        envelopeType: 'sinking_fund' as const,
      });

      const result1 = await uc1.execute();
      const result2 = await uc2.execute();

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(db1._selectFn).not.toHaveBeenCalled();
      expect(db2._selectFn).not.toHaveBeenCalled();
      expect(rowsFor(db1, 'envelopes')).toHaveLength(1);
      expect(rowsFor(db2, 'envelopes')).toHaveLength(1);
    });
  });
});

describe('CreateEnvelopeUseCase — targetDate validation (DOM-9)', () => {
  it('rejects a malformed targetDate with INVALID_TARGET_DATE', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, {
      ...validInput,
      envelopeType: 'sinking_fund' as const,
      targetDate: 'not-a-date',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_TARGET_DATE');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects an impossible calendar date with INVALID_TARGET_DATE', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, {
      ...validInput,
      envelopeType: 'sinking_fund' as const,
      targetDate: '2027-13-40',
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_TARGET_DATE');
  });

  it('accepts a valid targetDate', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, {
      ...validInput,
      envelopeType: 'sinking_fund' as const,
      targetDate: '2027-12-01',
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('accepts a null/absent targetDate', async () => {
    const db = makeDb();
    const uc = new CreateEnvelopeUseCase(db as never, makeAudit() as never, validInput);
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });
});

describe('CreateEnvelopeUseCase — best-effort audit (DOM-10)', () => {
  it('still returns success when audit.log rejects after the write has committed', async () => {
    const db = makeDb();
    const audit = { log: jest.fn().mockRejectedValue(new Error('audit db down')) };
    const uc = new CreateEnvelopeUseCase(db as never, audit as never, validInput);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(rowsFor(db, 'envelopes')).toHaveLength(1);
  });
});
