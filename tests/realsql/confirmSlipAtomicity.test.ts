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
import type { PortableDb } from '../../src/data/uow/UnitOfWork';
import {
  SyncEngine,
  type PushResult,
  type ServerOplogRow,
  type SyncTransport,
  type WireOp,
} from '../../src/data/sync/SyncEngine';
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

/**
 * SYNC-SLIP case (c). A transport modelling the SERVER side of
 * `private.apply_one_op` (migration 0016) for insert ops: an id the server
 * already holds under DIFFERENT values is rejected `row_exists`, and
 * `rowState` then serves the server's authoritative row. Mirrors the
 * `LoopbackTransport` in `syncCorrectness.test.ts` (this suite cannot import
 * it — it is local to that test file), trimmed to the two calls this test
 * drives. `rowState` is an arrow PROPERTY because `SyncEngine` pulls it off
 * the transport and calls it unbound.
 */
class RowExistsTransport implements SyncTransport {
  readonly pushed: WireOp[] = [];
  /** row_id -> the server's existing row. Present => that insert is rejected. */
  readonly serverRows = new Map<string, Record<string, unknown>>();
  private lastRowStateFor: string | null = null;

  push = async (ops: WireOp[]): Promise<PushResult[]> => {
    this.pushed.push(...ops);
    return ops.map((op) =>
      this.serverRows.has(op.row_id)
        ? { op_id: op.op_id, status: 'rejected' as const, code: 'row_exists' }
        : { op_id: op.op_id, status: 'applied' as const, code: null },
    );
  };

  pull = async (): Promise<ServerOplogRow[]> => [];

  rowState = async (
    _householdId: string,
    _table: string,
    rowId: string,
  ): Promise<Record<string, unknown> | null> => {
    this.lastRowStateFor = rowId;
    return this.serverRows.get(rowId) ?? null;
  };

  get lastRefreshedRowId(): string | null {
    return this.lastRowStateFor;
  }
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

