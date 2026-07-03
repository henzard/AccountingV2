import * as fc from 'fast-check';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import {
  getEnvelopeSpentCents,
  type EnvelopeBalanceDb,
} from '../../src/data/local/balances/EnvelopeBalanceQuery';

const NOW = '2026-01-01T00:00:00.000Z';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

interface EnvelopeSeed {
  id: string;
  householdId: string;
  envelopeType: string;
  periodStart: string;
  deletedAt?: string | null;
}

function seedEnvelope(db: Database.Database, e: EnvelopeSeed): void {
  db.prepare(
    `INSERT INTO envelopes
       (id, household_id, name, allocated_cents, spent_cents, envelope_type,
        is_savings_locked, is_archived, period_start, created_at, updated_at, is_synced, deleted_at)
     VALUES (?, ?, ?, 0, 0, ?, 0, 0, ?, ?, ?, 0, ?)`,
  ).run(e.id, e.householdId, e.id, e.envelopeType, e.periodStart, NOW, NOW, e.deletedAt ?? null);
}

interface TransactionSeed {
  id: string;
  householdId: string;
  envelopeId: string;
  amountCents: number;
  transactionDate: string;
  deletedAt?: string | null;
}

function seedTransaction(db: Database.Database, t: TransactionSeed): void {
  db.prepare(
    `INSERT INTO transactions
       (id, household_id, envelope_id, amount_cents, transaction_date,
        is_business_expense, created_at, updated_at, is_synced, deleted_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, ?)`,
  ).run(
    t.id,
    t.householdId,
    t.envelopeId,
    t.amountCents,
    t.transactionDate,
    NOW,
    NOW,
    t.deletedAt ?? null,
  );
}

