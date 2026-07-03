import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { createSyncedRepo, type SyncedRepoCtx } from '../../src/data/uow/createSyncedRepo';

const NOW = '2026-01-01T00:00:00.000Z';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

function makeCtx(overrides: Partial<SyncedRepoCtx> = {}): SyncedRepoCtx {
  return {
    deviceId: 'device-1',
    actorUserId: 'user-1',
    clock: () => NOW,
    ...overrides,
  };
}

interface EnvelopeRow {
  id: string;
  household_id: string;
  name: string;
  allocated_cents: number;
  envelope_type: string;
  period_start: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface OplogRow {
  op_id: string;
  household_id: string;
  table_name: string;
  row_id: string;
  op_type: string;
  payload: string;
  actor_user_id: string | null;
  device_id: string;
  client_created_at: string;
  pushed_at: string | null;
}

function baseEnvelopeRow(id: string, householdId: string): Record<string, unknown> {
  return {
    id,
    household_id: householdId,
    name: 'Groceries',
    allocated_cents: 5000,
    envelope_type: 'spending',
    period_start: '2026-01-01',
    created_at: NOW,
    updated_at: NOW,
  };
}

describe('createSyncedRepo (real SQLite)', () => {
  it('insert writes the entity row and exactly one matching oplog row', () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);
    const repo = createSyncedRepo(db, { tableName: 'envelopes' });

    repo.insert(baseEnvelopeRow('env-1', 'hh-1'), makeCtx({ genId: () => 'op-insert-1' }));

    const envelope = raw
      .prepare('SELECT * FROM envelopes WHERE id = ?')
      .get('env-1') as EnvelopeRow;
    expect(envelope).toBeTruthy();
    expect(envelope.name).toBe('Groceries');
    expect(envelope.allocated_cents).toBe(5000);

    const ops = raw.prepare('SELECT * FROM oplog WHERE row_id = ?').all('env-1') as OplogRow[];
    expect(ops).toHaveLength(1);
    const op = ops[0];
    expect(op.op_id).toBe('op-insert-1');
    expect(op.op_type).toBe('insert');
    expect(op.table_name).toBe('envelopes');
    expect(op.row_id).toBe('env-1');
    expect(op.household_id).toBe('hh-1');
    expect(op.device_id).toBe('device-1');
    expect(op.actor_user_id).toBe('user-1');
    expect(op.client_created_at).toBe(NOW);
    expect(op.pushed_at).toBeNull();
    expect(JSON.parse(op.payload)).toEqual(baseEnvelopeRow('env-1', 'hh-1'));

    raw.close();
  });

  it('leaves no orphan entity or oplog row when the oplog append fails mid-write', () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);
    const repo = createSyncedRepo(db, { tableName: 'envelopes' });

    // Pre-seed an oplog row occupying the op_id our forced insert will reuse,
    // so the INSERT INTO oplog inside the transaction hits a PK conflict
    // *after* the entity row has already been written — proving the whole
    // transaction (not just the entity write) rolls back.
    raw
      .prepare(
        `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id, client_created_at)
         VALUES ('dup-op', 'hh-0', 'envelopes', 'other-row', 'insert', '{}', 'device-0', ?)`,
      )
      .run(NOW);

    expect(() => {
      repo.insert(baseEnvelopeRow('env-fail', 'hh-1'), makeCtx({ genId: () => 'dup-op' }));
    }).toThrow();

    const envelope = raw.prepare('SELECT * FROM envelopes WHERE id = ?').get('env-fail');
    expect(envelope).toBeUndefined();

    const opsForFailedRow = raw
      .prepare('SELECT * FROM oplog WHERE row_id = ?')
      .all('env-fail') as OplogRow[];
    expect(opsForFailedRow).toHaveLength(0);

    const totalOplogRows = (raw.prepare('SELECT COUNT(*) AS n FROM oplog').get() as { n: number })
      .n;
    expect(totalOplogRows).toBe(1); // only the pre-seeded row survives