  /**
   * REF-SLIP: the same guarantees, proven again with a NEGATIVE line item.
   *
   * Before this fix `ConfirmSlipUseCase` did `filter(item => item.amountCents
   * > 0)`, so the discount line was silently DROPPED (only one row written,
   * the R15,00 the user actually got back lost from the ledger) while still
   * being counted in the totals comparison — which guaranteed a bogus
   * `totalMismatch` warning on every slip carrying one. Both halves are
   * asserted here against the real better-sqlite3 driver, together with the
   * derived spend (a signed SUM, exactly what `EnvelopeBalanceQuery` reads)
   * and the per-row oplog ops.
   */
  it('REF-SLIP: a slip of [+100,00, -15,00 discount] writes TWO rows netting to 85,00, reconciles with an 85,00 total, and is idempotent on a second confirm', async () => {
    const { raw, db } = openDb();
    const householdId = 'hh-discount';
    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
    seedSlipQueue(raw, { id: 'slip-5', householdId, status: 'processing' });
    // The slip's OCR total is the NET the customer paid.
    raw.prepare('UPDATE slip_queue SET total_cents = 8500 WHERE id = ?').run('slip-5');

    const repo = new DrizzleSlipQueueRepository(db);
    const useCase = new ConfirmSlipUseCase(db, repo, {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    });

    const input = {
      slipId: 'slip-5',
      householdId,
      transactionDate: '2026-01-15',
      items: [
        { description: 'Groceries', amountCents: 10000, envelopeId: 'env-1' },
        { description: 'DISCOUNT', amountCents: -1500, envelopeId: 'env-1' },
      ],
    };

    const result = await useCase.execute(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactionIds).toHaveLength(2);
      // The signed sum equals the slip total — no spurious warning.
      expect(result.data.totalMismatch).toBe(false);
    }

    // TWO rows, not one: the discount line survived.
    expect(
      count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?', householdId),
    ).toBe(2);
    expect(count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE amount_cents = -1500')).toBe(1);

    // The envelope's derived spend is the signed SUM — 85,00, not 100,00.
    const spend = raw
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents
           FROM transactions
          WHERE envelope_id = 'env-1' AND deleted_at IS NULL`,
      )
      .get() as { total_cents: number };
    expect(spend.total_cents).toBe(8500);

    // Deterministic ids + one oplog op per row, negative row included.
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
        'slip-5',
      ),
    ).toBe(1);

    // Idempotency guard still holds with a negative line in the set: the
    // second confirm writes NOTHING (no third row, no extra oplog op).
    const second = await useCase.execute(input);
    expect(second.success).toBe(true);
    if (second.success) expect(second.data.transactionIds).toEqual([]);
    expect(
      count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?', householdId),
    ).toBe(2);
    expect(
      count(
        raw,
        "SELECT COUNT(*) AS n FROM oplog WHERE table_name = 'transactions' AND op_type = 'insert'",
      ),
    ).toBe(2);

    raw.close();
  });

  it('REF-SLIP: a pure RETURN slip (net negative overall) confirms and leaves the envelope with a negative derived spend', async () => {
    const { raw, db } = openDb();
    const householdId = 'hh-return';
    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
    seedSlipQueue(raw, { id: 'slip-6', householdId, status: 'processing' });
    raw.prepare('UPDATE slip_queue SET total_cents = -2000 WHERE id = ?').run('slip-6');

    const repo = new DrizzleSlipQueueRepository(db);
    const result = await new ConfirmSlipUseCase(db, repo, {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    }).execute({
      slipId: 'slip-6',
      householdId,
      transactionDate: '2026-01-15',
      items: [{ description: 'Returned kettle', amountCents: -2000, envelopeId: 'env-1' }],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totalMismatch).toBe(false);

    const spend = raw
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents
           FROM transactions
          WHERE envelope_id = 'env-1' AND deleted_at IS NULL`,
      )
      .get() as { total_cents: number };
    expect(spend.total_cents).toBe(-2000);

    const slip = raw.prepare('SELECT status FROM slip_queue WHERE id = ?').get('slip-6') as {
      status: string;
    };
    expect(slip.status).toBe('completed');

    raw.close();
  });

  /**
   * SYNC-SLIP: the cross-device duplicate-confirmation hole.
   *
   * `slip_queue` is household-wide, so two phones can both confirm the same
   * extracted slip before either has synced. The idempotency guard is a
   * LOCAL check and cannot see the other device's rows, and while each line
   * got a `randomUUID()` the two devices produced two disjoint id sets —
   * both of which then synced, permanently double-counting the spend
   * (`transactions` is unique on `id` only; `slip_id` is merely indexed, so
   * nothing server-side caught it). Deterministic ids are what let the
   * existing `row_exists` convergence do its job; these tests use two
   * INDEPENDENT migrated databases as the two phones.
   */
  it('SYNC-SLIP: two independent devices confirming the same slip derive IDENTICAL transaction ids', async () => {
    const householdId = 'hh-two-phones';
    const input = {
      slipId: 'slip-shared',
      householdId,
      transactionDate: '2026-01-15',
      items: [
        { description: 'Groceries', amountCents: 10000, envelopeId: 'env-1' },
        { description: 'DISCOUNT', amountCents: -1500, envelopeId: 'env-1' },
      ],
    };

    async function confirmOnFreshDevice(deviceId: string): Promise<string[]> {
      const { raw, db } = openDb();
      seedHousehold(raw, householdId);
      seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
      seedSlipQueue(raw, { id: 'slip-shared', householdId, status: 'processing' });
      const result = await new ConfirmSlipUseCase(db, new DrizzleSlipQueueRepository(db), {
        deviceId,
        actorUserId: `user-${deviceId}`,
        clock: () => NOW,
      }).execute(input);
      expect(result.success).toBe(true);
      const ids = result.success ? result.data.transactionIds : [];
      // The ids really are what landed in the row, not just what was returned.
      const rowIds = (
        raw
          .prepare('SELECT id FROM transactions WHERE slip_id = ? ORDER BY rowid')
          .all('slip-shared') as { id: string }[]
      ).map((r) => r.id);
      expect(rowIds).toEqual(ids);
      raw.close();
      return ids;
    }

    // Two phones, two separate databases, neither having seen the other.
    const phoneA = await confirmOnFreshDevice('device-A');
    const phoneB = await confirmOnFreshDevice('device-B');

    expect(phoneA).toHaveLength(2);
    // The whole point: same ids, so `apply_one_op` converges them into ONE
    // set of rows instead of storing both and double-counting the spend.
    expect(phoneB).toEqual(phoneA);
    // Real v5 UUIDs, and distinct per line (no id collision within the slip).
    for (const id of phoneA) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(phoneA).size).toBe(2);
  });

  it('SYNC-SLIP: ids are scoped to the slip — a DIFFERENT slip in the same household never reuses them', async () => {
    const { raw, db } = openDb();
    const householdId = 'hh-scope';
    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
    seedSlipQueue(raw, { id: 'slip-a', householdId, status: 'processing' });
    seedSlipQueue(raw, { id: 'slip-b', householdId, status: 'processing' });

    const useCase = new ConfirmSlipUseCase(db, new DrizzleSlipQueueRepository(db), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    });
    const items = [{ description: 'Milk', amountCents: 3500, envelopeId: 'env-1' }];

    const a = await useCase.execute({
      slipId: 'slip-a',
      householdId,
      transactionDate: '2026-01-15',
      items,
    });
    const b = await useCase.execute({
      slipId: 'slip-b',
      householdId,
      transactionDate: '2026-01-15',
      items,
    });

    expect(a.success && b.success).toBe(true);
    if (a.success && b.success) {
      expect(a.data.transactionIds[0]).not.toBe(b.data.transactionIds[0]);
    }
    expect(
      count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?', householdId),
    ).toBe(2);

    raw.close();
  });

  it('SYNC-SLIP: re-confirming after the rows were SOFT-DELETED uses a fresh generation — new ids, no primary-key collision', async () => {
    const { raw, db } = openDb();
    const householdId = 'hh-regen';
    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
    seedSlipQueue(raw, { id: 'slip-regen', householdId, status: 'processing' });

    const useCase = new ConfirmSlipUseCase(db, new DrizzleSlipQueueRepository(db), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    });
    const input = {
      slipId: 'slip-regen',
      householdId,
      transactionDate: '2026-01-15',
      items: [
        { description: 'Groceries', amountCents: 10000, envelopeId: 'env-1' },
        { description: 'DISCOUNT', amountCents: -1500, envelopeId: 'env-1' },
      ],
    };

    const first = await useCase.execute(input);
    expect(first.success).toBe(true);
    const firstIds = first.success ? first.data.transactionIds : [];

    // The user deletes the slip's transactions. A SOFT delete: the rows —
    // and their primary keys — stay. Reusing the same ids would now make the
    // second confirm's INSERT throw on the primary key.
    raw
      .prepare("UPDATE transactions SET deleted_at = ? WHERE slip_id = 'slip-regen'")
      .run('2026-01-16T00:00:00.000Z');

    const second = await useCase.execute(input);
    expect(second.success).toBe(true);
    const secondIds = second.success ? second.data.transactionIds : [];

    expect(secondIds).toHaveLength(2);
    // Fresh generation => ids that cannot collide with the tombstones.
    expect(secondIds).not.toEqual(firstIds);
    for (const id of secondIds) expect(firstIds).not.toContain(id);

    // 2 tombstones + 2 live rows, and the live pair is the new one.
    expect(
      count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE slip_id = ?', 'slip-regen'),
    ).toBe(4);
    const live = (
      raw
        .prepare(
          "SELECT id FROM transactions WHERE slip_id = 'slip-regen' AND deleted_at IS NULL ORDER BY rowid",
        )
        .all() as { id: string }[]
    ).map((r) => r.id);
    expect(live).toEqual(secondIds);

    raw.close();
  });

  it('SYNC-SLIP: a slip confirmed by an OLDER build (random-id rows) is still treated as already confirmed', async () => {
    const { raw, db } = openDb();
    const householdId = 'hh-legacy';
    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
    seedSlipQueue(raw, { id: 'slip-legacy', householdId, status: 'completed' });

    // Exactly what a build that predates deterministic ids left behind: a
    // live transaction carrying this slip_id under a RANDOM id. The guard
    // must key on the slip_id's existence, never on the shape of the id.
    raw
      .prepare(
        `INSERT INTO transactions
           (id, household_id, envelope_id, amount_cents, payee, description,
            transaction_date, is_business_expense, slip_id, created_at, updated_at)
         VALUES ('b3c1f0aa-9f51-4a2e-8d77-0c19a4e2f5b1', ?, 'env-1', 10000, 'Checkers',
                 'Groceries', '2026-01-15', 0, 'slip-legacy', ?, ?)`,
      )
      .run(householdId, NOW, NOW);

    const result = await new ConfirmSlipUseCase(db, new DrizzleSlipQueueRepository(db), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    }).execute({
      slipId: 'slip-legacy',
      householdId,
      transactionDate: '2026-01-15',
      items: [{ description: 'Groceries', amountCents: 10000, envelopeId: 'env-1' }],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.transactionIds).toEqual([]);
    // Still exactly the older build's ONE row — nothing was re-written.
    expect(
      count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE slip_id = ?', 'slip-legacy'),
    ).toBe(1);

    raw.close();
  });

  /**
   * SYNC-SLIP case (c), end to end on the engine's REAL `row_exists` path.
   *
   * Two devices confirm the same slip but DIFFERENT line content at the same
   * index (one user edited a line first). Because the ids now agree, the
   * second device's insert is answered `row_exists` instead of being stored
   * as a second row. The non-negotiables asserted here: the op is marked
   * PUSHED and is NOT dead-lettered, is not retried, and the local row is
   * overwritten with the SERVER's — so no row is left existing on one phone
   * but not the server, and nothing is stranded in the DLQ.
   */
  it('SYNC-SLIP (c): a divergent second confirm is SUPERSEDED — op pushed, not dead-lettered, local row replaced by the server row', async () => {
    const { raw, db } = openDb();
    const householdId = 'hh-diverge';
    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
    seedSlipQueue(raw, { id: 'slip-diverge', householdId, status: 'processing' });

    // This device (phone B) confirms the slip with its OWN edit of line 0.
    const result = await new ConfirmSlipUseCase(db, new DrizzleSlipQueueRepository(db), {
      deviceId: 'device-B',
      actorUserId: 'user-B',
      clock: () => NOW,
    }).execute({
      slipId: 'slip-diverge',
      householdId,
      transactionDate: '2026-01-15',
      items: [{ description: 'Groceries (B edit)', amountCents: 9000, envelopeId: 'env-1' }],
    });
    expect(result.success).toBe(true);
    const lineId = result.success ? result.data.transactionIds[0] : '';

    // Phone A got there first with the SAME id (deterministic) but its own
    // values — this is the server's authoritative row.
    const serverRow = {
      id: lineId,
      household_id: householdId,
      envelope_id: 'env-1',
      amount_cents: 10000,
      payee: null,
      description: 'Groceries (A original)',
      transaction_date: '2026-01-15',
      is_business_expense: 0,
      spending_trigger_note: null,
      slip_id: 'slip-diverge',
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
    };
    const transport = new RowExistsTransport();
    transport.serverRows.set(lineId, serverRow);

    const engine = new SyncEngine({
      db: drizzle(raw) as unknown as PortableDb,
      transport,
      deviceId: 'device-B',
      clock: () => NOW,
      options: { batchSize: 50, backoffBaseMs: 1000, backoffMaxMs: 60000, maxRejectRetries: 5 },
    });
    // `push()` returns undefined when a drain is already in flight; this is
    // the only caller, so a summary is always produced here.
    const summary = await engine.push();
    expect(summary).toBeDefined();

    // Superseded, not failed and not applied.
    expect(summary?.superseded).toBeGreaterThanOrEqual(1);
    expect(summary?.deadLettered).toBe(0);
    expect(engine.listDeadLettered(householdId)).toEqual([]);

    const op = raw
      .prepare(
        "SELECT pushed_at, dead_lettered_at, retry_count FROM oplog WHERE row_id = ? AND table_name = 'transactions'",
      )
      .get(lineId) as { pushed_at: string | null; dead_lettered_at: string | null };
    expect(op.pushed_at).toBe(NOW);
    expect(op.dead_lettered_at).toBeNull();

    // The divergence is gone: this phone now shows the SERVER's line, and
    // there is still exactly ONE row for the slip — not two.
    expect(transport.lastRefreshedRowId).toBe(lineId);
    const local = raw
      .prepare('SELECT amount_cents AS a, description AS d FROM transactions WHERE id = ?')
      .get(lineId) as { a: number; d: string };
    expect(local).toEqual({ a: 10000, d: 'Groceries (A original)' });
    expect(
      count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE slip_id = ?', 'slip-diverge'),
    ).toBe(1);

    // A second push round sends nothing for it — no retry loop.
    const pushedCount = transport.pushed.length;
    await engine.push();
    expect(transport.pushed).toHaveLength(pushedCount);

    raw.close();
  });

  it('REF-SLIP: a mid-transaction failure still rolls BACK the negative line too — atomicity is unchanged', async () => {
    const { raw, db } = openDb();
    const householdId = 'hh-neg-rollback';
    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-1', householdId, envelopeType: 'spending' });
    seedSlipQueue(raw, { id: 'slip-7', householdId, status: 'processing' });

    // Same collision fixture as the positive-only rollback test above: the
    // SECOND line's oplog append hits a PRIMARY KEY conflict after the first
    // line's transaction row is already written inside the open transaction.
    raw
      .prepare(
        `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id, client_created_at)
         VALUES ('dup-op-neg', 'hh-other', 'transactions', 'other-row', 'insert', '{}', 'device-0', ?)`,
      )
      .run(NOW);

    const repo = new DrizzleSlipQueueRepository(db);
    let genIdCalls = 0;
    const result = await new ConfirmSlipUseCase(db, repo, {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
      genId: () => {
        genIdCalls += 1;
        return genIdCalls === 1 ? 'op-neg-1' : 'dup-op-neg';
      },
    }).execute({
      slipId: 'slip-7',
      householdId,
      transactionDate: '2026-01-15',
      items: [
        { description: 'Groceries', amountCents: 10000, envelopeId: 'env-1' },
        { description: 'DISCOUNT', amountCents: -1500, envelopeId: 'env-1' },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('SLIP_PARTIAL_SAVE_FAILED');

    // Neither the charge nor the discount was left behind.
    expect(
      count(raw, 'SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?', householdId),
    ).toBe(0);
    expect(raw.prepare("SELECT * FROM oplog WHERE op_id = 'op-neg-1'").get()).toBeUndefined();

    raw.close();
  });
});