describe('getEnvelopeSpentCents (real SQLite)', () => {
  describe('correctness across scopes', () => {
    it('sums non-deleted transactions per envelope, scoped by period vs persistent', async () => {
      const raw = openMigratedDb();
      const db: EnvelopeBalanceDb = drizzle(raw);
      const householdId = 'hh-1';
      const periodStart = '2026-07-01';

      seedHousehold(raw, householdId);

      // 3 period-scoped envelopes for the target period.
      seedEnvelope(raw, { id: 'env-spending', householdId, envelopeType: 'spending', periodStart });
      seedEnvelope(raw, { id: 'env-income', householdId, envelopeType: 'income', periodStart });
      seedEnvelope(raw, { id: 'env-utility', householdId, envelopeType: 'utility', periodStart });
      // 2 persistent envelopes (period_start reflects their creation period, not "this" period).
      seedEnvelope(raw, {
        id: 'env-savings',
        householdId,
        envelopeType: 'savings',
        periodStart: '2026-01-01',
      });
      seedEnvelope(raw, {
        id: 'env-emergency',
        householdId,
        envelopeType: 'emergency_fund',
        periodStart: '2026-01-01',
      });

      // A period envelope from a DIFFERENT period must be excluded entirely.
      seedEnvelope(raw, {
        id: 'env-spending-old',
        householdId,
        envelopeType: 'spending',
        periodStart: '2026-06-01',
      });
      // A different household's envelope must never appear.
      seedHousehold(raw, 'hh-2');
      seedEnvelope(raw, {
        id: 'env-other-household',
        householdId: 'hh-2',
        envelopeType: 'spending',
        periodStart,
      });

      // Transactions for env-spending: 1000 + 2000 = 3000; a deleted 5000 excluded.
      seedTransaction(raw, {
        id: 'tx-1',
        householdId,
        envelopeId: 'env-spending',
        amountCents: 1000,
        transactionDate: '2026-07-05',
      });
      seedTransaction(raw, {
        id: 'tx-2',
        householdId,
        envelopeId: 'env-spending',
        amountCents: 2000,
        transactionDate: '2026-07-10',
      });
      seedTransaction(raw, {
        id: 'tx-3-deleted',
        householdId,
        envelopeId: 'env-spending',
        amountCents: 5000,
        transactionDate: '2026-07-12',
        deletedAt: NOW,
      });
      // env-income: 500.
      seedTransaction(raw, {
        id: 'tx-4',
        householdId,
        envelopeId: 'env-income',
        amountCents: 500,
        transactionDate: '2026-07-02',
      });
      // env-utility: no transactions -> expect 0.
      // env-savings: 100 + 200 + 300 = 600, spread across "periods" (all-time).
      seedTransaction(raw, {
        id: 'tx-5',
        householdId,
        envelopeId: 'env-savings',
        amountCents: 100,
        transactionDate: '2026-02-01',
      });
      seedTransaction(raw, {
        id: 'tx-6',
        householdId,
        envelopeId: 'env-savings',
        amountCents: 200,
        transactionDate: '2026-05-01',
      });
      seedTransaction(raw, {
        id: 'tx-7',
        householdId,
        envelopeId: 'env-savings',
        amountCents: 300,
        transactionDate: '2026-07-01',
      });
      // env-emergency: no transactions -> expect 0.
      // The excluded old-period envelope still has a transaction; it must not leak in.
      seedTransaction(raw, {
        id: 'tx-8',
        householdId,
        envelopeId: 'env-spending-old',
        amountCents: 9999,
        transactionDate: '2026-06-15',
      });

      const result = await getEnvelopeSpentCents(db, householdId, periodStart);

      expect(Array.from(result.entries()).sort()).toEqual(
        [
          ['env-spending', 3000],
          ['env-income', 500],
          ['env-utility', 0],
          ['env-savings', 600],
          ['env-emergency', 0],
        ].sort(),
      );
      expect(result.has('env-spending-old')).toBe(false);
      expect(result.has('env-other-household')).toBe(false);

      raw.close();
    });
  });

  describe('conservation property', () => {
    it('sum of all envelope spends equals sum of all non-deleted transaction amounts', async () => {
      const envelopeTypeArb = fc.constantFrom(
        'spending',
        'income',
        'utility',
        'sinking_fund',
        'emergency_fund',
        'savings',
        'baby_step',
      );

      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(
            fc.record({ index: fc.integer({ min: 0, max: 9 }), envelopeType: envelopeTypeArb }),
            { selector: (e) => e.index, minLength: 1, maxLength: 10 },
          ),
          fc.array(
            fc.record({
              envelopeIndex: fc.integer({ min: 0, max: 9 }),
              amountCents: fc.integer({ min: -100_000, max: 100_000 }),
              deleted: fc.boolean(),
            }),
            { maxLength: 40 },
          ),
          async (envelopeSeeds, txSeeds) => {
            const raw = openMigratedDb();
            const db: EnvelopeBalanceDb = drizzle(raw);
            const householdId = 'hh-prop';
            const periodStart = '2026-07-01';
            const knownIndices = new Set(envelopeSeeds.map((e) => e.index));

            seedHousehold(raw, householdId);
            for (const e of envelopeSeeds) {
              seedEnvelope(raw, {
                id: `env-${e.index}`,
                householdId,
                envelopeType: e.envelopeType,
                periodStart,
              });
            }

            let expectedTotal = 0;
            txSeeds.forEach((t, i) => {
              if (!knownIndices.has(t.envelopeIndex)) return;
              seedTransaction(raw, {
                id: `tx-${i}`,
                householdId,
                envelopeId: `env-${t.envelopeIndex}`,
                amountCents: t.amountCents,
                transactionDate: '2026-07-05',
                deletedAt: t.deleted ? NOW : null,
              });
              if (!t.deleted) expectedTotal += t.amountCents;
            });

            const result = await getEnvelopeSpentCents(db, householdId, periodStart);
            raw.close();
            const actualTotal = Array.from(result.values()).reduce((a, b) => a + b, 0);
            expect(actualTotal).toBe(expectedTotal);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe('performance gate', () => {
    it('completes in under 15ms against 10,000 transactions across 20 envelopes', async () => {
      const raw = openMigratedDb();
      const db: EnvelopeBalanceDb = drizzle(raw);
      const householdId = 'hh-perf';
      const periodStart = '2026-07-01';

      seedHousehold(raw, householdId);

      const types = ['spending', 'income', 'utility', 'savings', 'emergency_fund'];
      const envelopeIds: string[] = [];
      for (let i = 0; i < 20; i++) {
        const id = `env-perf-${i}`;
        envelopeIds.push(id);
        seedEnvelope(raw, {
          id,
          householdId,
          envelopeType: types[i % types.length],
          periodStart,
        });
      }

      const insertTx = raw.prepare(
        `INSERT INTO transactions
           (id, household_id, envelope_id, amount_cents, transaction_date,
            is_business_expense, created_at, updated_at, is_synced, deleted_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, NULL)`,
      );
      const insertMany = raw.transaction((rows: number) => {
        for (let i = 0; i < rows; i++) {
          insertTx.run(
            `tx-perf-${i}`,
            householdId,
            envelopeIds[i % envelopeIds.length],
            (i % 500) + 1,
            '2026-07-05',
            NOW,
            NOW,
          );
        }
      });
      insertMany(10_000);

      const start = Date.now();
      await getEnvelopeSpentCents(db, householdId, periodStart);
      const elapsedMs = Date.now() - start;

      // eslint-disable-next-line no-console
      console.log(`getEnvelopeSpentCents perf: ${elapsedMs}ms for 10,000 transactions`);
      expect(elapsedMs).toBeLessThan(15);

      raw.close();
    });
  });
});
