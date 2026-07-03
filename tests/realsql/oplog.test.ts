import { openMigratedDb } from './harness/openMigratedDb';

describe('oplog foundations (real SQLite)', () => {
  it('creates oplog, sync_cursor, and score_history tables after full migration', () => {
    const db = openMigratedDb();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain('oplog');
    expect(tables).toContain('sync_cursor');
    expect(tables).toContain('score_history');
    db.close();
  });

  it('has an index on oplog (pushed_at, next_attempt_at)', () => {
    const db = openMigratedDb();
    const indexes = db.prepare('PRAGMA index_list(oplog)').all() as { name: string }[];
    const found = indexes.some((idx) => {
      const cols = (db.prepare(`PRAGMA index_info(${idx.name})`).all() as { name: string }[]).map(
        (c) => c.name,
      );
      return cols.join(',') === 'pushed_at,next_attempt_at';
    });
    expect(found).toBe(true);
    db.close();
  });

  it('round-trips an insert into oplog', () => {
    const db = openMigratedDb();
    db.prepare(
      `INSERT INTO oplog (
        op_id, seq_local, household_id, table_name, row_id, op_type, payload,
        actor_user_id, device_id, client_created_at
      ) VALUES (
        'op-1', 1, 'hh-1', 'envelopes', 'env-1', 'INSERT', '{"foo":"bar"}',
        'user-1', 'device-1', '2026-01-01T00:00:00.000Z'
      )`,
    ).run();
    const row = db.prepare('SELECT * FROM oplog WHERE op_id = ?').get('op-1') as Record<
      string,
      unknown
    >;
    expect(row).toBeTruthy();
    expect(row.op_id).toBe('op-1');
    expect(row.seq_local).toBe(1);
    expect(row.household_id).toBe('hh-1');
    expect(row.payload).toBe('{"foo":"bar"}');
    expect(row.retry_count).toBe(0); // NOT NULL DEFAULT 0
    expect(row.pushed_at).toBeNull();
    expect(row.dead_lettered_at).toBeNull();
    db.close();
  });

  it('defaults sync_cursor.last_pulled_seq to 0', () => {
    const db = openMigratedDb();
    db.prepare(`INSERT INTO sync_cursor (household_id) VALUES ('hh-1')`).run();
    const row = db.prepare('SELECT * FROM sync_cursor WHERE household_id = ?').get('hh-1') as {
      last_pulled_seq: number;
    };
    expect(row.last_pulled_seq).toBe(0);
    db.close();
  });

  it('round-trips an insert into score_history', () => {
    const db = openMigratedDb();
    db.prepare(
      `INSERT INTO score_history (id, household_id, period_start, score, components, created_at)
       VALUES ('sh-1', 'hh-1', '2026-01-01', 87, '{"savings":40}', '2026-01-01T00:00:00.000Z')`,
    ).run();
    const row = db.prepare('SELECT * FROM score_history WHERE id = ?').get('sh-1') as Record<
      string,
      unknown
    >;
    expect(row).toBeTruthy();
    expect(row.score).toBe(87);
    expect(row.components).toBe('{"savings":40}');
    db.close();
  });
});