    raw.close();
  });

  it('softDelete sets deleted_at on the entity and appends a delete op', () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);
    const repo = createSyncedRepo(db, { tableName: 'envelopes' });

    repo.insert(baseEnvelopeRow('env-2', 'hh-1'), makeCtx({ genId: () => 'op-insert-2' }));
    repo.softDelete(
      'env-2',
      'hh-1',
      makeCtx({ genId: () => 'op-delete-2', clock: () => '2026-02-01T00:00:00.000Z' }),
    );

    const envelope = raw
      .prepare('SELECT * FROM envelopes WHERE id = ?')
      .get('env-2') as EnvelopeRow;
    expect(envelope.deleted_at).toBe('2026-02-01T00:00:00.000Z');

    const op = raw.prepare('SELECT * FROM oplog WHERE op_id = ?').get('op-delete-2') as OplogRow;
    expect(op.op_type).toBe('delete');
    expect(op.row_id).toBe('env-2');
    expect(JSON.parse(op.payload)).toEqual({ deleted_at: '2026-02-01T00:00:00.000Z' });

    raw.close();
  });

  it('increment appends an increment op with {field,delta,clamp} and applies the arithmetic', () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);
    const repo = createSyncedRepo(db, { tableName: 'envelopes' });

    repo.insert(baseEnvelopeRow('env-3', 'hh-1'), makeCtx({ genId: () => 'op-insert-3' }));

    repo.increment(
      'env-3',
      'hh-1',
      'allocated_cents',
      -8000,
      'floor_zero',
      makeCtx({ genId: () => 'op-increment-3' }),
    );

    const envelope = raw
      .prepare('SELECT * FROM envelopes WHERE id = ?')
      .get('env-3') as EnvelopeRow;
    // Started at 5000, delta -8000 would go negative — floor_zero clamps at 0.
    expect(envelope.allocated_cents).toBe(0);

    const op = raw.prepare('SELECT * FROM oplog WHERE op_id = ?').get('op-increment-3') as OplogRow;
    expect(op.op_type).toBe('increment');
    expect(JSON.parse(op.payload)).toEqual({
      field: 'allocated_cents',
      delta: -8000,
      clamp: 'floor_zero',
    });

    raw.close();
  });

  it('increment without clamping applies the raw delta', () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);
    const repo = createSyncedRepo(db, { tableName: 'envelopes' });

    repo.insert(baseEnvelopeRow('env-4', 'hh-1'), makeCtx({ genId: () => 'op-insert-4' }));
    repo.increment(
      'env-4',
      'hh-1',
      'allocated_cents',
      1500,
      'none',
      makeCtx({ genId: () => 'op-increment-4' }),
    );

    const envelope = raw
      .prepare('SELECT * FROM envelopes WHERE id = ?')
      .get('env-4') as EnvelopeRow;
    expect(envelope.allocated_cents).toBe(6500);

    raw.close();
  });

  it('update writes only the given fields and appends an update op with those fields as payload', () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);
    const repo = createSyncedRepo(db, { tableName: 'envelopes' });

    repo.insert(baseEnvelopeRow('env-5', 'hh-1'), makeCtx({ genId: () => 'op-insert-5' }));
    repo.update(
      'env-5',
      'hh-1',
      { name: 'Rent', allocated_cents: 120000 },
      makeCtx({ genId: () => 'op-update-5' }),
    );

    const envelope = raw
      .prepare('SELECT * FROM envelopes WHERE id = ?')
      .get('env-5') as EnvelopeRow;
    expect(envelope.name).toBe('Rent');
    expect(envelope.allocated_cents).toBe(120000);

    const op = raw.prepare('SELECT * FROM oplog WHERE op_id = ?').get('op-update-5') as OplogRow;
    expect(op.op_type).toBe('update');
    expect(JSON.parse(op.payload)).toEqual({ name: 'Rent', allocated_cents: 120000 });

    raw.close();
  });
});
