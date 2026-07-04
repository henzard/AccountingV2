/**
 * Real-driver proof for the ConfirmSlipUseCase atomicity fix (spec §4.5
 * carried Critical, slice 6 task 2).
 *
 * The old implementation wrapped its item loop in
 * `await this.db.transaction(async (tx) => {...})`. drizzle's expo-sqlite
 * `db.transaction` runs its callback in SYNC mode — it does NOT await an
 * async callback. COMMIT fired at the callback's first `await` (the first
 * item's `await usecase.execute()`), before later items had even run. A
 * 2-item slip whose second item failed left the FIRST item's transaction
 * permanently committed: a silent, non-atomic partial write. Every unit
 * test mocked `db.transaction` as a function that ITSELF awaited the async
 * callback (faithful to Promise semantics, but not to expo-sqlite's real
 * sync-mode driver) — which hid the bug completely.
 *
 * This file runs the fixed use case against the REAL better-sqlite3 driver
 * (not a mocked `db.transaction`) to prove: (1) a mid-loop failure rolls
 * back EVERY item, not just the failing one, and (2) a double-confirm is
 * idempotent — it never duplicates the item transactions.
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { ConfirmSlipUseCase } from '../../src/domain/slipScanning/ConfirmSlipUseCase';
import { DrizzleSlipQueueRepository } from '../../src/data/repositories/DrizzleSlipQueueRepository';
import type { ISlipQueueRepository } from '../../src/domain/ports/ISlipQueueRepository';
import type * as schema from '../../src/data/local/schema';

const NOW = '2026-01-01T00:00:00.000Z';

function openDb(): { raw: Database.Database; db: ExpoSQLiteDatabase<typeof schema> } {
  const raw = openMigratedDb();
  const db = drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
  return { raw, db };
}

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

function seedEnvelope(
  db: Database.Database,
  args: { id: string; householdId: string; envelopeType: string },
): void {
  db.prepare(
    `INSERT INTO envelopes
       (id, household_id, name, allocated_cents, envelope_type,
        is_savings_locked, is_archived, period_start, created_at, updated_at)
     VALUES (?, ?, ?, 50000, ?, 0, 0, '2026-01-01', ?, ?)`,
  ).run(args.id, args.householdId, args.id, args.envelopeType, NOW, NOW);
}

function seedSlipQueue(
  db: Database.Database,
  args: { id: string; householdId: string; status: string },
): void {
  db.prepare(
    `INSERT INTO slip_queue
       (id, household_id, created_by, image_uris, status, openai_cost_cents, created_at, updated_at)
     VALUES (?, ?, 'user-1', '[]', ?, 0, ?, ?)`,
  ).run(args.id, args.householdId, args.status, NOW, NOW);
}

function count(raw: Database.Database, sql: string, ...params: unknown[]): number {
  return (raw.prepare(sql).get(...params) as { n: number }).n;
}

describe('ConfirmSlipUseCase atomicity (real SQLite, spec §4.5 fix)', () => {
  it('happy path: a 2-item slip confirms -> 2 transaction rows + 2 oplog insert ops + slip marked completed', async () => {
    const { raw, db } = openDb();
    const householdId = 'hh-happy';
    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
    seedEnvelope(raw, { id: 'env-2', householdId, envelopeType: 'spending' });
    seedSlipQueue(raw, { id: 'slip-1', householdId, status: 'processing' });

    const repo = new DrizzleSlipQueueRepository(db);
    const useCase = new ConfirmSlipUseCase(db, repo, {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    });

    const result = await useCase.execute({
      slipId: 'slip-1',
      householdId,
      transactionDate: '2026-01-15',
      items: [
        { description: 'Milk', amountCents: 3500, envelopeId: 'env-1' },
        { description: 'Bread', amountCents: 2500, envelopeId: 'env-2' },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.transactionIds).toHaveLength(2);

    expect(
      count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?', householdId),
    ).toBe(2);
    expect(
      count(
        raw,
        "SELECT COUNT(*) AS n FROM oplog WHERE table_name = 'transactions' AND op_type = 'insert'",
      ),
    ).toBe(2);
    expect(
      count(
        raw,
        "SELECT COUNT(*) AS n FROM oplog WHERE table_name = 'slip_queue' AND op_type = 'update' AND row_id = ?",
        'slip-1',
      ),
    ).toBe(1);

    const slip = raw.prepare('SELECT status FROM slip_queue WHERE id = ?').get('slip-1') as {
      status: string;
    };
    expect(slip.status).toBe('completed');

    raw.close();
  });

  it('rolls back BOTH items when item 2 fails mid-transaction — the carried Critical this fixes', async () => {
    const { raw, db } = openDb();
    const householdId = 'hh-rollback';
    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
    seedEnvelope(raw, { id: 'env-2', householdId, envelopeType: 'spending' });
    seedSlipQueue(raw, { id: 'slip-2', householdId, status: 'processing' });

    // Pre-seed an oplog row occupying the op_id item 2's oplog append will
    // reuse, so item 2's own `INSERT INTO oplog` hits a PRIMARY KEY conflict
    // — AFTER item 2's transaction row (and item 1's transaction row + oplog
    // row) have already been written inside the SAME still-open transaction.
    // This is exactly the old bug's shape (item 1 "succeeds" before item 2
    // fails) — the fix must roll BOTH items back together, not just item 2.
    raw
      .prepare(
        `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id, client_created_at)
         VALUES ('dup-op', 'hh-other', 'transactions', 'other-row', 'insert', '{}', 'device-0', ?)`,
      )
      .run(NOW);

    const repo = new DrizzleSlipQueueRepository(db);
    let genIdCalls = 0;
    const useCase = new ConfirmSlipUseCase(db, repo, {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
      // First item's oplog append gets a fresh id; the second collides with
      // the pre-seeded row above, forcing a mid-transaction throw.
      genId: () => {
        genIdCalls += 1;
        return genIdCalls === 1 ? 'op-item-1' : 'dup-op';
      },
    });

    const result = await useCase.execute({
      slipId: 'slip-2',
      householdId,
      transactionDate: '2026-01-15',
      items: [
        { description: 'Milk', amountCents: 3500, envelopeId: 'env-1' },
        { description: 'Bread', amountCents: 2500, envelopeId: 'env-2' },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('SLIP_PARTIAL_SAVE_FAILED');

    // NEITHER item's transaction row exists — true all-or-nothing rollback.
    expect(
      count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?', householdId),
    ).toBe(0);

    // No oplog op was appended for either item — item 1's op-item-1 insert
    // was rolled back along with item 2's failed one. (Excludes the
    // pre-seeded 'other-row' collision fixture, which legitimately has
    // table_name='transactions' too.)
    expect(
      count(
        raw,
        "SELECT COUNT(*) AS n FROM oplog WHERE table_name = 'transactions' AND row_id != 'other-row'",
      ),
    ).toBe(0);
    expect(raw.prepare("SELECT * FROM oplog WHERE op_id = 'op-item-1'").get()).toBeUndefined();

    // The pre-seeded colliding row survives untouched (the losing side of
    // the PK conflict never overwrote it).
    const preSeeded = raw.prepare("SELECT * FROM oplog WHERE op_id = 'dup-op'").get() as {
      row_id: string;
    };
    expect(preSeeded.row_id).toBe('other-row');

    // The aborted transaction never reached the slip-completion update...
    // ...but ConfirmSlipUseCase's OWN failure path then marks it 'failed' as
    // a separate, subsequent write (not part of the atomicity guarantee).
    const slip = raw.prepare('SELECT status FROM slip_queue WHERE id = ?').get('slip-2') as {
      status: string;
    };
    expect(slip.status).toBe('failed');

    raw.close();
  });

  it('idempotency: confirming an already-"completed" slip (double-tap / retry) does not duplicate transactions', async () => {
    const { raw, db } = openDb();
    const householdId = 'hh-idempotent';
    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
    seedSlipQueue(raw, { id: 'slip-3', householdId, status: 'processing' });

    const repo = new DrizzleSlipQueueRepository(db);
    const useCase = new ConfirmSlipUseCase(db, repo, {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    });

    const input = {
      slipId: 'slip-3',
      householdId,
      transactionDate: '2026-01-15',
      items: [{ description: 'Milk', amountCents: 3500, envelopeId: 'env-1' }],
    };

    const first = await useCase.execute(input);
    expect(first.success).toBe(true);

    // Double-confirm against the now-'completed' slip.
    const second = await useCase.execute(input);
    expect(second.success).toBe(true);
    if (second.success) expect(second.data.transactionIds).toEqual([]);

    expect(
      count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?', householdId),
    ).toBe(1); // NOT 2 — the second confirm wrote nothing

    raw.close();
  });

  it('TOCTOU: a second confirm that still reads "processing" (stale) but whose slip got completed does NOT duplicate transactions', async () => {
    const { raw, db } = openDb();
    const householdId = 'hh-toctou';
    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
    seedSlipQueue(raw, { id: 'slip-4', householdId, status: 'processing' });

    const repo = new DrizzleSlipQueueRepository(db);
    const input = {
      slipId: 'slip-4',
      householdId,
      transactionDate: '2026-01-15',
      items: [{ description: 'Milk', amountCents: 3500, envelopeId: 'env-1' }],
    };

    // First confirm wins: slip becomes 'completed' in the DB, 1 transaction.
    const first = await new ConfirmSlipUseCase(db, repo, {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    }).execute(input);
    expect(first.success).toBe(true);

    // Second confirm simulates the TOCTOU race: its Step-1 status read still
    // sees 'processing' (a stale read, forced here by a repo whose get()
    // reports 'processing' even though the DB row is now 'completed'), so it
    // sails past the fast-path guard and into the atomic write. The
    // conditional `status != 'completed'` completion UPDATE must then match 0
    // rows and roll the whole thing back — no second transaction row.
    const staleRepo: ISlipQueueRepository = {
      create: repo.create.bind(repo),
      get: async (id) => {
        const slip = await repo.get(id);
        return slip ? { ...slip, status: 'processing' } : slip;
      },
      update: repo.update.bind(repo),
      listByHousehold: repo.listByHousehold.bind(repo),
      listExpired: repo.listExpired.bind(repo),
      listProcessingOlderThan: repo.listProcessingOlderThan.bind(repo),
    };

    const second = await new ConfirmSlipUseCase(db, staleRepo, {
      deviceId: 'device-2',
      actorUserId: 'user-2',
      clock: () => NOW,
    }).execute(input);

    // Idempotent success — NOT a failure, and NOT a duplicate write.
    expect(second.success).toBe(true);
    if (second.success) expect(second.data.transactionIds).toEqual([]);

    // Still exactly ONE transaction row — the second confirm wrote nothing.
    expect(
      count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?', householdId),
    ).toBe(1);

    // And the slip was NOT flipped to 'failed' by the second confirm's error
    // path — it stays 'completed'.
    const slip = raw.prepare('SELECT status FROM slip_queue WHERE id = ?').get('slip-4') as {
      status: string;
    };
    expect(slip.status).toBe('completed');

    raw.close();
  });
});
